// E2E verification for Feature #70: orchestrator continues to next feature
// after completion. Also exercises Feature #84 (all-features-done detection)
// since the natural endpoint of the loop is the celebration state.
//
// Flow:
//   1. Create a fresh project + 3 backlog features.
//   2. Start the orchestrator with a short durationMs so each feature
//      finishes quickly.
//   3. Poll the DB until either all 3 features are completed OR a 30s
//      watchdog fires.
//   4. Verify:
//        - all 3 features have status='completed'
//        - 3 distinct coding agent_session rows exist (one per feature)
//        - project.status flips to 'completed' (Feature #84)
//        - no active in_progress coding session lingers
//   5. Cleanup.
//
// This test deliberately makes only ONE POST /orchestrator call. If the
// orchestrator did not auto-continue, only feature #1 would complete.

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
          ...(payload
            ? { "Content-Length": Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode,
              body: buf ? JSON.parse(buf) : null,
            });
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const unique = `AUTOCONT_${Date.now()}`;
  console.log(`[1/6] create project ${unique}`);
  const proj = await request("POST", "/api/projects", {
    name: unique,
    description: "auto-continue verification (Feature #70)",
  });
  if (proj.status !== 201 && proj.status !== 200) {
    throw new Error(
      `create failed: ${proj.status} ${JSON.stringify(proj.body)}`,
    );
  }
  const projectId = proj.body.project.id;
  console.log(`    -> project id=${projectId}`);

  console.log(`[2/6] add 3 backlog features`);
  const featureIds = [];
  for (let i = 1; i <= 3; i++) {
    const f = await request("POST", `/api/projects/${projectId}/features`, {
      title: `${unique}_FEAT_${i}`,
      description: `feature ${i} for auto-continue chain`,
    });
    if (f.status !== 201 && f.status !== 200) {
      throw new Error(
        `feature ${i} create failed: ${f.status} ${JSON.stringify(f.body)}`,
      );
    }
    featureIds.push(f.body.feature.id);
  }
  console.log(`    -> features=${featureIds.join(",")}`);

  console.log(`[3/6] start orchestrator ONCE (durationMs=600)`);
  const start = await request(
    "POST",
    `/api/projects/${projectId}/orchestrator`,
    {
      action: "start",
      outcome: "success",
      durationMs: 600,
    },
  );
  if (start.status !== 201 && start.status !== 200) {
    throw new Error(
      `start failed: ${start.status} ${JSON.stringify(start.body)}`,
    );
  }
  console.log(
    `    -> session id=${start.body.session.id} feature=${start.body.feature.id}`,
  );

  console.log(`[4/6] poll DB for all 3 features completed`);
  const db = new Database("./data/localforge.db");
  const featureStatuses = () =>
    db
      .prepare(
        `SELECT id, status FROM features WHERE project_id = ? ORDER BY id`,
      )
      .all(projectId);
  const projectStatus = () =>
    db
      .prepare("SELECT status FROM projects WHERE id = ?")
      .get(projectId).status;
  const codingSessions = () =>
    db
      .prepare(
        `SELECT id, feature_id, status FROM agent_sessions WHERE project_id = ? AND session_type = 'coding' ORDER BY id`,
      )
      .all(projectId);

  let statuses = [];
  let allDone = false;
  // 60 * 0.5s = 30s watchdog; each feature is ~600ms + overhead.
  for (let i = 0; i < 60 && !allDone; i++) {
    await sleep(500);
    statuses = featureStatuses();
    allDone = statuses.every((r) => r.status === "completed");
  }
  console.log(`    -> feature statuses: ${JSON.stringify(statuses)}`);

  console.log(`[5/6] sanity checks`);
  const sessions = codingSessions();
  const pStatus = projectStatus();
  const pendingActive = sessions.filter((s) => s.status === "in_progress");
  const oneSessionPerFeature = featureIds.every((fid) =>
    sessions.some((s) => s.feature_id === fid),
  );
  console.log(`    -> sessions: ${JSON.stringify(sessions)}`);
  console.log(`    -> project.status=${pStatus}`);
  console.log(`    -> still in_progress sessions: ${pendingActive.length}`);

  const ok =
    allDone &&
    sessions.length >= 3 &&
    oneSessionPerFeature &&
    pStatus === "completed" &&
    pendingActive.length === 0;
  console.log(`    -> ok=${ok}`);

  console.log(`[6/6] cleanup`);
  await request("DELETE", `/api/projects/${projectId}?removeFiles=true`);

  if (!ok) {
    console.log("FAIL");
    process.exit(1);
  }
  console.log(
    "OK: orchestrator auto-continued through all 3 features end-to-end",
  );
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
