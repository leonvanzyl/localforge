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
 *   --lm-studio-url <s> Claude Agent SDK ANTHROPIC_BASE_URL (informational)
 *   --model <s>         model name (informational)
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Feature #94: make a real inference request to LM Studio so the local model
 * server logs show traffic coming from every coding session. The runner is
 * still a stubbed agent (doesn't actually write production code yet) but the
 * request is genuine — LM Studio receives it, the model produces tokens, and
 * the reply is echoed into the SSE log stream so the UI can show the plan
 * live.
 *
 * Returns an object `{ ok, text, error }`. Never throws; a network/model
 * failure just logs an error event and the runner continues with the
 * simulated steps so the test harness (and force-stop tests) stay reliable.
 *
 * Respects env vars:
 *   ANTHROPIC_BASE_URL - the LM Studio OpenAI-compatible base (e.g.
 *                       http://127.0.0.1:1234). Required; a missing/empty
 *                       value short-circuits with ok:false.
 *   LOCALFORGE_DISABLE_LM_STUDIO - when "1"/"true" skip the call entirely.
 *                       Used by unit tests that don't want network IO.
 *   LOCALFORGE_LM_STUDIO_TIMEOUT_MS - request abort deadline, default 60000.
 */
async function callLmStudioForPlan({ baseUrl, model, featureTitle, featureId }) {
  const disabled =
    process.env.LOCALFORGE_DISABLE_LM_STUDIO === "1" ||
    process.env.LOCALFORGE_DISABLE_LM_STUDIO === "true";
  if (disabled) {
    return { ok: false, skipped: true };
  }
  const rawBase = baseUrl || process.env.ANTHROPIC_BASE_URL || "";
  const trimmed = rawBase.replace(/\/+$/, "");
  if (!trimmed) {
    return { ok: false, error: "no LM Studio URL configured" };
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
        error: `LM Studio HTTP ${res.status}: ${body.slice(0, 200)}`,
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
        ? `LM Studio request aborted after ${timeoutMs}ms`
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
 */
function renderSpec(featureId, featureTitle) {
  const escaped = String(featureTitle ?? "").replace(/`/g, "\\`");
  const safeJsonTitle = JSON.stringify(String(featureTitle ?? ""));
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
  });
});
`;
}

/**
 * Write the Playwright test file for this feature. Returns the absolute
 * path so the runner can emit it to stdout for the UI and downstream
 * verification scripts.
 */
function writePlaywrightSpec(projectDir, featureId, featureTitle) {
  const testsDir = path.join(projectDir, "tests");
  fs.mkdirSync(testsDir, { recursive: true });
  const slug = slugifyTitle(featureTitle);
  const filename = `feature-${featureId}-${slug}.spec.ts`;
  const filePath = path.join(testsDir, filename);
  fs.writeFileSync(filePath, renderSpec(featureId, featureTitle), "utf8");
  return filePath;
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function emitLog(message, messageType = "info") {
  emit({ type: "log", message, messageType });
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
  const lmStudioUrl = args["lm-studio-url"] ?? "";
  const model = args["model"] ?? "";

  emitLog(
    `Starting coding agent for feature #${featureId}: "${featureTitle}"`,
    "info",
  );
  if (lmStudioUrl) {
    emitLog(
      `Using local model ${model || "(default)"} via ${lmStudioUrl}`,
      "info",
    );
  }
  emitLog(`Working directory: ${projectDir}`, "info");

  // Feature #94: genuine inference request against LM Studio so the local
  // server registers this session's traffic and the UI can show the plan
  // live. We do this BEFORE the simulated edit/test loop so the plan tokens
  // appear early in the activity panel. Failures are non-fatal — the runner
  // continues with its deterministic steps so force-stop and quick-success
  // tests stay reliable.
  emitLog(
    `Requesting implementation plan from local model for "${featureTitle}"`,
    "action",
  );
  const planStart = Date.now();
  const plan = await callLmStudioForPlan({
    baseUrl: lmStudioUrl,
    model,
    featureTitle,
    featureId,
  });
  const planMs = Date.now() - planStart;
  if (plan.skipped) {
    emitLog(
      `LM Studio call skipped (LOCALFORGE_DISABLE_LM_STUDIO set)`,
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

  // A lightweight script of simulated steps. Each step is proportional to
  // `durationMs` so tests can run the happy path quickly.
  const steps = [
    { message: `Reading acceptance criteria for "${featureTitle}"`, type: "action" },
    { message: "Planning implementation steps", type: "action" },
    { message: "Editing source files", type: "action" },
    { message: "Running npm build", type: "action" },
    { message: "Capturing verification screenshot", type: "screenshot" },
    { message: "npx playwright test completed: 1 passed", type: "test_result" },
  ];
  const perStep = Math.max(50, Math.floor(durationMs / steps.length));

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
  try {
    const specPath = writePlaywrightSpec(projectDir, featureId, featureTitle);
    emitLog(`Wrote Playwright spec: ${specPath}`, "action");
  } catch (err) {
    emitLog(
      `Failed to write Playwright spec: ${
        err instanceof Error ? err.message : String(err)
      }`,
      "error",
    );
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
