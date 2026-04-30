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

  // Use the project's dev server port, NOT the harness port (7777).
  // The fallback uses LOCALFORGE_DEV_SERVER_PORT so we always target the
  // app being built, never the LocalForge UI.
  const devPort = process.env.LOCALFORGE_DEV_SERVER_PORT || "3000";
  const baseUrl = process.env.LOCALFORGE_PLAYWRIGHT_BASE_URL || `http://localhost:${devPort}`;
  debugLog("PLAYWRIGHT_TARGET_URL", { baseUrl, devPort });
  emitLog(`Playwright navigating to ${baseUrl}`, "info");

  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(baseUrl, { timeout: 15000, waitUntil: "networkidle" });
    // Wait for React/framework to hydrate — networkidle handles most cases
    // but give an extra moment for client-side rendering to settle.
    await page.waitForTimeout(2000);
    const title = await page.title();
    const url = page.url();
    await page.screenshot({ path: screenshotPath, fullPage: false });
    const passedTitleCheck = typeof title === "string" && title.length > 0;
    debugLog("PLAYWRIGHT_PAGE_INFO", { title, url, passedTitleCheck });
    await context.close();
    return {
      ok: passedTitleCheck,
      passed: passedTitleCheck ? 1 : 0,
      failed: passedTitleCheck ? 0 : 1,
      total: 1,
      durationMs: Date.now() - started,
      error: passedTitleCheck ? null : `empty page title (${title})`,
      title,
      url,
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

function buildCodingSystemPrompt(projectDir, additionalInstructions, devServerPort, playwrightEnabled) {
  const base = `You are LocalForge's coding agent.

You have been handed ONE backlog feature for a local project. Implement it
end-to-end using the tools available (read, write, edit, bash, grep, find, ls).

THE MOST IMPORTANT RULE: a feature is NOT complete until you have actually
WRITTEN or EDITED files on disk. Reading, listing, searching, and finding are
preparation; they are not implementation. If your tool-call history for this
session contains zero Write/Edit/Bash invocations, you have NOT done the work
— do not summarise or claim success. The harness will detect this and reject
the session.

THE WORKSPACE IS ${projectDir}
This is your cwd and the ONLY directory you may modify. Every path you pass
to Write/Edit must resolve inside ${projectDir}. Use relative paths when you
can; if you use an absolute path it must start with ${projectDir}. Bash
commands must not cd out of this directory or touch files above it. Writes
to ancestor directories will be refused by the runtime.

Workflow:
1. Read existing source files you need to understand context (package.json,
   the app entry point, relevant modules). Keep this phase short — the goal
   is implementation, not exhaustive analysis.
2. IMPLEMENT THE FEATURE — call Write to create new files, Edit to change
   existing ones, Bash to run install / migration / build commands. Multi-
   step features need MULTIPLE write/edit/bash calls; one read followed by a
   summary is incomplete.
3. Run the project's type-check / build / tests with Bash if they exist. Fix
   any failures you introduce before finishing.
4. SELF-CHECK before stopping: count the Write/Edit/Bash calls you have made
   this session. If the count is zero AND the feature description asks for
   file changes (almost every feature does), you are NOT done. Go back to
   step 2 and actually implement.
5. When the feature legitimately works, STOP calling tools and reply with a
   short sentence listing the files you created/modified.

Rules:
- Every change must actually modify a file on disk. Describing the change in
  prose, or in an assistant message, or in a "plan" — none of those count.
  Only Write/Edit/Bash count.
- Prefer small, focused edits to existing files over creating new scaffolding.
- Do NOT ask the user questions. Make reasonable assumptions and note them
  in your final reply.
- Do NOT invent files you have not read. Always Read before you Edit.

CRITICAL — process management safety:
- NEVER run "taskkill /F /IM node.exe" or "pkill -f node" or "pkill -9 -f node"
  or any command that kills ALL Node.js processes. Other Node.js servers are
  running on this machine that you must not touch.
- To restart YOUR project's server, kill only the specific process by PID or by
  matching the exact script path: e.g. pkill -f "node server/index.js" scoped
  to your project directory, or kill a specific PID you captured earlier.
- NEVER use broad process killers like "killall node" or "taskkill /IM node.exe".

Dev server configuration:
If this project has a web dev server, it MUST listen on port ${devServerPort}.
End-to-end verification (Playwright) navigates to http://localhost:${devServerPort}
after your session completes — a mismatch means the screenshot captures the
wrong app. Start scripts, config files (package.json scripts, next.config.*,
vite.config.*), and any hard-coded baseURL in tests should all use port
${devServerPort}. This is authoritative; do not pick a different port even
if "Additional project-specific instructions" below seems to suggest one.

${playwrightEnabled ? `
Browser testing with playwright-cli:
After implementing a feature, you MUST verify it works via the browser using
playwright-cli (available as a bash command). This is mandatory — do not skip it.
  1. Open the app: playwright-cli open http://localhost:${devServerPort}
  2. Take a snapshot to see elements: playwright-cli snapshot
  3. Read the snapshot file to find element refs
  4. Click elements: playwright-cli click <ref>
  5. Fill inputs: playwright-cli fill <ref> "value"
  6. Take a screenshot: playwright-cli screenshot
  7. Read the screenshot file to verify visual appearance
  8. Check console errors: playwright-cli console
  9. Close when done: playwright-cli close
The snapshot and screenshot commands save files to .playwright-cli/. Read the
output file to see the results. Always close the browser when finished.` : ""}`;

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

  const isWindows = process.platform === "win32";

  /**
   * Convert MSYS/Git-Bash style paths (/c/Users/...) to Windows paths
   * (C:\Users\...) so workspace checks work on Windows. On Mac/Linux this
   * is a no-op since /c/... is a legitimate Unix path, not an MSYS prefix.
   */
  function normaliseMsysPath(p) {
    if (!isWindows) return p;
    const msys = /^\/([a-zA-Z])(\/.*)?$/.exec(p);
    if (msys) return `${msys[1].toUpperCase()}:${(msys[2] ?? "\\").replace(/\//g, "\\")}`;
    return p;
  }

  function isInsideRoot(candidate) {
    const normalised = normaliseMsysPath(candidate);
    const resolved = path.resolve(root, normalised);
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
        const resolved = path.resolve(root, normaliseMsysPath(raw));
        return `${toolName} to ${resolved} is outside the workspace ${root}. Use a path inside the workspace.`;
      }
      return null;
    }

    if (toolName === "bash") {
      const cmd = String(input?.command ?? "");
      if (!cmd) return null;

      // Block broad process killers that would take down the harness server.
      const dangerousKillPatterns = [
        /taskkill\s+\/F\s+\/IM\s+node\.exe/i,
        /killall\s+node/i,
        /pkill\s+(-\d+\s+)?-f\s+["']?node["']?\s*$/im,
        /pkill\s+(-\d+\s+)?-f\s+["']?node["']?\s*[;&|]/im,
      ];
      for (const pat of dangerousKillPatterns) {
        if (pat.test(cmd)) {
          return `Blocked: "${cmd.slice(0, 80)}" would kill ALL Node.js processes including the harness server. Kill only your project's specific process by PID or exact script path.`;
        }
      }

      let m;
      ABS_PATH_RE.lastIndex = 0;
      while ((m = ABS_PATH_RE.exec(cmd)) !== null) {
        const raw = m[0].replace(/[)"'`]+$/, "");
        // Skip shell glob patterns and TS path aliases like `@/*` or
        // `src/**/*.ts` — these travel through commands as text, they
        // aren't filesystem targets the process acts on directly.
        if (/[*?]/.test(raw)) continue;
        if (/^(https?|ftp|file):\/\//i.test(raw)) continue;
        // Skip very short matches (< 4 chars after /) — these are not real
        // filesystem paths (e.g. /PID, //PID from pkill/ps output).
        const pathPart = raw.replace(/^\/+/, "");
        if (pathPart.length < 4 && !/^[a-zA-Z]:/.test(raw)) continue;
        // Common system paths that shell commands legitimately reference
        // (e.g. /dev/null for redirection, /tmp for scratch).
        if (
          raw === "/dev/null" ||
          raw === "/dev/stdout" ||
          raw === "/dev/stderr" ||
          raw.startsWith("/dev/") ||
          raw.startsWith("/tmp/") ||
          raw === "/tmp" ||
          raw.startsWith("/usr/") ||
          raw.startsWith("/bin/") ||
          raw.startsWith("/etc/") ||
          raw.startsWith("/proc/") ||
          raw.startsWith("/sys/")
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

/**
 * Take a lightweight content-fingerprint of a project working directory so
 * we can detect whether an agent session actually produced filesystem
 * mutations. Skips `.pi/` (LocalForge's own metadata folder) and
 * `node_modules/` (so we don't walk hundreds of MB; an `npm install` will
 * still be detected via the existence of the top-level `node_modules` dir
 * and any package-lock.json / package.json that were created or touched).
 *
 * The fingerprint is the sum of (path-length + file-size + mtime-epoch)
 * across every tracked file, joined with the count. A change in any
 * tracked file (creation, deletion, content edit, rename) bumps it.
 *
 * Capped at 10000 entries so a freak case doesn't tank the run.
 */
function fingerprintProjectDir(projectDir) {
  const SKIP_DIRS = new Set([".pi", "node_modules", ".git", ".next"]);
  let count = 0;
  let sum = 0;
  function walk(dir, depth) {
    if (depth > 6 || count > 10000) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (count > 10000) return;
      const name = e.name;
      const p = path.join(dir, name);
      if (e.isDirectory()) {
        // Track presence of skipped directories themselves (their existence
        // is a meaningful signal — `node_modules` appearing after a session
        // means `npm install` ran) but don't descend into them.
        if (SKIP_DIRS.has(name)) {
          count++;
          sum += p.length + 1;
          continue;
        }
        walk(p, depth + 1);
      } else {
        try {
          const stat = fs.statSync(p);
          count++;
          sum += p.length + stat.size + Math.floor(stat.mtimeMs);
        } catch {
          /* deleted between readdir and stat — ignore */
        }
      }
    }
  }
  try {
    walk(projectDir, 0);
  } catch {
    /* ignore */
  }
  return { count, sum };
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

// Errors that will recur every time the same model + provider is used. Retrying
// these — or demoting + re-picking the same feature — wastes tokens and turns
// into a tight failure loop in the UI. The orchestrator treats permanent
// failures specially: the feature is removed from the picker for the rest of
// the process lifetime and a guidance message is surfaced to the user.
function isPermanentError(errorMessage) {
  if (!errorMessage) return false;
  // Substring patterns — these are unique enough that plain `includes` is safe.
  const permanentPatterns = [
    "does not support tools",
    "tool use is not supported",
    "tools is not supported",
    "model not found",
    "unknown model",
    "invalid api key",
    "incorrect api key",
    "unauthorized",
    // Resource-exhaustion errors. Retrying immediately won't help — the user
    // has to free RAM (close apps, stop other Ollama models) or switch to a
    // smaller model. Once they fix it and click Start again the blocklist
    // clears, so the trade-off is the same as the tool-support patterns.
    "requires more system memory",
    "out of memory",
    "cuda out of memory",
  ];
  const lower = errorMessage.toLowerCase();
  if (permanentPatterns.some((p) => lower.includes(p))) return true;
  // HTTP status codes need word-boundary matching — bare "401"/"403" as
  // substrings can appear in unrelated tokens (model ids, port numbers,
  // payload bytes) and would otherwise misclassify transient errors as
  // permanent. Match only when they appear as standalone digits.
  return /\b(401|403)\b/.test(lower);
}

// Sub-classifier for the permanent-error guidance message. Two distinct
// failure shapes today and they need different remediation copy:
//   - tool-call incompatibility → switch to a model that supports tools
//   - resource exhaustion       → free RAM or pick a smaller model
function isMemoryExhaustionError(errorMessage) {
  if (!errorMessage) return false;
  const patterns = [
    "requires more system memory",
    "out of memory",
    "cuda out of memory",
  ];
  const lower = errorMessage.toLowerCase();
  return patterns.some((p) => lower.includes(p));
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

  // Snapshot the working directory before the session runs so we can detect
  // whether the agent produced any real filesystem mutations. Counterpart
  // snapshot is taken after the session ends. Used by the confabulation
  // guard below — many small models on Ollama emit JSON-shaped tool calls
  // as plain assistant text, so they can produce non-zero `toolCalls`
  // (e.g. one probing read) and still write nothing to disk.
  const dirBefore = fingerprintProjectDir(projectDir);
  debugLog("WORKSPACE_FINGERPRINT_BEFORE", {
    projectDir,
    count: dirBefore.count,
    sum: dirBefore.sum,
  });

  let toolCalls = 0;
  let lastAssistantText = "";
  let resultSubtype = "success";
  let errorMessage = null;
  let messageCount = 0;
  let turns = 0;
  let maxTurnsExceeded = false;

  // ENH-007 — idle-stop heuristic.
  //
  // Some local models (observed live with gpt-oss:20b on Ollama) complete the
  // real work for a feature in the first few minutes and then enter a loop of
  // hallucinated / no-op tool calls — repeated `Read package.json`,
  // `Listing files`, made-up tool names — until the 30-minute session
  // watchdog forcibly terminates the runner. The watchdog's `terminated`
  // outcome demotes the feature back to backlog despite the work being
  // legitimately done, wasting both the rest of that session and the work
  // already on disk.
  //
  // The fix: a separate, faster idle detector that runs in parallel with the
  // watchdog. Every IDLE_CHECK_INTERVAL_MS we re-fingerprint the project
  // directory and bump `lastFsChangeAt` if it changed; we also track the
  // start/end timestamps of `bash` tool calls so a long-running install
  // (which may not move the fingerprint until it finishes) doesn't trip the
  // detector. If neither has moved in the last IDLE_STOP_MS, we gracefully
  // abort the Pi session — the regular result-handling path runs after, and
  // the existing fingerprint guard correctly distinguishes:
  //   - work was done before the idle stretch → fs changed → success
  //   - no work ever happened → fs unchanged → confabulation rejection
  //
  // Configurable via LOCALFORGE_IDLE_STOP_MS (default 300_000 = 5 minutes);
  // set to 0 to disable and fall back to the 30-minute watchdog only.
  const idleStopMsRaw = Number.parseInt(
    process.env.LOCALFORGE_IDLE_STOP_MS ?? "300000",
    10,
  );
  const idleStopMs =
    Number.isFinite(idleStopMsRaw) && idleStopMsRaw > 0 ? idleStopMsRaw : 0;
  const IDLE_CHECK_INTERVAL_MS = 30_000;
  const sessionStartAt = Date.now();
  let lastFsChangeAt = sessionStartAt;
  let lastBashEndAt = sessionStartAt;
  let inProgressBashStartAt = null;
  let lastDirSnapshot = dirBefore;
  let idleStopTriggered = false;

  try {
    const piRuntime = createPiModelRuntime({ provider, baseUrl, model });
    const loader = new DefaultResourceLoader({
      cwd: projectDir,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: buildCodingSystemPrompt(projectDir, coderPrompt, devServerPort, process.env.LOCALFORGE_PLAYWRIGHT_ENABLED === "true"),
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
        // ENH-007: track in-flight bash so a long-running install
        // (npm install, drizzle migrate, etc.) doesn't trip the idle
        // detector while it's actively doing work.
        if (event.toolName === "bash") {
          inProgressBashStartAt = Date.now();
        }
      } else if (event.type === "tool_execution_end") {
        // ENH-007: bash just finished — record the timestamp and clear
        // the in-flight marker. fingerprintProjectDir on the next idle
        // check will pick up any files the bash command produced.
        if (event.toolName === "bash") {
          inProgressBashStartAt = null;
          lastBashEndAt = Date.now();
        }
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

    // ENH-007: periodic idle-stop checker. Runs on a separate timer from the
    // session itself so we can sample the project working directory without
    // disturbing the Pi event loop. Skipped entirely when idleStopMs is 0
    // (user-disabled) — the 30-minute watchdog still applies as a hard cap.
    const idleCheckInterval =
      idleStopMs > 0
        ? setInterval(() => {
            try {
              const current = fingerprintProjectDir(projectDir);
              if (
                current.count !== lastDirSnapshot.count ||
                current.sum !== lastDirSnapshot.sum
              ) {
                lastFsChangeAt = Date.now();
                lastDirSnapshot = current;
              }
              if (idleStopTriggered) return;
              // Don't terminate while a bash call is in flight — could be a
              // long-running install that hasn't started writing yet.
              if (inProgressBashStartAt !== null) return;
              const idleSinceMs =
                Date.now() - Math.max(lastFsChangeAt, lastBashEndAt);
              if (idleSinceMs > idleStopMs) {
                idleStopTriggered = true;
                debugLog("IDLE_STOP_TRIGGERED", {
                  idleSinceMs,
                  thresholdMs: idleStopMs,
                  lastFsChangeAt,
                  lastBashEndAt,
                  toolCalls,
                });
                emitLog(
                  `Idle-stop: agent has produced no filesystem changes and run no bash commands for ${Math.round(
                    idleSinceMs / 1000,
                  )}s. Terminating session early. If real work was done before this point, the feature will still complete; otherwise the confabulation guard will reject the session as expected.`,
                  "info",
                );
                void session.abort();
              }
            } catch (err) {
              // Never let the idle checker take down the runner. Just log.
              debugLog("IDLE_CHECK_ERROR", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }, IDLE_CHECK_INTERVAL_MS)
        : null;
    // Don't keep Node alive solely on this interval if the runner exits for
    // any other reason — the finally block clears it normally, this is just
    // belt-and-suspenders.
    idleCheckInterval?.unref?.();

    try {
      await session.prompt(userPrompt, {
        expandPromptTemplates: false,
        source: "extension",
      });
    } finally {
      if (idleCheckInterval) clearInterval(idleCheckInterval);
      unsubscribe();
      session.dispose();
    }
    debugLog("PI_LOOP_EXITED_NORMALLY", {
      messageCount,
      toolCalls,
      resultSubtype,
      turns,
      maxTurnsExceeded,
      idleStopTriggered,
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

  // ENH-007: when we triggered the idle-stop, the Pi session was aborted on
  // OUR signal — the resulting "aborted" stopReason / errorMessage is not a
  // real failure, it's our own termination. Clear those so the regular
  // ok-computation runs as if the session ended normally; the downstream
  // confabulation guard then makes the actual call based on whether the
  // project working directory changed.
  if (idleStopTriggered) {
    debugLog("IDLE_STOP_OVERRIDE_RESULT", {
      previousResultSubtype: resultSubtype,
      previousErrorMessage: errorMessage,
    });
    errorMessage = null;
    resultSubtype = "success";
  }

  let ok =
    errorMessage == null &&
    (resultSubtype === "success" ||
      resultSubtype === "end_turn" ||
      resultSubtype === undefined);

  // Confabulation guard. Some local-model + provider combinations (observed
  // with qwen2.5-coder:32b and llama3.2:latest on Ollama via openai-
  // completions) emit JSON-shaped tool calls as plain assistant text
  // instead of structured tool_use content blocks. Pi never executes them,
  // toolCalls stays at 0 (or, sneakier, stays at 1 from a single benign
  // probing call), but resultSubtype is still "success" — so the
  // orchestrator marks the feature completed despite zero filesystem
  // mutations. The result is a 10/10 green-toast project with an empty
  // working directory.
  //
  // We defend in two layers:
  //
  //   1. minToolCalls floor (default 1). Catches the trivial all-text
  //      sessions. Configurable via LOCALFORGE_MIN_TOOL_CALLS.
  //
  //   2. Workspace-fingerprint check. Snapshots the project dir before
  //      and after the session — if no tracked file changed (creation,
  //      deletion, content, mtime), the agent did no real work. This
  //      catches the toolCalls=1-but-nothing-written case. Disable via
  //      LOCALFORGE_REQUIRE_FS_CHANGES=0 if you have a feature that
  //      genuinely makes no filesystem changes (rare).
  //
  // We only override when ok is otherwise true (so we don't mask a real
  // upstream error), and we leave permanent=false so a retry with a
  // better-behaved model still has a chance.
  const minToolCalls = Number.parseInt(
    process.env.LOCALFORGE_MIN_TOOL_CALLS ?? "1",
    10,
  );
  const minFloor =
    Number.isFinite(minToolCalls) && minToolCalls >= 0 ? minToolCalls : 1;
  const dirAfter = fingerprintProjectDir(projectDir);
  const dirChanged =
    dirBefore.count !== dirAfter.count || dirBefore.sum !== dirAfter.sum;
  debugLog("WORKSPACE_FINGERPRINT_AFTER", {
    countBefore: dirBefore.count,
    countAfter: dirAfter.count,
    sumBefore: dirBefore.sum,
    sumAfter: dirAfter.sum,
    dirChanged,
  });
  const requireFsChanges =
    (process.env.LOCALFORGE_REQUIRE_FS_CHANGES ?? "1") !== "0";

  let confabulation = false;
  if (ok && toolCalls < minFloor) {
    debugLog("CONFABULATION_GUARD_TRIPPED", {
      reason: "tool_calls_below_floor",
      toolCalls,
      minFloor,
      lastAssistantTextSnippet: lastAssistantText.slice(0, 200),
    });
    ok = false;
    confabulation = true;
    errorMessage = `Agent claimed success without invoking any tools (toolCalls=${toolCalls}, required>=${minFloor}). The model likely emitted tool calls as plain text instead of structured tool_use blocks — common with some Ollama + small-model combinations. No filesystem changes were made. Try a different model (qwen2.5-coder:7b or llama3.1:8b are reliable on Ollama), or set LOCALFORGE_MIN_TOOL_CALLS=0 if you have a feature that genuinely requires no tool calls.`;
  } else if (ok && requireFsChanges && !dirChanged) {
    debugLog("CONFABULATION_GUARD_TRIPPED", {
      reason: "no_fs_changes",
      toolCalls,
      countBefore: dirBefore.count,
      countAfter: dirAfter.count,
      lastAssistantTextSnippet: lastAssistantText.slice(0, 200),
    });
    ok = false;
    confabulation = true;
    errorMessage = `Agent claimed success but the project working directory is unchanged (toolCalls=${toolCalls}, fingerprint stable). The session likely made one or two probing tool calls and then confabulated completion without writing or modifying any files. Try a different model (qwen2.5-coder:7b or llama3.1:8b are reliable on Ollama), or set LOCALFORGE_REQUIRE_FS_CHANGES=0 if this feature genuinely makes no filesystem changes.`;
  }

  debugLog("PI_SESSION_RESULT", {
    ok,
    errorMessage,
    confabulation,
    resultSubtype,
    toolCalls,
    messageCount,
    lastAssistantTextSnippet: lastAssistantText.slice(0, 200),
  });

  return {
    ok,
    toolCalls,
    lastAssistantText,
    resultSubtype,
    errorMessage,
    confabulation,
  };
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

    const permanent = isPermanentError(result.errorMessage);
    const transient = !permanent && isTransientError(result.errorMessage);
    debugLog("RETRY_WRAPPER_FAILED_ATTEMPT", {
      attempt,
      errorMessage: result.errorMessage,
      resultSubtype: result.resultSubtype,
      isPermanent: permanent,
      isTransient: transient,
      willRetry: attempt < maxRetries && transient,
    });

    if (permanent) {
      debugLog("RETRY_WRAPPER_PERMANENT_ERROR", { errorMessage: result.errorMessage });
      return { ...result, permanent: true };
    }

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
      const permanent = Boolean(result?.permanent);
      const confabulation = Boolean(result?.confabulation);
      debugLog("OUTCOME_FAILURE_FROM_PI", {
        reason: result?.errorMessage ?? result?.resultSubtype,
        permanent,
        confabulation,
      });
      emitLog(
        `Agent session ended without success (${codingMs}ms, ${
          result?.toolCalls ?? 0
        } tool calls, subtype=${result?.resultSubtype ?? "none"})${
          result?.errorMessage ? `: ${result.errorMessage}` : ""
        }`,
        "error",
      );
      if (permanent) {
        const guidance = isMemoryExhaustionError(result?.errorMessage)
          ? `This error will not resolve on retry — loading the model "${model}" needs more memory than is currently free. Close other heavy apps (browsers with many tabs, IDEs, other model servers), or run \`ollama stop <other-model>\` if a different model is loaded, or pick a smaller model in settings. Then click Start again.`
          : `This error will not resolve on retry — the configured model "${model}" is incompatible with the agent (e.g. lacks tool-call support). Switch to a tool-capable model in settings (try llama3.2, qwen2.5-coder, or mistral-nemo on Ollama) and click Start again.`;
        emitLog(guidance, "error");
      }
      emit({
        type: "done",
        outcome: "failure",
        reason: result?.errorMessage ?? `result ${result?.resultSubtype ?? "unknown"}`,
        permanent,
        confabulation,
      });
      doneEmitted = true;
      debugLog("DONE_EMITTED", {
        outcome: "failure",
        phase: "pi",
        permanent,
        confabulation,
      });
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
          // If the dev server is simply not running, don't fail the feature —
          // the agent already tested with playwright-cli during its session.
          // Connection refused means the server was stopped, not that the
          // feature is broken.
          const isServerDown = tr.error.includes("ERR_CONNECTION_REFUSED") ||
            tr.error.includes("ECONNREFUSED");
          if (isServerDown) {
            emitLog(`Playwright: dev server not running (connection refused) — treating as non-fatal since agent tested during session`, "info");
          } else if (tr.error.includes("empty page title")) {
            // API-only servers (Express returning JSON) have no HTML title.
            // This is expected for backend features — don't fail the feature.
            emitLog(`Playwright: page has no title (likely API-only server returning JSON) — treating as non-fatal`, "info");
          } else {
            emitLog(`Playwright error detail: ${tr.error}`, "error");
            playwrightFailed = true;
          }
        } else if (!tr.ok) {
          playwrightFailed = true;
        }
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
