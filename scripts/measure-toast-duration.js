// Trigger a failure on project 76 and subscribe to SSE to learn the EXACT
// timestamp at which the "status=failed" event fires. We emit that to stdout
// so the caller can snapshot the UI at +5s and +10s relative to the event.
const http = require("node:http");

const projectId = Number.parseInt(process.argv[2] ?? "76", 10);

function post(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, "http://localhost:7777");
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: buf }));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

(async () => {
  // Connect SSE listener FIRST
  const req = http.get(
    {
      hostname: "localhost",
      port: 7777,
      path: "/api/agent/events",
      headers: { Accept: "text/event-stream" },
    },
    (res) => {
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = frame.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          if (!eventLine || !dataLine) continue;
          const eventType = eventLine.slice(7).trim();
          if (eventType !== "status") continue;
          let data;
          try { data = JSON.parse(dataLine.slice(6)); } catch { continue; }
          if (data.sessionStatus === "failed" && data.projectId === projectId) {
            console.log(`FAILED_AT ${Date.now()}`);
            process.exit(0);
          }
        }
      });
    },
  );
  req.on("error", (err) => {
    console.error("SSE error:", err.message);
    process.exit(1);
  });

  // Give SSE 500ms to establish
  await new Promise((r) => setTimeout(r, 500));

  const r = await post(`/api/projects/${projectId}/orchestrator`, {
    action: "start",
    outcome: "failure",
    durationMs: 600,
  });
  console.log(`TRIGGERED ${Date.now()} status=${r.status}`);

  // Safety timeout after 90s
  setTimeout(() => {
    console.error("TIMEOUT");
    process.exit(2);
  }, 90_000);
})();
