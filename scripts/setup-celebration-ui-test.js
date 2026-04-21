// Spin up a project, drive it to completion, and print the project id so a
// browser test can navigate to /projects/<id> and assert the celebration UI
// rendered.
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
  const unique = `UI_CELEBRATION_${Date.now()}`;
  const proj = await request("POST", "/api/projects", {
    name: unique,
    description: "celebration UI verification",
  });
  const projectId = proj.body.project.id;
  await request("POST", `/api/projects/${projectId}/features`, {
    title: `${unique}_FEAT`,
    description: "drive project to complete",
  });
  await request("POST", `/api/projects/${projectId}/orchestrator`, {
    action: "start",
    durationMs: 1500,
  });
  const db = new Database("./data/localforge.db");
  const stmt = db.prepare("SELECT status FROM projects WHERE id = ?");
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const row = stmt.get(projectId);
    if (row && row.status === "completed") break;
  }
  console.log(`PROJECT_ID=${projectId} NAME=${unique}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
