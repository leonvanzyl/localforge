// E2E verification for Feature #102: force-stop orchestrator terminates the
// spawned Pi agent child process and flips the session row to
// status='terminated' with ended_at set.
//
// Strategy:
//   1. Create a test project + feature via the REST API
//   2. POST /api/projects/:id/orchestrator  action=start, durationMs=30000
//      so the runner sleeps long enough for us to observe it running
//   3. Count agent-runner.mjs child processes (should be >=1)
//   4. POST /api/projects/:id/orchestrator  action=stop
//   5. Poll until agent-runner.mjs count drops to zero (SIGTERM fires, runner
//      emits a final log, then exits with code 130 within ~500 ms)
//   6. Verify DB: session.status='terminated', ended_at set, feature back
//      in backlog
const http = require("node:http");
const Database = require("better-sqlite3");
const { execSync } = require("node:child_process");

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
          } catch (err) {
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

// Count node.exe processes whose command line includes "agent-runner.mjs".
// Uses tasklist on Windows (always present) or ps on POSIX. Returns the
// count; we only care whether it's zero vs non-zero.
function countRunners() {
  try {
    if (process.platform === "win32") {
      const out = execSync(
        'tasklist /FI "IMAGENAME eq node.exe" /V /FO CSV',
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      let total = 0;
      for (const line of out.split(/\r?\n/)) {
        if (line.includes("agent-runner") || line.includes("node.exe")) {
          // The tasklist /V variant does NOT include command line, only
          // window title. So we need a different method — use WMIC CommandLine.
          total += 0;
        }
      }
      // Use WMIC (reliable for command line) to get the exact match.
      let out2 = "";
      try {
        out2 = execSync(
          'wmic process where "name=\'node.exe\'" get CommandLine /format:list',
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch {
        try {
          out2 = execSync(
            'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Select-Object -ExpandProperty CommandLine"',
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch {
          out2 = "";
        }
      }
      let count = 0;
      for (const line of out2.split(/\r?\n/)) {
        if (line.includes("agent-runner.mjs")) count += 1;
      }
      return count;
    } else {
      const out = execSync("ps -eo args", { encoding: "utf8" });
      return out.split("\n").filter((l) => l.includes("agent-runner.mjs")).length;
    }
  } catch (err) {
    console.error("process list failed:", err.message);
    return -1;
  }
}

(async () => {
  const unique = `STOP_TEST_${Date.now()}`;
  console.log(`[1/7] create project ${unique}`);
  const proj = await request("POST", "/api/projects", {
    name: unique,
    description: "force-stop verification",
  });
  if (proj.status !== 201 && proj.status !== 200) {
    throw new Error(`create failed: ${proj.status} ${JSON.stringify(proj.body)}`);
  }
  const projectId = proj.body.project.id;
  console.log(`    -> project id=${projectId}`);

  console.log(`[2/7] add a feature so the orchestrator has something to pick`);
  const feat = await request("POST", `/api/projects/${projectId}/features`, {
    title: `${unique}_FEAT`,
    description: "long-running stop test",
  });
  if (feat.status !== 201 && feat.status !== 200) {
    throw new Error(`add feature failed: ${feat.status} ${JSON.stringify(feat.body)}`);
  }
  const featureId = feat.body.feature.id;
  console.log(`    -> feature id=${featureId}`);

  const runnersBefore = countRunners();
  console.log(`[3/7] start orchestrator (durationMs=30000)`);
  const start = await request("POST", `/api/projects/${projectId}/orchestrator`, {
    action: "start",
    durationMs: 30000,
  });
  if (start.status !== 201 && start.status !== 200) {
    throw new Error(`start failed: ${start.status} ${JSON.stringify(start.body)}`);
  }
  const sessionId = start.body.session.id;
  console.log(`    -> session id=${sessionId}`);

  // Give the child process a moment to spawn
  await sleep(800);

  const runnersWhileActive = countRunners();
  console.log(
    `[4/7] runners before=${runnersBefore} during=${runnersWhileActive}`,
  );

  console.log(`[5/7] POST stop`);
  const stop = await request("POST", `/api/projects/${projectId}/orchestrator`, {
    action: "stop",
  });
  if (stop.status !== 200) {
    throw new Error(`stop failed: ${stop.status} ${JSON.stringify(stop.body)}`);
  }
  console.log(`    -> stopped=${stop.body.stopped}`);

  // Poll up to 4s for the runner to exit
  let runnersAfter = countRunners();
  for (let i = 0; i < 20 && runnersAfter > runnersBefore; i++) {
    await sleep(200);
    runnersAfter = countRunners();
  }

  console.log(`[6/7] runners after=${runnersAfter}`);

  console.log(`[7/7] verify DB state`);
  const db = new Database("./data/localforge.db");
  const session = db
    .prepare(
      "SELECT id, project_id, feature_id, session_type, status, started_at, ended_at FROM agent_sessions WHERE id = ?",
    )
    .get(sessionId);
  const feature = db
    .prepare("SELECT id, status, priority FROM features WHERE id = ?")
    .get(featureId);
  console.log(`    session=${JSON.stringify(session)}`);
  console.log(`    feature=${JSON.stringify(feature)}`);

  const ok =
    session &&
    session.status === "terminated" &&
    session.ended_at &&
    feature &&
    feature.status === "backlog" &&
    runnersWhileActive > runnersBefore &&
    runnersAfter <= runnersBefore;
  console.log(ok ? "\nOK: force-stop end-to-end verified" : "\nFAIL: check above output");

  // Cleanup: delete the test project so the DB stays tidy (cascades remove
  // the feature + session + logs)
  await request("DELETE", `/api/projects/${projectId}`, { removeFiles: true });
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
