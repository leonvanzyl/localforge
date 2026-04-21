#!/usr/bin/env node
/**
 * Smoke: spawn agent-runner.mjs in "success" mode, capture its stdout, and
 * assert that both a test_result log and a screenshot log are emitted with
 * the expected shapes. This does not touch the DB or the orchestrator — it
 * exercises the runner in isolation, so it's safe to run against any dev
 * server without picking up queued features.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(root, "scripts", "agent-runner.mjs");

// We spawn the runner with a made-up session/feature id. The runner emits
// NDJSON log entries and one "done" frame. We just parse that stdout to
// verify behaviour; nothing is persisted.
const child = spawn(
  process.execPath,
  [
    runner,
    "--session",
    "999",
    "--feature",
    "9999",
    "--title",
    "SMOKE_TEST_FEATURE",
    "--duration",
    "100",
    "--outcome",
    "success",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      BASE_URL: "http://localhost:7777",
    },
    stdio: ["ignore", "pipe", "inherit"],
  },
);

let buffer = "";
const lines = [];
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.trim()) lines.push(line);
  }
});

await new Promise((resolve) => child.on("exit", resolve));

const frames = lines.map((l) => {
  try {
    return JSON.parse(l);
  } catch {
    return null;
  }
}).filter(Boolean);

const testResult = frames.find(
  (f) => f.type === "log" && f.messageType === "test_result",
);
const screenshot = frames.find(
  (f) => f.type === "log" && f.messageType === "screenshot",
);
const done = frames.find((f) => f.type === "done");

console.log("test_result frame:", testResult?.message);
console.log("screenshot frame:", screenshot?.message, "path=", screenshot?.screenshotPath);
console.log("done frame:", done);

let fail = false;
if (!testResult) {
  console.error("MISSING test_result log");
  fail = true;
}
if (!testResult || !/npx playwright test completed/.test(testResult.message)) {
  console.error(
    "test_result message does not contain 'npx playwright test completed'",
  );
  fail = true;
}
if (!screenshot) {
  console.error("MISSING screenshot log");
  fail = true;
}
if (!screenshot?.screenshotPath) {
  console.error("screenshot log has empty screenshotPath");
  fail = true;
}
if (screenshot?.screenshotPath) {
  const abs = path.join(root, screenshot.screenshotPath);
  if (!fs.existsSync(abs)) {
    console.error("screenshot file does not exist on disk:", abs);
    fail = true;
  }
}
if (!done || done.outcome !== "success") {
  console.error("expected done{outcome:success}, got:", done);
  fail = true;
}

if (fail) {
  console.log("SMOKE FAILED");
  process.exit(1);
}
console.log("SMOKE OK");
