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
 *                             run navigates to. Defaults to http://localhost:3000.
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

  const baseUrl = process.env.LOCALFORGE_PLAYWRIGHT_BASE_URL || "http://localhost:3000";
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

const CODING_SYSTEM_PROMPT = `You are LocalForge's coding agent.

You have been handed ONE backlog feature for a local project. Your current
working directory is the project root. Implement the feature end-to-end using
the tools available to you (Read, Write, Edit, Bash, Grep, Glob).

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

async function runCodingAgent({ feature, projectDir, baseUrl, model, abort }) {
  const maxTurns = Number.parseInt(
    process.env.LOCALFORGE_MAX_TURNS ?? "100",
    10,
  );
  const userPrompt = buildUserPrompt(feature);

  let toolCalls = 0;
  let lastAssistantText = "";
  let resultSubtype;
  let errorMessage = null;

  try {
    for await (const message of query({
      prompt: userPrompt,
      options: {
        systemPrompt: CODING_SYSTEM_PROMPT,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
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
      if (message.type === "assistant") {
        const blocks = Array.isArray(message?.message?.content)
          ? message.message.content
          : [];
        for (const block of blocks) {
          if (!block || typeof block !== "object") continue;
          if (block.type === "tool_use" && typeof block.name === "string") {
            toolCalls++;
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
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const ok =
    errorMessage == null &&
    (resultSubtype === "success" ||
      resultSubtype === "end_turn" ||
      resultSubtype === undefined);
  return { ok, toolCalls, lastAssistantText, resultSubtype, errorMessage };
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

  const fileFeature = readFeaturePromptFile(promptFile);
  const feature = {
    id: featureId,
    title: fileFeature?.title ?? featureTitleArg,
    description: fileFeature?.description ?? null,
    acceptanceCriteria: fileFeature?.acceptanceCriteria ?? null,
  };

  emitLog(
    `Starting Claude Agent SDK session for feature #${featureId}: "${feature.title}"`,
    "info",
  );
  if (!baseUrl) {
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
  // Map SIGTERM/SIGINT to the SDK's AbortController so the agent quits its
  // current turn cleanly instead of leaving HTTP requests dangling.
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      try {
        emitLog(`Received ${sig} — aborting`, "error");
        abort.abort();
        emit({ type: "done", outcome: "failure", reason: `terminated (${sig})` });
      } catch {
        /* stdout may already be closed */
      }
      // Give the SDK a brief moment to unwind, then force-exit.
      setTimeout(() => process.exit(130), 250).unref();
    });
  }

  const codingStart = Date.now();
  const result = await runCodingAgent({
    feature,
    projectDir,
    baseUrl,
    model,
    abort,
  });
  const codingMs = Date.now() - codingStart;

  if (!result.ok) {
    emitLog(
      `Agent session ended without success (${codingMs}ms, ${
        result.toolCalls
      } tool calls, subtype=${result.resultSubtype ?? "none"})${
        result.errorMessage ? `: ${result.errorMessage}` : ""
      }`,
      "error",
    );
    emit({
      type: "done",
      outcome: "failure",
      reason: result.errorMessage ?? `result ${result.resultSubtype ?? "unknown"}`,
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

  // Write + run a Playwright spec to verify the change boots in the browser.
  // This produces the `test_result` / `screenshot` log lines the kanban card
  // badge parses (tests/feat96-card-badge.spec.ts).
  let specInfo = null;
  try {
    specInfo = writePlaywrightSpec(projectDir, featureId, feature.title);
    emitLog(`Wrote Playwright spec: ${specInfo.specPath}`, "action");
  } catch (err) {
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
    const tr = await runPlaywrightTests({
      featureId,
      featureTitle: feature.title,
      screenshotPath: specInfo.screenshotPath,
    });
    const summary = `npx playwright test completed: ${tr.passed} passed, ${tr.failed} failed (${tr.durationMs}ms)`;
    emitLog(summary, "test_result");
    if (!tr.ok && tr.error) {
      emitLog(`Playwright error detail: ${tr.error}`, "error");
    }
    if (!tr.ok) playwrightFailed = true;

    let screenshotOnDisk = false;
    try {
      screenshotOnDisk =
        fs.existsSync(specInfo.screenshotPath) &&
        fs.statSync(specInfo.screenshotPath).size > 0;
    } catch {
      screenshotOnDisk = false;
    }
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
  }

  if (playwrightFailed) {
    emitLog("Verification failed — Playwright reported test failures", "error");
    emit({ type: "done", outcome: "failure", reason: "playwright tests failed" });
    process.stdout.write("", () => process.exit(0));
    return;
  }

  emitLog("All verification steps passed", "info");
  emit({ type: "done", outcome: "success" });
  process.stdout.write("", () => process.exit(0));
}

void main().catch((err) => {
  emitLog(
    `Unhandled error in agent runner: ${err instanceof Error ? err.message : String(err)}`,
    "error",
  );
  emit({ type: "done", outcome: "failure", reason: "runner crash" });
  process.exit(1);
});
