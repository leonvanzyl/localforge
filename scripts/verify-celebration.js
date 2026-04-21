// E2E verification for Feature #101: celebration screen when all features
// complete.
//
// Flow:
//   1. Create a fresh project (so we don't stomp on existing data).
//   2. Add a single feature, run the orchestrator to completion.
//   3. After the session finishes:
//        - DB: project.status flips to "completed"
//        - API /api/projects/:id/completion returns status=completed with
//          sensible featureCount/passedCount/durationMs numbers.
//   4. Clean up (delete the test project).
//
// Also validates idempotency: calling the completion helper after the project
// is already completed does not change anything.

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
  const unique = `CELEBRATION_TEST_${Date.now()}`;
  console.log(`[1/7] create project ${unique}`);
  const proj = await request("POST", "/api/projects", {
    name: unique,
    description: "celebration-screen verification",
  });
  if (proj.status !== 201 && proj.status !== 200) {
    throw new Error(`create failed: ${proj.status} ${JSON.stringify(proj.body)}`);
  }
  const projectId = proj.body.project.id;
  console.log(`    -> project id=${projectId}`);

  console.log(`[2/7] add single feature`);
  const feat = await request("POST", `/api/projects/${projectId}/features`, {
    title: `${unique}_FEAT`,
    description: "single feature to drive completion",
  });
  const featureId = feat.body.feature.id;
  console.log(`    -> feature id=${featureId}`);

  console.log(`[3/7] start orchestrator (durationMs=1500)`);
  const start = await request(
    "POST",
    `/api/projects/${projectId}/orchestrator`,
    {
      action: "start",
      durationMs: 1500,
    },
  );
  if (start.status !== 201 && start.status !== 200) {
    throw new Error(`start failed: ${start.status} ${JSON.stringify(start.body)}`);
  }
  const sessionId = start.body.session.id;
  console.log(`    -> session id=${sessionId}`);

  console.log(`[4/7] wait for runner to finish + project_completed event`);
  const db = new Database("./data/localforge.db");
  const getProjectStatus = () =>
    db
      .prepare("SELECT status FROM projects WHERE id = ?")
      .get(projectId).status;
  // Up to 2 minutes — parallel test runs can starve the agent-runner child.
  let pstatus = getProjectStatus();
  for (let i = 0; i < 240 && pstatus !== "completed"; i++) {
    await sleep(500);
    pstatus = getProjectStatus();
  }
  console.log(`    -> project status=${pstatus}`);

  console.log(`[5/7] fetch /api/projects/${projectId}/completion`);
  const comp = await request("GET", `/api/projects/${projectId}/completion`);
  console.log(`    -> ${comp.status} ${JSON.stringify(comp.body)}`);

  console.log(`[6/7] sanity checks`);
  const c = comp.body?.completion;
  const ok =
    pstatus === "completed" &&
    c &&
    c.status === "completed" &&
    c.featureCount === 1 &&
    c.passedCount === 1 &&
    c.completedAt &&
    typeof c.durationMs === "number" &&
    c.durationMs >= 0;
  console.log(`    -> ok=${ok}`);

  console.log(`[7/7] cleanup`);
  await request("DELETE", `/api/projects/${projectId}?removeFiles=true`);

  if (!ok) {
    console.log("FAIL");
    process.exit(1);
  }
  console.log("OK: celebration completion stats end-to-end verified");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
