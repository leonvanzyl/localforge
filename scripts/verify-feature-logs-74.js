// E2E verification for Feature #74: per-feature agent logs are stored in the
// database (agent_logs rows carry both feature_id AND session_id) and can be
// read back via GET /api/features/:id/logs.
//
// Scenario:
//   - Create a project + feature.
//   - Run the orchestrator once with a short durationMs so the feature
//     completes quickly. Poll until the feature status = 'completed'.
//   - Fetch GET /api/features/:id/logs and assert:
//       * >0 log rows returned
//       * every row has feature_id === our feature AND session_id === the run
//         session
//       * known markers are present ("Starting coding agent for feature ...",
//         "All verification steps passed")
//   - Re-fetch to confirm the endpoint stays stable across multiple requests
//     (persistence; nothing disappears between calls).
//   - Disable LM Studio so the plan call skips and the whole thing finishes
//     in under 5 seconds without needing a running LM Studio server.

const http = require("node:http");
const Database = require("better-sqlite3");

const BASE = "http://localhost:3000";

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null });
          } catch {
            resolve({ status: res.statusCode, body: buf });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const unique = `LOGS_${Date.now()}`;
  console.log(`[1/7] create project ${unique}`);
  const proj = await request("POST", "/api/projects", {
    name: unique,
    description: "per-feature agent logs verification (Feature #74)",
  });
  if (proj.status !== 201 && proj.status !== 200) {
    throw new Error(`create failed: ${proj.status} ${JSON.stringify(proj.body)}`);
  }
  const projectId = proj.body.project.id;
  console.log(`    -> project id=${projectId}`);

  console.log(`[2/7] add 1 feature`);
  const featRes = await request("POST", `/api/projects/${projectId}/features`, {
    title: `${unique}_FEAT`,
    description: "feature to exercise agent logs pipeline",
  });
  const featureId = featRes.body.feature.id;
  console.log(`    -> feature id=${featureId}`);

  console.log(`[3/7] start orchestrator (short duration)`);
  const start = await request(
    "POST",
    `/api/projects/${projectId}/orchestrator`,
    { action: "start", outcome: "success", durationMs: 500 },
  );
  if (start.status !== 201 && start.status !== 200) {
    throw new Error(`start failed: ${start.status} ${JSON.stringify(start.body)}`);
  }
  const sessionId = start.body.session.id;
  console.log(`    -> session id=${sessionId} feature=${start.body.feature.id}`);

  console.log(`[4/7] poll until feature.status = completed`);
  const db = new Database("./data/localforge.db");
  const featStatus = () =>
    db.prepare("SELECT status FROM features WHERE id = ?").get(featureId)?.status;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (featStatus() === "completed") break;
  }
  if (featStatus() !== "completed") {
    throw new Error(`FAIL: feature did not reach completed (status=${featStatus()})`);
  }
  console.log(`    -> feature is completed`);

  console.log(`[5/7] GET /api/features/${featureId}/logs (first read)`);
  const logsRes1 = await request("GET", `/api/features/${featureId}/logs`);
  if (logsRes1.status !== 200) {
    throw new Error(`logs GET failed: ${logsRes1.status} ${JSON.stringify(logsRes1.body)}`);
  }
  const logs1 = logsRes1.body.logs;
  console.log(`    -> ${logs1.length} log rows returned`);
  if (!Array.isArray(logs1) || logs1.length === 0) {
    throw new Error("FAIL: expected >0 log rows");
  }

  // Verify every row has feature_id + session_id matching our run.
  const wrongFeature = logs1.find((l) => l.featureId !== featureId);
  if (wrongFeature) {
    throw new Error(
      `FAIL: log row ${wrongFeature.id} has featureId=${wrongFeature.featureId}, expected ${featureId}`,
    );
  }
  const wrongSession = logs1.find((l) => l.sessionId !== sessionId);
  if (wrongSession) {
    throw new Error(
      `FAIL: log row ${wrongSession.id} has sessionId=${wrongSession.sessionId}, expected ${sessionId}`,
    );
  }

  // Verify known marker messages are captured.
  const markers = [
    `Starting coding agent for feature #${featureId}`,
    "All verification steps passed",
    `Feature "${unique}_FEAT" marked completed`,
  ];
  for (const m of markers) {
    const found = logs1.some((l) => typeof l.message === "string" && l.message.includes(m));
    if (!found) {
      console.log(
        `    DEBUG: first 20 log messages: ${JSON.stringify(logs1.slice(0, 20).map((l) => l.message))}`,
      );
      throw new Error(`FAIL: expected a log row containing "${m}"`);
    }
  }
  console.log(`    -> all markers present (starting, all-steps-passed, marked-completed)`);

  console.log(`[6/7] GET /api/features/${featureId}/logs (second read, persistence)`);
  const logsRes2 = await request("GET", `/api/features/${featureId}/logs`);
  if (logsRes2.status !== 200) {
    throw new Error(`logs GET2 failed: ${logsRes2.status}`);
  }
  if (logsRes2.body.logs.length !== logs1.length) {
    throw new Error(
      `FAIL: log count changed between reads (first=${logs1.length}, second=${logsRes2.body.logs.length})`,
    );
  }
  console.log(`    -> same ${logs1.length} rows across both reads`);

  // Double-check directly in the DB: every agent_logs row for our feature
  // carries non-null feature_id AND session_id.
  const dbLogs = db
    .prepare(
      "SELECT id, session_id, feature_id, message_type FROM agent_logs WHERE feature_id = ? ORDER BY id",
    )
    .all(featureId);
  console.log(`    -> DB agent_logs rows for feature=${featureId}: ${dbLogs.length}`);
  if (dbLogs.length !== logs1.length) {
    throw new Error(
      `FAIL: DB row count (${dbLogs.length}) disagrees with API (${logs1.length})`,
    );
  }
  const nullSession = dbLogs.find((r) => r.session_id == null);
  if (nullSession) {
    throw new Error(
      `FAIL: agent_logs row ${nullSession.id} has null session_id`,
    );
  }

  console.log(`[7/7] cleanup`);
  db.close();
  await request("DELETE", `/api/projects/${projectId}?removeFiles=true`);
  console.log(
    `OK: Feature #74 verified — ${logs1.length} agent_logs rows tagged to feature=${featureId}/session=${sessionId}, persisted across reads`,
  );
  process.exit(0);
})().catch((err) => { console.error(err?.message || err); process.exit(1); });
