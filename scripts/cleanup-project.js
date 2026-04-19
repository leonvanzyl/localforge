// Delete a project (and remove its files from disk). Usage:
//   node scripts/cleanup-project.js <projectId>
const http = require("node:http");
const BASE = "http://localhost:3000";

const projectId = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isFinite(projectId) || projectId <= 0) {
  console.error("usage: node scripts/cleanup-project.js <projectId>");
  process.exit(2);
}

function request(method, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: buf }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const res = await request("DELETE", `/api/projects/${projectId}?removeFiles=true`);
  console.log(JSON.stringify({ projectId, status: res.status, body: res.body }));
})().catch((err) => { console.error(err); process.exit(1); });
