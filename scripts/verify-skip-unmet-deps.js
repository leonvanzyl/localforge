// E2E verification for Feature #69: orchestrator auto-skips features with
// unmet dependencies.
//
// Scenario (from the feature's steps):
//   - Create two features in one project:
//       X: priority 1, depends on Y
//       Y: priority 2, no deps
//   - Start orchestrator -> expect Y to be picked first (X has unmet dep on Y).
//   - Complete Y (mark completed via PATCH).
//   - Start again -> expect X to be picked (now ready).
//
// X has the higher priority (lower priority number) but is blocked by the
// dependency; the orchestrator should look past it and pick the next READY
// feature (Y). This is the distinction from Feature #64 (pure priority order)
// and Feature #65 (dependency chain, already verified).
//
// Uses a long durationMs so we have time to inspect the picked feature before
// the runner auto-advances past it.

const http = require("node:http");
const Database = require("better-sqlite3");

const BASE = "http://localhost:7777";

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
  const unique = `SKIP_UNMET_${Date.now()}`;
  console.log(`[1/8] create project ${unique}`);
  const proj = await request("POST", "/api/projects", {
    name: unique,
    description: "skip-unmet-deps verification (Feature #69)",
  });
  if (proj.status !== 201 && proj.status !== 200) {
    throw new Error(`create failed: ${proj.status} ${JSON.stringify(proj.body)}`);
  }
  const projectId = proj.body.project.id;
  console.log(`    -> project id=${projectId}`);

  console.log(`[2/8] add X(prio 1) and Y(prio 2)`);
  const xRes = await request("POST", `/api/projects/${projectId}/features`, {
    title: `${unique}_X`,
    description: "blocked feature — depends on Y",
    priority: 1,
  });
  const yRes = await request("POST", `/api/projects/${projectId}/features`, {
    title: `${unique}_Y`,
    description: "unblocked feature — no deps",
    priority: 2,
  });
  for (const r of [xRes, yRes]) {
    if (r.status !== 201 && r.status !== 200) {
      throw new Error(`feature create failed: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }
  const X = xRes.body.feature;
  const Y = yRes.body.feature;
  console.log(`    -> X id=${X.id} prio=${X.priority}`);
  console.log(`    -> Y id=${Y.id} prio=${Y.priority}`);

  console.log(`[3/8] add dependency X depends on Y`);
  const depRes = await request(
    "POST",
    `/api/features/${X.id}/dependencies`,
    { dependsOnFeatureId: Y.id },
  );
  if (depRes.status !== 201 && depRes.status !== 200) {
    throw new Error(`add dep failed: ${depRes.status} ${JSON.stringify(depRes.body)}`);
  }
  console.log(`    -> X now depends on Y`);

  const db = new Database("./data/localforge.db");
  const snapshot = () =>
    db
      .prepare(
        `SELECT id, title, status, priority FROM features WHERE project_id = ? ORDER BY priority, id`,
      )
      .all(projectId);

  console.log(`[4/8] start orchestrator, expect Y to be picked (X has unmet dep)`);
  const start1 = await request(
    "POST",
    `/api/projects/${projectId}/orchestrator`,
    { action: "start", outcome: "success", durationMs: 60000 },
  );
  if (start1.status !== 201 && start1.status !== 200) {
    throw new Error(`start1 failed: ${start1.status} ${JSON.stringify(start1.body)}`);
  }
  console.log(`    -> first pick: id=${start1.body.feature.id} title=${start1.body.feature.title}`);
  if (start1.body.feature.id !== Y.id) {
    throw new Error(
      `FAIL: expected Y (id=${Y.id}) but got id=${start1.body.feature.id}`,
    );
  }
  let snap = snapshot();
  console.log(`    -> db: ${JSON.stringify(snap)}`);

  console.log(`[5/8] stop orchestrator, then manually complete Y`);
  await request("POST", `/api/projects/${projectId}/orchestrator`, { action: "stop" });
  // Wait for finalize to flip Y back to backlog
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    snap = snapshot();
    const yRow = snap.find((r) => r.id === Y.id);
    if (yRow && yRow.status === "backlog") break;
  }
  const patchY = await request("PATCH", `/api/features/${Y.id}`, {
    status: "completed",
  });
  if (patchY.status !== 200) {
    throw new Error(`PATCH Y failed: ${patchY.status} ${JSON.stringify(patchY.body)}`);
  }
  snap = snapshot();
  console.log(`    -> db after Y completed: ${JSON.stringify(snap)}`);

  console.log(`[6/8] start orchestrator again, expect X now`);
  const start2 = await request(
    "POST",
    `/api/projects/${projectId}/orchestrator`,
    { action: "start", outcome: "success", durationMs: 60000 },
  );
  if (start2.status !== 201 && start2.status !== 200) {
    throw new Error(`start2 failed: ${start2.status} ${JSON.stringify(start2.body)}`);
  }
  console.log(`    -> second pick: id=${start2.body.feature.id} title=${start2.body.feature.title}`);
  if (start2.body.feature.id !== X.id) {
    throw new Error(
      `FAIL: expected X (id=${X.id}) but got id=${start2.body.feature.id}`,
    );
  }

  console.log(`[7/8] stop orchestrator for cleanup`);
  await request("POST", `/api/projects/${projectId}/orchestrator`, { action: "stop" });
  for (let i = 0; i < 10; i++) await sleep(200);

  console.log(`[8/8] cleanup`);
  db.close();
  await request("DELETE", `/api/projects/${projectId}?removeFiles=true`);
  console.log("OK: orchestrator skipped X (unmet dep) and picked Y first, then X after Y completed");
  process.exit(0);
})().catch((err) => { console.error(err?.message || err); process.exit(1); });
