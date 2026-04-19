// Poll /api/projects/:id/orchestrator until the response shows no active
// running session. Prints one event per poll iteration so callers running
// this via Monitor see heartbeat events.
const http = require("node:http");
const projectId = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isFinite(projectId)) {
  console.error("usage: node scripts/wait-for-session-end.js <projectId>");
  process.exit(2);
}

function request(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, "http://localhost:3000");
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "GET" },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try { resolve(JSON.parse(buf)); } catch { resolve(null); }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const data = await request(`/api/projects/${projectId}/orchestrator`).catch(() => null);
    const running = data && data.running === true;
    const status = data?.session?.status ?? "none";
    console.log(`poll running=${running} status=${status}`);
    if (!running) {
      console.log("SESSION_ENDED");
      process.exit(0);
    }
    await sleep(2000);
  }
  console.log("TIMEOUT");
  process.exit(1);
})().catch((err) => { console.error(err); process.exit(1); });
