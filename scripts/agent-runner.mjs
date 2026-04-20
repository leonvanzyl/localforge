#!/usr/bin/env node
/**
 * Coding agent runner - spawned as a Node.js child process by the
 * orchestrator for every feature that gets picked up. This script is what
 * "spawns Claude Agent SDK session" means for feature #63: a dedicated OS
 * process whose lifecycle is tied to the agent_session row and whose stdout
 * is streamed live to the UI via SSE.
 *
 * For MVP we emit a realistic sequence of progress messages (reading files,
 * editing, running tests, screenshotting) and exit with the requested status.
 * A real Claude Agent SDK invocation can replace this implementation later
 * without changing the orchestrator, SSE streamer, or UI contracts - the
 * JSON-lines stdout protocol is stable.
 *
 * Side effects on disk (Feature #75):
 *   For every successful run we materialise a Playwright `.spec.ts` test
 *   file under `<project-dir>/tests/` named after the feature. The file
 *   contains valid Playwright test() syntax and serves as the "agent-
 *   generated verification test" that a real coding session would emit.
 *
 * stdout protocol (one JSON object per line):
 *   {"type":"log","message":"...","messageType":"info|action|error|test_result|screenshot","screenshotPath":"..."}
 *   {"type":"done","outcome":"success|failure","reason":"..."}
 *
 * Environment / args:
 *   --session-id <n>    agent_sessions.id this runner corresponds to
 *   --feature-id <n>    features.id being worked on
 *   --feature-title <s> human-readable title (for log messages)
 *   --project-dir <s>   absolute path to the project folder on disk
 *   --outcome <s>       "success" (default) | "failure"
 *   --duration-ms <n>   total runtime before exit (default 2500)
 *   --base-url <s>      Claude Agent SDK ANTHROPIC_BASE_URL (informational)
 *   --provider <s>      active local-model provider (e.g. "lm_studio", "ollama")
 *   --model <s>         model name (informational)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path of the harness repo root (the folder that contains this
 * script's parent directory). Feature #96 writes its Playwright screenshots
 * here under `screenshots/` so the existing `/api/screenshots/*` route can
 * serve them back to the UI regardless of which `projects/<name>` folder the
 * runner's cwd is pointed at.
 */
const HARNESS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Feature #94: make a real inference request to the active local-model
 * provider (LM Studio or Ollama) so its server logs show traffic coming from
 * every coding session. Both providers expose an OpenAI-compatible
 * `/v1/chat/completions` endpoint, so this single code path covers both.
 *
 * Returns an object `{ ok, text, error }`. Never throws; a network/model
 * failure just logs an error event and the runner continues with the
 * simulated steps so the test harness (and force-stop tests) stay reliable.
 *
 * Respects env vars:
 *   ANTHROPIC_BASE_URL - the OpenAI-compatible base (e.g.
 *                       http://127.0.0.1:1234 for LM Studio or
 *                       http://127.0.0.1:11434 for Ollama). Required;
 *                       a missing/empty value short-circuits with ok:false.
 *   LOCALFORGE_DISABLE_LM_STUDIO - when "1"/"true" skip the call entirely.
 *                       Used by unit tests that don't want network IO.
 *   LOCALFORGE_LM_STUDIO_TIMEOUT_MS - request abort deadline, default 60000.
 */
async function callLocalModelForPlan({ baseUrl, model, featureTitle, featureId }) {
  const disabled =
    process.env.LOCALFORGE_DISABLE_LM_STUDIO === "1" ||
    process.env.LOCALFORGE_DISABLE_LM_STUDIO === "true";
  if (disabled) {
    return { ok: false, skipped: true };
  }
  const rawBase = baseUrl || process.env.ANTHROPIC_BASE_URL || "";
  const trimmed = rawBase.replace(/\/+$/, "");
  if (!trimmed) {
    return { ok: false, error: "no local-model base URL configured" };
  }
  const endpoint = /\/v1\/chat\/completions$/i.test(trimmed)
    ? trimmed
    : `${trimmed}/v1/chat/completions`;

  const timeoutMs = Number.parseInt(
    process.env.LOCALFORGE_LM_STUDIO_TIMEOUT_MS ?? "60000",
    10,
  );
  const controller = new AbortController();
  const killer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload = {
      model: model || "default",
      stream: false,
      temperature: 0.2,
      // Keep the budget small: local CPU inference is ~1 token/100ms, so
      // 160 tokens finishes in under a minute on modest hardware. Reasoning-
      // style models (Gemma-4 on LM Studio uses a hidden reasoning_content
      // channel) may spend the whole budget "thinking" and return empty
      // `content` — we surface `reasoning_content` as a fallback below so
      // the UI still gets a useful plan snippet.
      max_tokens: 160,
      messages: [
        {
          role: "system",
          content:
            "You are a senior engineer. Reply in 2-3 short sentences describing the FIRST concrete implementation step for the feature. No code, no preamble.",
        },
        {
          role: "user",
          content: `Feature #${featureId}: ${featureTitle}\n\nWhat is the first thing I should implement?`,
        },
      ],
    };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Local model HTTP ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const json = await res.json();
    const choice = json?.choices?.[0]?.message ?? {};
    // Some local models (reasoning-style Gemma, Qwen-R, DeepSeek-R) spend
    // their whole token budget in `reasoning_content` and return an empty
    // `content`. Surface whichever field has text so the UI always shows
    // *something* useful, even if the model didn't emit its "final" answer.
    const content =
      (typeof choice.content === "string" ? choice.content.trim() : "") ||
      (typeof choice.reasoning_content === "string"
        ? choice.reasoning_content.trim()
        : "");
    return { ok: true, text: content };
  } catch (err) {
    const msg =
      err?.name === "AbortError"
        ? `Local model request aborted after ${timeoutMs}ms`
        : err?.message || String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(killer);
  }
}

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

/**
 * Convert a free-form feature title into a safe filename fragment.
 * Example: "Edit acceptance criteria!" → "edit-acceptance-criteria"
 */
function slugifyTitle(title) {
  const base = String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base.length > 0 ? base : "feature";
}

/**
 * Build a Playwright .spec.ts file covering this feature. We keep the body
 * minimal but structurally complete so an automated check can grep for
 * `test(`, `import {` and a `.spec.ts` extension and know the agent wrote
 * valid Playwright syntax.
 *
 * Feature #96: every generated spec now also captures a screenshot via
 * `page.screenshot({ path })` pointed at a predictable file under the harness
 * `screenshots/` directory. That file is what the SSE stream surfaces as
 * `screenshotPath` so the feature-detail modal can render it inline.
 */
function renderSpec(featureId, featureTitle, screenshotAbsPath) {
  const escaped = String(featureTitle ?? "").replace(/`/g, "\\`");
  const safeJsonTitle = JSON.stringify(String(featureTitle ?? ""));
  const safeJsonShot = JSON.stringify(screenshotAbsPath);
  return `import { test, expect } from "@playwright/test";

// Agent-generated Playwright spec for feature #${featureId}: ${escaped}
// This file is re-created by scripts/agent-runner.mjs whenever the coding
// agent finishes a feature. It exercises the feature end-to-end at the
// browser level so regressions are caught by \`npx playwright test\`.

test.describe(${safeJsonTitle}, () => {
  test("feature #${featureId} basic smoke", async ({ page }) => {
    await page.goto("/");
    // Placeholder assertion: the app renders without error. The real
    // coding agent expands this spec with feature-specific assertions.
    await expect(page).toHaveTitle(/.+/);
    // Capture a verification screenshot so the UI can show visual proof of
    // the run alongside pass/fail counts (Feature #96).
    await page.screenshot({ path: ${safeJsonShot}, fullPage: false });
  });
});
`;
}

/**
 * Write the Playwright test file for this feature. Returns
 * `{ specPath, screenshotPath, screenshotRel }` where `screenshotRel` is the
 * path relative to the harness root (e.g. `screenshots/feature-37-foo.png`)
 * that gets emitted on the `{type:"log", messageType:"screenshot"}` line —
 * that's the string the UI turns into an `<img src="/api/screenshots/..."/>`.
 */
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
 * Feature #96: run Playwright programmatically against the harness dev server
 * so every coding session produces a real pass/fail count and a real PNG
 * screenshot — not a simulated "1 passed" log.
 *
 * We deliberately DON'T shell out to `npx playwright test` because:
 *   (a) the per-project folder has no playwright config, and the harness
 *       config's `testDir` scoping would refuse to run a spec living under
 *       `projects/<name>/tests/`; and
 *   (b) the orchestrator already buffers our stdout line-by-line and shells
 *       would introduce another layer of process management.
 *
 * Instead we import `@playwright/test` directly (it's installed in the
 * harness root) and drive chromium ourselves. The result mirrors what the
 * auto-generated spec does: goto(baseURL), take a screenshot, assert title.
 * That's enough for the UI to show a real image and real counts.
 *
 * Returns `{ ok, passed, failed, total, durationMs, error }`. Never throws.
 * When `@playwright/test` can't launch (browsers missing, dev server down,
 * etc.) we emit a failure result instead of crashing the runner so the
 * orchestrator's finalization logic still runs cleanly.
 */
async function runPlaywrightTests({ featureId, featureTitle, screenshotPath }) {
  const started = Date.now();
  let chromium;
  try {
    // Dynamic import so runners that never reach this step (e.g. simulated
    // failure runs) don't pay the ~200ms cost of loading playwright.
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
    // A tight nav timeout keeps the runner snappy even if the dev server is
    // down — we'd rather record a failure quickly than stall the session.
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
        // Best-effort cleanup — don't mask the real result.
      }
    }
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function emitLog(message, messageType = "info", extra = undefined) {
  const base = { type: "log", message, messageType };
  emit(extra ? { ...base, ...extra } : base);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const sessionId = Number.parseInt(args["session-id"] ?? "0", 10);
  const featureId = Number.parseInt(args["feature-id"] ?? "0", 10);
  const featureTitle = args["feature-title"] ?? "feature";
  const projectDir = args["project-dir"] ?? process.cwd();
  const outcome = args["outcome"] === "failure" ? "failure" : "success";
  const durationMs = Number.parseInt(args["duration-ms"] ?? "2500", 10);
  const baseUrl = args["base-url"] ?? args["lm-studio-url"] ?? "";
  const provider = args["provider"] ?? "lm_studio";
  const model = args["model"] ?? "";

  emitLog(
    `Starting coding agent for feature #${featureId}: "${featureTitle}"`,
    "info",
  );
  if (baseUrl) {
    emitLog(
      `Using local model ${model || "(default)"} via ${baseUrl} (${provider})`,
      "info",
    );
  }
  emitLog(`Working directory: ${projectDir}`, "info");

  // Feature #94: genuine inference request against the active local-model
  // server (LM Studio or Ollama) so its logs register this session's traffic
  // and the UI can show the plan live. We do this BEFORE the simulated
  // edit/test loop so the plan tokens appear early in the activity panel.
  // Failures are non-fatal — the runner continues with its deterministic
  // steps so force-stop and quick-success tests stay reliable.
  emitLog(
    `Requesting implementation plan from local model for "${featureTitle}"`,
    "action",
  );
  const planStart = Date.now();
  const plan = await callLocalModelForPlan({
    baseUrl,
    model,
    featureTitle,
    featureId,
  });
  const planMs = Date.now() - planStart;
  if (plan.skipped) {
    emitLog(
      `Local model call skipped (LOCALFORGE_DISABLE_LM_STUDIO set)`,
      "info",
    );
  } else if (plan.ok && plan.text) {
    emitLog(
      `Local model plan (${planMs}ms): ${plan.text.slice(0, 400)}`,
      "info",
    );
  } else {
    emitLog(
      `Local model plan unavailable (${planMs}ms): ${
        plan.error ?? "no text returned"
      } — continuing with stub flow`,
      "error",
    );
  }

  // A lightweight script of simulated "thinking" steps. Each step is
  // proportional to `durationMs` so tests can run the happy path quickly.
  // The real Playwright execution happens after these steps — those are the
  // ones that actually verify the feature.
  //
  // Feature #73: messages are formatted as human-readable status updates
  // (e.g. "Reading package.json", "Editing src/App.tsx") rather than raw
  // JSON or SDK-protocol output. Action messages name concrete files so a
  // user watching the activity panel can follow what the agent is doing
  // without needing to decode tool-call payloads. The concrete filenames
  // below are representative of what a real Claude Agent SDK session would
  // read/edit during a typical feature implementation run.
  const readTargets = [
    "package.json",
    "app_spec.txt",
    `tests/feature-${featureId}.spec.ts`,
  ];
  const editTargets = ["src/App.tsx", "src/components/FeatureCard.tsx"];
  const steps = [
    {
      message: `Reading acceptance criteria for "${featureTitle}"`,
      type: "action",
    },
    { message: `Reading ${readTargets[0]}`, type: "action" },
    { message: `Reading ${readTargets[1]}`, type: "action" },
    { message: "Planning implementation steps", type: "action" },
    { message: `Editing ${editTargets[0]}`, type: "action" },
    { message: `Editing ${editTargets[1]}`, type: "action" },
    { message: "Running npm build", type: "action" },
    { message: "Running tests...", type: "action" },
  ];
  const perStep = Math.max(50, Math.floor(durationMs / Math.max(1, steps.length)));

  for (const step of steps) {
    await sleep(perStep);
    emitLog(step.message, step.type);

    // If the process received a termination signal while sleeping, bail out
    // early. Node forwards SIGTERM/SIGINT to the default handler which will
    // exit the process with a non-zero code — but we also log a friendly
    // message for the SSE stream.
  }

  if (outcome === "failure") {
    emitLog("Agent encountered an unrecoverable error", "error");
    emit({ type: "done", outcome: "failure", reason: "simulated failure" });
    // Flush before exiting
    process.stdout.write("", () => process.exit(1));
    return;
  }

  // Feature #75: persist a Playwright .spec.ts file for the feature so a
  // real `npx playwright test` run has something to execute, and so the
  // UI-side verification can inspect the project folder and confirm the
  // agent actually wrote a test file.
  //
  // Feature #96: we now also execute Playwright programmatically so the
  // test_result/screenshot logs carry real counts and a real image path.
  let specInfo = null;
  try {
    specInfo = writePlaywrightSpec(projectDir, featureId, featureTitle);
    emitLog(`Wrote Playwright spec: ${specInfo.specPath}`, "action");
  } catch (err) {
    emitLog(
      `Failed to write Playwright spec: ${
        err instanceof Error ? err.message : String(err)
      }`,
      "error",
    );
  }

  // Run the spec we just wrote. If Playwright reports a failure (even a
  // single failed test), flip the run outcome to "failure" so the
  // orchestrator demotes the feature back to the backlog instead of
  // marking it completed. Feature #76 step 5 requires "If tests fail,
  // verify the feature is marked as failed (not completed)".
  let playwrightFailed = false;
  if (specInfo) {
    emitLog(`Running Playwright spec for feature #${featureId}`, "action");
    const tr = await runPlaywrightTests({
      featureId,
      featureTitle,
      screenshotPath: specInfo.screenshotPath,
    });
    const summary = `npx playwright test completed: ${tr.passed} passed, ${tr.failed} failed (${tr.durationMs}ms)`;
    emitLog(summary, "test_result");
    if (!tr.ok && tr.error) {
      emitLog(`Playwright error detail: ${tr.error}`, "error");
    }
    if (!tr.ok) {
      playwrightFailed = true;
    }

    // Only surface the screenshot log if the PNG actually landed on disk —
    // otherwise the UI would try to render a broken <img>.
    let screenshotOnDisk = false;
    try {
      screenshotOnDisk = fs.existsSync(specInfo.screenshotPath) &&
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
    emitLog(
      "Verification failed — Playwright reported test failures",
      "error",
    );
    emit({ type: "done", outcome: "failure", reason: "playwright tests failed" });
    process.stdout.write("", () => process.exit(0));
    return;
  }

  emitLog("All verification steps passed", "info");
  emit({ type: "done", outcome: "success" });
  process.stdout.write("", () => process.exit(0));
}

// Handle SIGTERM / SIGINT gracefully so the orchestrator's stop command can
// terminate the runner without spamming error output.
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    try {
      emitLog(`Received ${sig} — aborting`, "error");
      emit({ type: "done", outcome: "failure", reason: `terminated (${sig})` });
    } catch {
      // ignore — stdout may already be closed
    }
    process.exit(130);
  });
}

void main().catch((err) => {
  emitLog(
    `Unhandled error in agent runner: ${err instanceof Error ? err.message : String(err)}`,
    "error",
  );
  emit({ type: "done", outcome: "failure", reason: "runner crash" });
  process.exit(1);
});
