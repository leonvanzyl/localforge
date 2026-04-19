// Seed: create a project with one feature, run orchestrator to completion so
// that agent_logs rows exist, then print the IDs so the UI walker can open
// the feature detail modal and inspect the "Agent activity" section.
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
          try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); }
          catch { resolve({ status: res.statusCode, body: buf }); }
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
  const unique = `LOGS_UI_${Date.now()}`;
  const proj = await request("POST", "/api/projects", {
    name: unique,
    description: "Feature #74 logs-UI verification",
  });
  const projectId = proj.body.project.id;
  const feat = await request("POST", `/api/projects/${projectId}/features`, {
    title: `${unique}_FEAT`,
    description: "run-to-completion so logs exist",
  });
  const featureId = feat.body.feature.id;
  await request("POST", `/api/projects/${projectId}/orchestrator`, {
    action: "start",
    outcome: "success",
    durationMs: 400,
  });
  // Wait until feature completes
  const db = new Database("./data/localforge.db");
  const q = db.prepare("SELECT status FROM features WHERE id = ?");
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (q.get(featureId)?.status === "completed") break;
  }
  const logCount = db
    .prepare("SELECT COUNT(*) as n FROM agent_logs WHERE feature_id = ?")
    .get(featureId).n;
  db.close();
  console.log(JSON.stringify({ projectId, featureId, name: unique, logCount }));
})().catch((err) => { console.error(err); process.exit(1); });
