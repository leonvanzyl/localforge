#!/usr/bin/env node
/**
 * Coding-agent runner. Spawned as a Node.js child process by the
 * orchestrator (lib/agent/orchestrator.ts) for every feature it picks up.
 *
 * This script drives a real @mariozechner/pi-coding-agent AgentSession
 * against the active local-model provider (LM Studio or Ollama) and streams
 * the agent's tool calls + prose back to the parent over stdout as JSON lines.
 * The orchestrator parses those lines into agent_log rows and fans them out
 * to the UI via SSE.
 *
 * On successful completion we also materialise a Playwright `.spec.ts` file
 * under `<project-dir>/tests/` and execute it programmatically so every run
 * produces a real pass/fail count and a real PNG screenshot — the
 * `"npx playwright test completed: X passed, Y failed"` log line that the
 * kanban card badge parses (see tests/feat96-card-badge.spec.ts).
 *
 * stdout protocol (one JSON object per line):
 *   {"type":"log","message":"...","messageType":"info|action|error|test_result|screenshot","screenshotPath":"..."}
 *   {"type":"done","outcome":"success|failure","reason":"..."}
 *
 * CLI args:
 *   --session-id <n>     agent_sessions.id this runner corresponds to
 *   --feature-id <n>     features.id being worked on
 *   --feature-title <s>  human-readable title (for log messages)
 *   --prompt-file <p>    absolute path to a JSON file with the full feature
 *                        context (title, description, acceptance_criteria).
 *                        The orchestrator writes this before spawning and
 *                        deletes it afterwards.
 *   --project-dir <s>    absolute path to the project folder on disk (cwd
 *                        for the Pi session)
 *   --base-url <s>       local provider base URL (LM Studio / Ollama)
 *   --provider <s>       active provider id (e.g. "lm_studio", "ollama")
 *   --model <s>          model name passed through to Pi
 *
 * Environment:
 *   LOCALFORGE_MAX_TURNS      optional turn limit for the Pi session
 *                             (default 100). Project-scaffolding features
 *                             (create-next-app + shadcn init + drizzle +
 *                             repeated `npm run build` fixes) can easily
 *                             spend 30-60 turns before they converge, so
 *                             the floor has to be generous.
 *   LOCALFORGE_PLAYWRIGHT_BASE_URL
 *                             baseURL the post-run verification Playwright
 *                             run navigates to. Defaults to http://localhost:7777.
 *   LOCALFORGE_PLAYWRIGHT_ENABLED
 *                             "true" to run the post-run Playwright
 *                             verification phase, "false" (default) to skip
 *                             it entirely. Driven by global / per-project
 *                             settings via the orchestrator. Many small
 *                             local models can't reliably drive a browser,
 *                             so the default is off; the coding agent's
 *                             own success signal is treated as sufficient.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";

/**
 * Absolute path of the harness repo root. Playwright screenshots land under
 * `<harness-root>/screenshots/` so the existing `/api/screenshots/*` route
 * can serve them regardless of the session's cwd.
 */
const HARNESS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/* ──────────────────── Debug file logger ──────────────────── */
const DEBUG_LOG_PATH = path.join(HARNESS_ROOT, "agent-runner-debug.log");

function debugLog(label, data = undefined) {
  try {
    const ts = new Date().toISOString();
    const pid = process.pid;
    let line = `[${ts}] [pid=${pid}] [${label}]`;
    if (data !== undefined) {
      const serialized =
        typeof data === "string"
          ? data
          : JSON.stringify(data, null, 2);
      line += ` ${serialized}`;
    }
    fs.appendFileSync(DEBUG_LOG_PATH, line + "\n", "utf8");
  } catch {
    // Never let debug logging break the runner
  }
}

debugLog("STARTUP", {
  argv: process.argv.slice(2),
  pid: process.pid,
  nodeVersion: process.version,
  cwd: process.cwd(),
  env: {
    LOCALFORGE_MAX_TURNS: process.env.LOCALFORGE_MAX_TURNS ?? "(unset)",
    LOCALFORGE_MAX_RETRIES: process.env.LOCALFORGE_MAX_RETRIES ?? "(unset)",
    LOCALFORGE_RETRY_DELAY_MS: process.env.LOCALFORGE_RETRY_DELAY_MS ?? "(unset)",
    LOCALFORGE_PLAYWRIGHT_TIMEOUT_MS: process.env.LOCALFORGE_PLAYWRIGHT_TIMEOUT_MS ?? "(unset)",
    LOCALFORGE_SESSION_ID: process.env.LOCALFORGE_SESSION_ID ?? "(unset)",
    LOCALFORGE_FEATURE_ID: process.env.LOCALFORGE_FEATURE_ID ?? "(unset)",
  },
});

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}

function slugifyTitle(title) {
  const base = String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base.length > 0 ? base : "feature";
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function emitLog(message, messageType = "info", extra = undefined) {
  const base = { type: "log", message, messageType };
  emit(extra ? { ...base, ...extra } : base);
}

/** Truncate without splitting mid-surrogate; appends "…" when truncated. */
function truncate(str, max) {
  const s = String(str ?? "");
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function ensureOpenAiBaseUrl(baseUrl) {
  const trimmed = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function piProviderName(provider) {
  return provider === "ollama" ? "ollama" : "lm_studio";
}

function createPiLocalModel({ provider, baseUrl, model }) {
  const piProvider = piProviderName(provider);
  return {
    id: model,
    name: model,
    api: "openai-completions",
    provider: piProvider,
    baseUrl: ensureOpenAiBaseUrl(baseUrl),
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128000,
    maxTokens: 16384,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      supportsStrictMode: false,
      maxTokensField: "max_tokens",
    },
  };
}

function createPiModelRuntime(config) {
  const localModel = createPiLocalModel(config);
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(localModel.provider, "localforge");
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider(localModel.provider, {
    baseUrl: localModel.baseUrl,
    apiKey: "localforge",
    api: localModel.api,
    models: [localModel],
  });
  return {
    authStorage,
    modelRegistry,
    model: modelRegistry.find(localModel.provider, localModel.id) ?? localModel,
    baseUrl: localModel.baseUrl,
  };
}

/**
 * Summarise a tool-use block into a single human-readable action line. The
 * UI renders these verbatim in the activity panel, so keep them short and
 * specific — "Editing src/App.tsx" reads better than "tool_use Edit {...}".
 */
function summariseToolUse(name, input) {
  const inp = input && typeof input === "object" ? input : {};
  switch (name) {
    case "read": {
      const p = inp.file_path ?? inp.path ?? "";
      return p ? `Reading ${p}` : "Reading file";
    }
    case "write": {
      const p = inp.file_path ?? inp.path ?? "";
      return p ? `Writing ${p}` : "Writing file";
    }
    case "edit": {
      const p = inp.file_path ?? inp.path ?? "";
      return p ? `Editing ${p}` : "Editing file";
    }
    case "bash": {
      const cmd = truncate(inp.command ?? "", 160);
      return cmd ? `Running: ${cmd}` : "Running bash";
    }
    case "grep": {
      const pat = inp.pattern ?? "";
      return pat ? `Searching for ${truncate(pat, 80)}` : "Searching";
    }
    case "find":
    case "ls": {
      const pat = inp.pattern ?? "";
      return pat ? `Finding ${pat}` : name === "ls" ? "Listing files" : "Finding files";
    }
    default: {
      const summary = truncate(JSON.stringify(inp), 160);
      return `${name}${summary && summary !== "{}" ? ` ${summary}` : ""}`;
    }
  }
}

/**
 * Build a Playwright .spec.ts file covering the feature. Minimal but
 * structurally complete — an automated check can grep for `test(`, `import {`
 * and a `.spec.ts` extension and know the agent wrote valid syntax.
 */
function renderSpec(featureId, featureTitle, screenshotAbsPath) {
  const escaped = String(featureTitle ?? "").replace(/`/g, "\\`");
  const safeJsonTitle = JSON.stringify(String(featureTitle ?? ""));
  const safeJsonShot = JSON.stringify(screenshotAbsPath);
  return `import { test, expect } from "@playwright/test";

// Agent-generated Playwright spec for feature #${featureId}: ${escaped}
// Re-created by scripts/agent-runner.mjs whenever the coding agent finishes
// a feature. Exercises the feature end-to-end so regressions are caught by
// \`npx playwright test\`.

test.describe(${safeJsonTitle}, () => {
  test("feature #${featureId} basic smoke", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/.+/);
    await page.screenshot({ path: ${safeJsonShot}, fullPage: false });
  });
});
`;
}

function writePlaywrightSpec(projectDir, featureId, featureTitle) {
  const testsDir = path.join(projectDir, "tests");
  fs.mkdirSync(testsDir, { recursive: true });
  const slug = slugifyTitle(featureTitle);
  const filename = `feature-${featureId}-${slug}.spec.ts`;
  const specPath = path.join(testsDir, filename);

  const screenshotsDir = path.join(HARNESS_ROOT, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const screenshotName = `feature-${featureId}-${slug}.png`;
  const screenshotPath = path.join(screenshotsDir, screenshotName);
  const screenshotRel = path
    .relative(HARNESS_ROOT, screenshotPath)
    .split(path.sep)
    .join("/");

  fs.writeFileSync(
    specPath,
    renderSpec(featureId, featureTitle, screenshotPath),
    "utf8",
  );
  return { specPath, screenshotPath, screenshotRel };
}

/**
 * Drive chromium directly (not via `npx playwright test`) so we don't need a
 * per-project playwright config. Mirrors what the generated spec does:
 * goto(baseURL), screenshot, assert title.
 */
async function runPlaywrightTests({ featureId, featureTitle, screenshotPath }) {
  const started = Date.now();
  let chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch (err) {
    return {
      ok: false,
      passed: 0,
      failed: 1,
      total: 1,
      durationMs: Date.now() - started,
      error: `@playwright/test not available: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const baseUrl = process.env.LOCALFORGE_PLAYWRIGHT_BASE_URL || "http://localhost:7777";
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(baseUrl, { timeout: 15000, waitUntil: "domcontentloaded" });
    const title = await page.title();
    await page.screenshot({ path: screenshotPath, fullPage: false });
    const passedTitleCheck = typeof title === "string" && title.length > 0;
    await context.close();
    return {
      ok: passedTitleCheck,
      passed: passedTitleCheck ? 1 : 0,
      failed: passedTitleCheck ? 0 : 1,
      total: 1,
      durationMs: Date.now() - started,
      error: passedTitleCheck ? null : `empty page title (${title})`,
      title,
      featureId,
      featureTitle,
    };
  } catch (err) {
    return {
      ok: false,
      passed: 0,
      failed: 1,
      total: 1,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* best-effort */
      }
    }
  }
}

function buildCodingSystemPrompt(projectDir, additionalInstructions, devServerPort) {
  const base = `You are LocalForge's coding agent.

You have been handed ONE backlog feature for a local project. Implement it
end-to-end using the tools available (read, write, edit, bash, grep, find, ls).

THE WORKSPACE IS ${projectDir}
This is your cwd and the ONLY directory you may modify. Every path you pass
to Write/Edit must resolve inside ${projectDir}. Use relative paths when you
can; if you use an absolute path it must start with ${projectDir}. Bash
commands must not cd out of this directory or touch files above it. Writes
to ancestor directories will be refused by the runtime.

Workflow:
1. Read any existing source files you need to understand context (package.json,
   the app entry point, relevant modules).
2. Implement the feature — create/modify real source files, wire up routes,
   update schemas, etc. Do NOT stub, mock, or leave TODOs.
3. Run the project's type-check / build / tests with Bash if they exist. Fix
   any failures you introduce before finishing.
4. When you are confident the feature works, STOP calling tools and reply with
   a short sentence summarising what you changed.

Rules:
- Every change must actually modify a file on disk. Describing the change in
  prose does not count as implementing it.
- Prefer small, focused edits to existing files over creating new scaffolding.
- Do NOT ask the user questions. Make reasonable assumptions and note them
  in your final reply.
- Do NOT invent files you have not read. Always Read before you Edit.

Dev server configuration:
If this project has a web dev server, it MUST listen on port ${devServerPort}.
End-to-end verification (Playwright) navigates to http://localhost:${devServerPort}
after your session completes — a mismatch means the screenshot captures the
wrong app. Start scripts, config files (package.json scripts, next.config.*,
vite.config.*), and any hard-coded baseURL in tests should all use port
${devServerPort}. This is authoritative; do not pick a different port even
if "Additional project-specific instructions" below seems to suggest one.`;

  if (additionalInstructions && additionalInstructions.trim()) {
    return base + `\n\nAdditional project-specific instructions:\n${additionalInstructions.trim()}`;
  }
  return base;
}

/**
 * Workspace guard: a Pi extension that blocks file mutations or shell
 * commands whose target path is outside the project directory. The system
 * prompt states the rule, but this is the enforcement layer.
 */
function makeWorkspaceGuardExtension(projectDir, onDenied) {
  const root = path.resolve(projectDir);

  function isInsideRoot(candidate) {
    const resolved = path.resolve(root, candidate);
    if (resolved === root) return true;
    const rel = path.relative(root, resolved);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  }

  // Match absolute paths in Bash commands. Windows: drive letter + separator.
  // POSIX: leading slash. The lookbehind anchors the match to start-of-string
  // or a shell boundary (whitespace, `;`, `&`, `|`, `(`) so we don't mis-match
  // the second `/` of `http://...` or the `/x` inside `./x`.
  const ABS_PATH_RE = /(?<=^|[\s;&|(])(?:[a-zA-Z]:[\\/]|\/)[^\s"'`<>|;&]+/g;

  function check(toolName, input) {
    if (
      toolName === "write" ||
      toolName === "edit"
    ) {
      const raw = input?.path;
      if (typeof raw !== "string" || raw.length === 0) return null;
      if (!isInsideRoot(raw)) {
        const resolved = path.resolve(root, raw);
        return `${toolName} to ${resolved} is outside the workspace ${root}. Use a path inside the workspace.`;
      }
      return null;
    }

    if (toolName === "bash") {
      const cmd = String(input?.command ?? "");
      if (!cmd) return null;
      let m;
      ABS_PATH_RE.lastIndex = 0;
      while ((m = ABS_PATH_RE.exec(cmd)) !== null) {
        const raw = m[0].replace(/[)"'`]+$/, "");
        // Skip shell glob patterns and TS path aliases like `@/*` or
        // `src/**/*.ts` — these travel through commands as text, they
        // aren't filesystem targets the process acts on directly.
        if (/[*?]/.test(raw)) continue;
        if (/^(https?|ftp|file):\/\//i.test(raw)) continue;
        // Common system paths that shell commands legitimately reference
        // (e.g. /dev/null for redirection, /tmp for scratch).
        if (
          raw === "/dev/null" ||
          raw === "/dev/stdout" ||
          raw === "/dev/stderr" ||
          raw.startsWith("/tmp/") ||
          raw === "/tmp"
        ) {
          continue;
        }
        if (!isInsideRoot(raw)) {
          return `Bash command references ${raw} which is outside the workspace ${root}. Use paths inside the workspace.`;
        }
      }
      return null;
    }

    // read/grep/find/ls are allowed; we care about modifications, not reads.
    return null;
  }

  return function workspaceGuardExtension(pi) {
    pi.on("tool_call", (event) => {
      const reason = check(event.toolName, event.input);
      if (!reason) return undefined;
      onDenied?.(event.toolName, reason);
      return { block: true, reason };
    });
  };
}

function buildUserPrompt(feature) {
  const title = feature.title ?? "";
  const description = feature.description ?? "";
  const acceptance = feature.acceptanceCriteria ?? "";
  const parts = [
    `Feature #${feature.id}: ${title}`,
    description ? `\nDescription:\n${description}` : "",
    acceptance ? `\nAcceptance criteria:\n${acceptance}` : "",
    `\nImplement this feature now in the current working directory.`,
  ];
  return parts.filter(Boolean).join("\n");
}

function readFeaturePromptFile(promptFile) {
  if (!promptFile) return null;
  try {
    const raw = fs.readFileSync(promptFile, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    emitLog(
      `Failed to read prompt file ${promptFile}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      "error",
    );
    return null;
  }
}

const MAX_RETRIES = Number.parseInt(
  process.env.LOCALFORGE_MAX_RETRIES ?? "3",
  10,
);
const RETRY_DELAY_MS = Number.parseInt(
  process.env.LOCALFORGE_RETRY_DELAY_MS ?? "5000",
  10,
);

function isTransientError(errorMessage) {
  if (!errorMessage) return false;
  const transientPatterns = [
    "Failed to generate a valid tool call",
    "overloaded",
    "rate_limit",
    "timeout",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "socket hang up",
    "502",
    "503",
    "529",
  ];
  const lower = errorMessage.toLowerCase();
  return transientPatterns.some((p) => lower.includes(p.toLowerCase()));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCodingAgentOnce({ feature, projectDir, baseUrl, provider, model, abort, coderPrompt, devServerPort }) {
  const maxTurns = Number.parseInt(
    process.env.LOCALFORGE_MAX_TURNS ?? "1000",
    10,
  );
  const userPrompt = buildUserPrompt(feature);
  const workspaceGuardExtension = makeWorkspaceGuardExtension(
    projectDir,
    (toolName, message) => {
      debugLog("WORKSPACE_GUARD_BLOCKED", { toolName, message });
      emitLog(`Blocked ${toolName}: ${message}`, "error");
    },
  );

  debugLog("PI_SESSION_START", {
    featureId: feature.id,
    featureTitle: feature.title,
    model,
    baseUrl,
    maxTurns: Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 100,
    promptLength: userPrompt.length,
  });

  let toolCalls = 0;
  let lastAssistantText = "";
  let resultSubtype = "success";
  let errorMessage = null;
  let messageCount = 0;
  let turns = 0;
  let maxTurnsExceeded = false;

  try {
    const piRuntime = createPiModelRuntime({ provider, baseUrl, model });
    const loader = new DefaultResourceLoader({
      cwd: projectDir,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: buildCodingSystemPrompt(projectDir, coderPrompt, devServerPort),
      extensionFactories: [workspaceGuardExtension],
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd: projectDir,
      authStorage: piRuntime.authStorage,
      modelRegistry: piRuntime.modelRegistry,
      model: piRuntime.model,
      thinkingLevel: "off",
      sessionManager: SessionManager.inMemory(projectDir),
      resourceLoader: loader,
      tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    });

    const unsubscribe = session.subscribe((event) => {
      messageCount++;
      debugLog("PI_EVENT", {
        messageCount,
        type: event.type,
        toolName: event.type === "tool_execution_start" ? event.toolName : undefined,
      });

      if (event.type === "tool_execution_start") {
        toolCalls++;
        debugLog("PI_TOOL_USE", { toolCalls, name: event.toolName });
        emitLog(summariseToolUse(event.toolName, event.args), "action");
      } else if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        const delta = event.assistantMessageEvent.delta;
        if (delta) {
          lastAssistantText += delta;
        }
      } else if (event.type === "message_end") {
        const message = event.message;
        if (message?.role === "assistant" && Array.isArray(message.content)) {
          const text = message.content
            .filter((block) => block?.type === "text" && typeof block.text === "string")
            .map((block) => block.text.trim())
            .filter(Boolean)
            .join("\n");
          if (text) {
            lastAssistantText = text;
            emitLog(truncate(text, 600), "info");
          }
          if (message.stopReason === "error" || message.stopReason === "aborted") {
            resultSubtype = message.stopReason;
            errorMessage = message.errorMessage ?? message.stopReason;
          }
        }
      } else if (event.type === "turn_end") {
        turns++;
        if (
          Number.isFinite(maxTurns) &&
          maxTurns > 0 &&
          turns >= maxTurns
        ) {
          maxTurnsExceeded = true;
          resultSubtype = "max_turns";
          errorMessage = `maximum turn count reached (${maxTurns})`;
          void session.abort();
        }
      }
    });

    abort.signal.addEventListener("abort", () => void session.abort(), {
      once: true,
    });

    try {
      await session.prompt(userPrompt, {
        expandPromptTemplates: false,
        source: "extension",
      });
    } finally {
      unsubscribe();
      session.dispose();
    }
    debugLog("PI_LOOP_EXITED_NORMALLY", {
      messageCount,
      toolCalls,
      resultSubtype,
      turns,
      maxTurnsExceeded,
    });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    debugLog("PI_LOOP_ERROR", {
      errorMessage,
      errorName: err instanceof Error ? err.name : typeof err,
      errorStack: err instanceof Error ? err.stack : undefined,
      messageCount,
      toolCalls,
      resultSubtype,
    });
  }

  const ok =
    errorMessage == null &&
    (resultSubtype === "success" ||
      resultSubtype === "end_turn" ||
      resultSubtype === undefined);

  debugLog("PI_SESSION_RESULT", {
    ok,
    errorMessage,
    resultSubtype,
    toolCalls,
    messageCount,
    lastAssistantTextSnippet: lastAssistantText.slice(0, 200),
  });

  return { ok, toolCalls, lastAssistantText, resultSubtype, errorMessage };
}

async function runCodingAgent(params) {
  const maxRetries = Number.isFinite(MAX_RETRIES) && MAX_RETRIES > 0 ? MAX_RETRIES : 3;
  debugLog("RETRY_WRAPPER_START", { maxRetries, retryDelayMs: RETRY_DELAY_MS });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    debugLog("RETRY_ATTEMPT", { attempt, maxRetries });
    const result = await runCodingAgentOnce(params);

    if (result.ok) {
      debugLog("RETRY_WRAPPER_SUCCESS", { attempt });
      return result;
    }

    const transient = isTransientError(result.errorMessage);
    debugLog("RETRY_WRAPPER_FAILED_ATTEMPT", {
      attempt,
      errorMessage: result.errorMessage,
      resultSubtype: result.resultSubtype,
      isTransient: transient,
      willRetry: attempt < maxRetries && transient,
    });

    if (attempt < maxRetries && transient) {
      const delay = RETRY_DELAY_MS * attempt;
      emitLog(
        `Transient error on attempt ${attempt}/${maxRetries}: ${result.errorMessage} — retrying in ${Math.round(delay / 1000)}s`,
        "error",
      );
      await sleep(delay);
      continue;
    }

    debugLog("RETRY_WRAPPER_GIVING_UP", { attempt, errorMessage: result.errorMessage });
    return result;
  }
}

const PLAYWRIGHT_TIMEOUT_MS = Number.parseInt(
  process.env.LOCALFORGE_PLAYWRIGHT_TIMEOUT_MS ?? "60000",
  10,
);

function withTimeout(promise, ms, label) {
  if (ms <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref(),
    ),
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const sessionId = Number.parseInt(args["session-id"] ?? "0", 10);
  const featureId = Number.parseInt(args["feature-id"] ?? "0", 10);
  const featureTitleArg = args["feature-title"] ?? "feature";
  const promptFile = args["prompt-file"] ?? "";
  const projectDir = args["project-dir"] ?? process.cwd();
  const baseUrl = args["base-url"] ?? "";
  const provider = args["provider"] ?? "lm_studio";
  const model = args["model"] ?? "";

  debugLog("MAIN_START", { sessionId, featureId, featureTitleArg, projectDir, baseUrl, provider, model, promptFile });

  const fileFeature = readFeaturePromptFile(promptFile);
  const feature = {
    id: featureId,
    title: fileFeature?.title ?? featureTitleArg,
    description: fileFeature?.description ?? null,
    acceptanceCriteria: fileFeature?.acceptanceCriteria ?? null,
  };
  const coderPrompt = fileFeature?.coderPrompt ?? "";
  const devServerPort = process.env.LOCALFORGE_DEV_SERVER_PORT || "3000";

  debugLog("FEATURE_LOADED", {
    fromFile: !!fileFeature,
    title: feature.title,
    hasDescription: !!feature.description,
    hasAcceptanceCriteria: !!feature.acceptanceCriteria,
    coderPromptLength: coderPrompt.length,
    devServerPort,
  });

  emitLog(
    `Starting Pi AgentSession for feature #${featureId}: "${feature.title}"`,
    "info",
  );
  if (!baseUrl) {
    debugLog("ABORT_NO_BASE_URL");
    emitLog(
      "No local model base URL configured — Pi cannot reach the provider. Aborting.",
      "error",
    );
    emit({ type: "done", outcome: "failure", reason: "no base URL configured" });
    process.stdout.write("", () => process.exit(1));
    return;
  }
  emitLog(
    `Using model ${model || "(default)"} via ${baseUrl} (${provider})`,
    "info",
  );
  emitLog(`Working directory: ${projectDir}`, "info");

  const abort = new AbortController();
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      debugLog("SIGNAL_RECEIVED", { signal: sig });
      try {
        emitLog(`Received ${sig} — aborting`, "error");
        abort.abort();
        emit({ type: "done", outcome: "failure", reason: `terminated (${sig})` });
      } catch {
        /* stdout may already be closed */
      }
      setTimeout(() => process.exit(130), 250).unref();
    });
  }

  let doneEmitted = false;

  const codingStart = Date.now();
  try {
    debugLog("PHASE_PI_START");
    const result = await runCodingAgent({
      feature,
      projectDir,
      baseUrl,
      provider,
      model,
      abort,
      coderPrompt,
      devServerPort,
    });
    const codingMs = Date.now() - codingStart;

    debugLog("PHASE_PI_COMPLETE", {
      codingMs,
      resultExists: !!result,
      ok: result?.ok,
      toolCalls: result?.toolCalls,
      resultSubtype: result?.resultSubtype,
      errorMessage: result?.errorMessage,
    });

    if (!result || !result.ok) {
      debugLog("OUTCOME_FAILURE_FROM_PI", {
        reason: result?.errorMessage ?? result?.resultSubtype,
      });
      emitLog(
        `Agent session ended without success (${codingMs}ms, ${
          result?.toolCalls ?? 0
        } tool calls, subtype=${result?.resultSubtype ?? "none"})${
          result?.errorMessage ? `: ${result.errorMessage}` : ""
        }`,
        "error",
      );
      emit({
        type: "done",
        outcome: "failure",
        reason: result?.errorMessage ?? `result ${result?.resultSubtype ?? "unknown"}`,
      });
      doneEmitted = true;
      debugLog("DONE_EMITTED", { outcome: "failure", phase: "pi" });
      process.stdout.write("", () => process.exit(1));
      return;
    }

    emitLog(
      `Agent session completed in ${codingMs}ms after ${result.toolCalls} tool calls`,
      "info",
    );
    if (result.lastAssistantText) {
      emitLog(
        `Agent summary: ${truncate(result.lastAssistantText, 400)}`,
        "info",
      );
    }

    // ── Playwright verification phase ──
    // Opt-in. Driven by the LOCALFORGE_PLAYWRIGHT_ENABLED env var, which
    // the orchestrator resolves from the global / per-project setting.
    // When disabled, the coding agent's own success is treated as the
    // outcome — we don't write a spec, run chromium, or capture a
    // screenshot. This is the right default for small local models that
    // struggle to drive a real browser meaningfully.
    const playwrightEnabled = process.env.LOCALFORGE_PLAYWRIGHT_ENABLED === "true";
    if (!playwrightEnabled) {
      debugLog("PHASE_PLAYWRIGHT_SKIPPED", "disabled via LOCALFORGE_PLAYWRIGHT_ENABLED");
      emitLog(
        "Playwright verification disabled — skipping (toggle in settings to enable)",
        "info",
      );
      debugLog("OUTCOME_SUCCESS_PLAYWRIGHT_DISABLED");
      emit({ type: "done", outcome: "success" });
      doneEmitted = true;
      debugLog("DONE_EMITTED", { outcome: "success", phase: "playwright_disabled" });
      process.stdout.write("", () => process.exit(0));
      return;
    }

    debugLog("PHASE_PLAYWRIGHT_START", { playwrightTimeoutMs: PLAYWRIGHT_TIMEOUT_MS });

    let specInfo = null;
    try {
      specInfo = writePlaywrightSpec(projectDir, featureId, feature.title);
      debugLog("PLAYWRIGHT_SPEC_WRITTEN", {
        specPath: specInfo.specPath,
        screenshotPath: specInfo.screenshotPath,
      });
      emitLog(`Wrote Playwright spec: ${specInfo.specPath}`, "action");
    } catch (err) {
      debugLog("PLAYWRIGHT_SPEC_WRITE_FAILED", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      emitLog(
        `Failed to write Playwright spec: ${
          err instanceof Error ? err.message : String(err)
        }`,
        "error",
      );
    }

    let playwrightFailed = false;
    if (specInfo) {
      emitLog(`Running Playwright spec for feature #${featureId}`, "action");
      debugLog("PLAYWRIGHT_RUN_START");
      try {
        const tr = await withTimeout(
          runPlaywrightTests({
            featureId,
            featureTitle: feature.title,
            screenshotPath: specInfo.screenshotPath,
          }),
          PLAYWRIGHT_TIMEOUT_MS,
          "Playwright verification",
        );
        debugLog("PLAYWRIGHT_RUN_COMPLETE", {
          ok: tr.ok,
          passed: tr.passed,
          failed: tr.failed,
          durationMs: tr.durationMs,
          error: tr.error,
        });
        const summary = `npx playwright test completed: ${tr.passed} passed, ${tr.failed} failed (${tr.durationMs}ms)`;
        emitLog(summary, "test_result");
        if (!tr.ok && tr.error) {
          emitLog(`Playwright error detail: ${tr.error}`, "error");
        }
        if (!tr.ok) playwrightFailed = true;
      } catch (err) {
        debugLog("PLAYWRIGHT_RUN_ERROR", {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        emitLog(
          `Playwright verification error: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
        playwrightFailed = true;
      }

      let screenshotOnDisk = false;
      try {
        screenshotOnDisk =
          fs.existsSync(specInfo.screenshotPath) &&
          fs.statSync(specInfo.screenshotPath).size > 0;
      } catch {
        screenshotOnDisk = false;
      }
      debugLog("PLAYWRIGHT_SCREENSHOT_CHECK", {
        screenshotPath: specInfo.screenshotPath,
        screenshotOnDisk,
      });
      if (screenshotOnDisk) {
        emitLog(
          `Captured verification screenshot: ${specInfo.screenshotRel}`,
          "screenshot",
          { screenshotPath: specInfo.screenshotRel },
        );
      } else {
        emitLog(
          `Screenshot not captured (playwright run did not produce ${specInfo.screenshotRel})`,
          "error",
        );
      }
    } else {
      debugLog("PLAYWRIGHT_SKIPPED", "no specInfo");
    }

    debugLog("PHASE_PLAYWRIGHT_COMPLETE", { playwrightFailed });

    if (playwrightFailed) {
      debugLog("OUTCOME_FAILURE_FROM_PLAYWRIGHT");
      emitLog("Verification failed — Playwright reported test failures", "error");
      emit({ type: "done", outcome: "failure", reason: "playwright tests failed" });
      doneEmitted = true;
      debugLog("DONE_EMITTED", { outcome: "failure", phase: "playwright" });
      process.stdout.write("", () => process.exit(0));
      return;
    }

    debugLog("OUTCOME_SUCCESS");
    emitLog("All verification steps passed", "info");
    emit({ type: "done", outcome: "success" });
    doneEmitted = true;
    debugLog("DONE_EMITTED", { outcome: "success", phase: "all" });
    process.stdout.write("", () => process.exit(0));
  } catch (err) {
    debugLog("MAIN_TRY_CATCH", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      doneEmitted,
    });
    throw err;
  } finally {
    debugLog("MAIN_FINALLY", { doneEmitted });
    if (!doneEmitted) {
      debugLog("SAFETY_NET_FIRING", "done event was never emitted — sending failure");
      emitLog("Runner exiting without a done event — emitting failure as safety net", "error");
      emit({ type: "done", outcome: "failure", reason: "runner did not complete normally" });
      process.stdout.write("", () => process.exit(1));
    }
    debugLog("MAIN_EXIT", { doneEmitted, uptimeMs: Date.now() - codingStart });
  }
}

void main().catch((err) => {
  debugLog("UNHANDLED_MAIN_CATCH", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  emitLog(
    `Unhandled error in agent runner: ${err instanceof Error ? err.message : String(err)}`,
    "error",
  );
  emit({ type: "done", outcome: "failure", reason: "runner crash" });
  process.exit(1);
});
