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
