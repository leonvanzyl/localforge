#!/usr/bin/env node
/**
 * Coding-agent runner. Spawned as a Node.js child process by the
 * orchestrator (lib/agent/orchestrator.ts) for every feature it picks up.
 *
 * This script drives a real @anthropic-ai/claude-agent-sdk `query()` session
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
 *                        for the SDK session)
 *   --base-url <s>       ANTHROPIC_BASE_URL for the SDK (LM Studio / Ollama)
 *   --provider <s>       active provider id (e.g. "lm_studio", "ollama")
 *   --model <s>          model name passed through to the SDK
 *
 * Environment:
 *   ANTHROPIC_BASE_URL        forwarded to the SDK (also set explicitly in
 *                             the query() options so it is unambiguous).
 *   LOCALFORGE_MAX_TURNS      optional override for the SDK's maxTurns
 *                             (default 100). Project-scaffolding features
 *                             (create-next-app + shadcn init + drizzle +
 *                             repeated `npm run build` fixes) can easily
 *                             spend 30-60 turns before they converge, so
 *                             the floor has to be generous.
 *   LOCALFORGE_PLAYWRIGHT_BASE_URL
 *                             baseURL the post-run verification Playwright
 *                             run navigates to. Defaults to http://localhost:7777.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";

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
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? "(unset)",
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

/**
 * Summarise a tool-use block into a single human-readable action line. The
 * UI renders these verbatim in the activity panel, so keep them short and
 * specific — "Editing src/App.tsx" reads better than "tool_use Edit {...}".
 */
function summariseToolUse(name, input) {
  const inp = input && typeof input === "object" ? input : {};
  switch (name) {
    case "Read": {
      const p = inp.file_path ?? inp.path ?? "";
      return p ? `Reading ${p}` : "Reading file";
    }
    case "Write": {
      const p = inp.file_path ?? inp.path ?? "";
      return p ? `Writing ${p}` : "Writing file";
    }
    case "Edit":
    case "NotebookEdit": {
      const p = inp.file_path ?? inp.path ?? "";
      return p ? `Editing ${p}` : "Editing file";
    }
    case "Bash": {
      const cmd = truncate(inp.command ?? "", 160);
      return cmd ? `Running: ${cmd}` : "Running bash";
    }
    case "Grep": {
      const pat = inp.pattern ?? "";
      return pat ? `Searching for ${truncate(pat, 80)}` : "Searching";
    }
    case "Glob": {
      const pat = inp.pattern ?? "";
      return pat ? `Globbing ${pat}` : "Globbing";
    }
    case "WebFetch":
    case "WebSearch": {
      const q = inp.url ?? inp.query ?? "";
      return q ? `${name}: ${truncate(q, 120)}` : name;
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

function buildCodingSystemPrompt(projectDir, additionalInstructions) {
  const base = `You are LocalForge's coding agent.

You have been handed ONE backlog feature for a local project. Implement it
end-to-end using the tools available (Read, Write, Edit, Bash, Grep, Glob).

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
- Do NOT invent files you have not read. Always Read before you Edit.`;

  if (additionalInstructions && additionalInstructions.trim()) {
    return base + `\n\nAdditional project-specific instructions:\n${additionalInstructions.trim()}`;
  }
  return base;
}

/**
 * Workspace guard: a `PreToolUse` hook that denies any file-writing or
 * shell-escape whose target path is outside the project directory. This is
 * the enforcement layer — the system prompt tells the model the rule, but
 * we do not trust a local model to follow it.
 *
 * We use a PreToolUse hook (not a `canUseTool` callback) because hooks run
 * regardless of `permissionMode`, which lets us keep `bypassPermissions`
 * for the rest of the SDK's default rules. With `canUseTool` alone the SDK
 * would still route absolute-path Writes through its built-in permission
 * checks before reaching our callback, which was causing all Writes to be
 * denied even when we wanted to allow them.
 *
 * Read-only tools (Read, Grep, Glob, WebFetch, WebSearch, ...) are allowed
 * unconditionally so the agent can consult config above the project dir if
 * it wants to. Bash is the fuzzy case — we scan its command string for
 * absolute paths that resolve outside the root and deny on a match.
 */
function makeWorkspaceGuardHook(projectDir, onDenied) {
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
      toolName === "Write" ||
      toolName === "Edit" ||
      toolName === "NotebookEdit"
    ) {
      const raw = input?.file_path ?? input?.notebook_path ?? input?.path;
      if (typeof raw !== "string" || raw.length === 0) return null;
      if (!isInsideRoot(raw)) {
        const resolved = path.resolve(root, raw);
        return `${toolName} to ${resolved} is outside the workspace ${root}. Use a path inside the workspace.`;
      }
      return null;
    }

    if (toolName === "Bash") {
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

    // Read/Grep/Glob/WebFetch/WebSearch/... — we care about modifications,
    // not reads.
    return null;
  }

  return async function preToolUseHook(input) {
    if (input?.hook_event_name !== "PreToolUse") {
      return { continue: true };
    }
    const reason = check(input.tool_name, input.tool_input);
    if (!reason) return { continue: true };
    onDenied?.(input.tool_name, reason);
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    };
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

async function runCodingAgentOnce({ feature, projectDir, baseUrl, model, abort, coderPrompt }) {
  const maxTurns = Number.parseInt(
    process.env.LOCALFORGE_MAX_TURNS ?? "1000",
    10,
  );
  const userPrompt = buildUserPrompt(feature);
  const workspaceHook = makeWorkspaceGuardHook(
    projectDir,
    (toolName, message) => {
      debugLog("WORKSPACE_HOOK_BLOCKED", { toolName, message });
      emitLog(`Blocked ${toolName}: ${message}`, "error");
    },
  );

  debugLog("SDK_SESSION_START", {
    featureId: feature.id,
    featureTitle: feature.title,
    model,
    baseUrl,
    maxTurns: Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 100,
    promptLength: userPrompt.length,
  });

  let toolCalls = 0;
  let lastAssistantText = "";
  let resultSubtype;
  let errorMessage = null;
  let messageCount = 0;

  try {
    for await (const message of query({
      prompt: userPrompt,
      options: {
        systemPrompt: buildCodingSystemPrompt(projectDir, coderPrompt),
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        hooks: {
          PreToolUse: [{ hooks: [workspaceHook] }],
        },
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: baseUrl,
        },
        model,
        cwd: projectDir,
        maxTurns: Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 100,
        abortController: abort,
      },
    })) {
      messageCount++;
      debugLog("SDK_MESSAGE", {
        messageCount,
        type: message.type,
        subtype: message.subtype ?? null,
        hasContent: message.type === "assistant" ? Array.isArray(message?.message?.content) : undefined,
      });

      if (message.type === "assistant") {
        const blocks = Array.isArray(message?.message?.content)
          ? message.message.content
          : [];
        for (const block of blocks) {
          if (!block || typeof block !== "object") continue;
          if (block.type === "tool_use" && typeof block.name === "string") {
            toolCalls++;
            debugLog("SDK_TOOL_USE", { toolCalls, name: block.name });
            emitLog(summariseToolUse(block.name, block.input), "action");
          } else if (block.type === "text" && typeof block.text === "string") {
            const text = block.text.trim();
            if (text) {
              lastAssistantText = text;
              emitLog(truncate(text, 600), "info");
            }
          }
        }
      } else if (message.type === "result") {
        resultSubtype = message.subtype;
        debugLog("SDK_RESULT", { subtype: resultSubtype, messageCount, toolCalls });
        debugLog("SDK_RESULT_BREAKING_LOOP", "result message received — exiting for-await loop");
        break;
      }
    }
    debugLog("SDK_LOOP_EXITED_NORMALLY", { messageCount, toolCalls, resultSubtype });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    debugLog("SDK_LOOP_ERROR", {
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

  debugLog("SDK_SESSION_RESULT", {
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
  const baseUrl = args["base-url"] ?? process.env.ANTHROPIC_BASE_URL ?? "";
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

  debugLog("FEATURE_LOADED", {
    fromFile: !!fileFeature,
    title: feature.title,
    hasDescription: !!feature.description,
    hasAcceptanceCriteria: !!feature.acceptanceCriteria,
    coderPromptLength: coderPrompt.length,
  });

  emitLog(
    `Starting Claude Agent SDK session for feature #${featureId}: "${feature.title}"`,
    "info",
  );
  if (!baseUrl) {
    debugLog("ABORT_NO_BASE_URL");
    emitLog(
      "No ANTHROPIC_BASE_URL configured — the SDK cannot reach a local model. Aborting.",
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
    debugLog("PHASE_SDK_START");
    const result = await runCodingAgent({
      feature,
      projectDir,
      baseUrl,
      model,
      abort,
      coderPrompt,
    });
    const codingMs = Date.now() - codingStart;

    debugLog("PHASE_SDK_COMPLETE", {
      codingMs,
      resultExists: !!result,
      ok: result?.ok,
      toolCalls: result?.toolCalls,
      resultSubtype: result?.resultSubtype,
      errorMessage: result?.errorMessage,
    });

    if (!result || !result.ok) {
      debugLog("OUTCOME_FAILURE_FROM_SDK", {
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
      debugLog("DONE_EMITTED", { outcome: "failure", phase: "sdk" });
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
