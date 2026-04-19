// Seed a fresh project + feature for Feature #66 UI verification. Prints
// {projectId, featureId} as JSON on stdout so the caller can capture IDs.
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

(async () => {
  const unique = "F66_UI_" + Date.now();
  const proj = await request("POST", "/api/projects", {
    name: unique,
    description: "Feature #66 stop-ui verification",
  });
  const pid = proj.body.project.id;
  const feat = await request("POST", `/api/projects/${pid}/features`, {
    title: unique + "_FEAT",
    description: "long-running feature for UI stop test",
  });
  console.log(JSON.stringify({ projectId: pid, featureId: feat.body.feature.id, name: unique }));
})().catch((err) => { console.error(err); process.exit(1); });
