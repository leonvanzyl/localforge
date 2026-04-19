// Create a test project + feature and then start a long-running orchestrator
// so a human (or playwright) can verify the UI's Stop button terminates
// the running agent. Prints the project id + session id for navigation.
const http = require("node:http");
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

(async () => {
  const unique = `UI_STOP_TEST_${Date.now()}`;
  const proj = await request("POST", "/api/projects", {
    name: unique,
    description: "UI stop verification",
  });
  const projectId = proj.body.project.id;
  await request("POST", `/api/projects/${projectId}/features`, {
    title: `${unique}_FEAT`,
    description: "long-running feature for stop button test",
  });
  const start = await request("POST", `/api/projects/${projectId}/orchestrator`, {
    action: "start",
    durationMs: 60000,
  });
  console.log(
    `PROJECT_ID=${projectId} SESSION_ID=${start.body.session.id}`,
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
