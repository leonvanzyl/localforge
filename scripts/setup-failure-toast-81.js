// Seed: create a project + feature, then return its IDs. The caller is
// expected to open the project page in a browser and POST orchestrator
// action=start with outcome=failure so the SSE listener in AgentNotifications
// fires a toast.error. We don't start the orchestrator from this script so
// the browser can be open BEFORE the failure event fires (SSE listeners need
// the page mounted to receive the status event).
const http = require("node:http");
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

(async () => {
  const unique = `FAIL_TOAST_${Date.now()}`;
  const proj = await request("POST", "/api/projects", {
    name: unique,
    description: "Feature #81 failure-toast verification",
  });
  const projectId = proj.body.project.id;
  const feat = await request("POST", `/api/projects/${projectId}/features`, {
    title: `${unique}_FEAT`,
    description: "feature set to fail via outcome=failure",
  });
  console.log(JSON.stringify({ projectId, featureId: feat.body.feature.id, name: unique }));
})().catch((err) => { console.error(err); process.exit(1); });
