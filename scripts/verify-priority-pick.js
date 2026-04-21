// E2E verification for Feature #64: orchestrator picks the highest-priority
// backlog feature (lowest priority number first).
//
// Scenario:
//   - Fresh project + 3 backlog features with priorities 3 / 1 / 2 (A/B/C).
//   - Start orchestrator. Expect feature B (priority 1) to be the one
//     transitioned to in_progress first.
//   - Stop orchestrator.
//   - Complete B by marking it status=completed via PATCH.
//   - Start orchestrator again.
//   - Expect feature C (priority 2) to be picked next.
//   - Cleanup.
//
// This script sets a very long `durationMs` so the runner doesn't auto-
// advance to the next feature before we can inspect the pick order.

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
  const unique = `PRIO_PICK_${Date.now()}`;
  console.log(`[1/9] create project ${unique}`);
  const proj = await request("POST", "/api/projects", {
    name: unique,
    description: "priority-pick verification (Feature #64)",
  });
  if (proj.status !== 201 && proj.status !== 200) {
    throw new Error(`create failed: ${proj.status} ${JSON.stringify(proj.body)}`);
  }
  const projectId = proj.body.project.id;
  console.log(`    -> project id=${projectId}`);

  console.log(`[2/9] add 3 backlog features A(prio 3) / B(prio 1) / C(prio 2)`);
  const spec = [
    { label: "A", priority: 3 },
    { label: "B", priority: 1 },
    { label: "C", priority: 2 },
  ];
  const byLabel = {};
  for (const s of spec) {
    const f = await request("POST", `/api/projects/${projectId}/features`, {
      title: `${unique}_${s.label}`,
      description: `feature ${s.label} for priority-pick test`,
      priority: s.priority,
    });
    if (f.status !== 201 && f.status !== 200) {
      throw new Error(
        `feature ${s.label} create failed: ${f.status} ${JSON.stringify(f.body)}`,
      );
    }
    byLabel[s.label] = f.body.feature;
    console.log(
      `    -> ${s.label} id=${f.body.feature.id} priority=${f.body.feature.priority}`,
    );
  }

  // Give LM Studio a long budget so the runner doesn't finish before we
  // inspect the pick. durationMs=60000 = 60s between simulated steps, which
  // is plenty of headroom for our synchronous DB read below.
  console.log(`[3/9] start orchestrator (durationMs=60000, outcome=success)`);
  const start1 = await request(
    "POST",
    `/api/projects/${projectId}/orchestrator`,
    { action: "start", outcome: "success", durationMs: 60000 },
  );
  if (start1.status !== 201 && start1.status !== 200) {
    throw new Error(
      `start1 failed: ${start1.status} ${JSON.stringify(start1.body)}`,
    );
  }
  console.log(
    `    -> first pick: feature id=${start1.body.feature.id} title=${start1.body.feature.title}`,
  );

  // Assertion 1: first pick MUST be feature B (priority 1).
  if (start1.body.feature.id !== byLabel.B.id) {
    throw new Error(
      `FAIL: expected first pick to be B (id=${byLabel.B.id}) but was id=${start1.body.feature.id}`,
    );
  }

  // Double-check via DB: feature B should be in_progress.
  const db = new Database("./data/localforge.db");
  const featuresNow = () =>
    db
      .prepare(
        `SELECT id, title, status, priority FROM features WHERE project_id = ? ORDER BY id`,
      )
      .all(projectId);
  let snap = featuresNow();
  console.log(`    -> db after start1: ${JSON.stringify(snap)}`);
  const bRow = snap.find((r) => r.id === byLabel.B.id);
  if (!bRow || bRow.status !== "in_progress") {
    throw new Error(
      `FAIL: B not in_progress in DB after start: ${JSON.stringify(bRow)}`,
    );
  }

  console.log(`[4/9] stop orchestrator`);
  const stop1 = await request(
    "POST",
    `/api/projects/${projectId}/orchestrator`,
    { action: "stop" },
  );
  if (stop1.status !== 200) {
    throw new Error(
      `stop1 failed: ${stop1.status} ${JSON.stringify(stop1.body)}`,
    );
  }

  // Wait for the child process to fully exit and the finalize handler to
  // flip B back to backlog.
  let bBacklog = false;
  for (let i = 0; i < 20 && !bBacklog; i++) {
    await sleep(200);
    snap = featuresNow();
    const bAfter = snap.find((r) => r.id === byLabel.B.id);
    bBacklog = bAfter && bAfter.status === "backlog";
  }
  if (!bBacklog) {
    throw new Error(
      `FAIL: B did not return to backlog after stop: ${JSON.stringify(snap)}`,
    );
  }

  console.log(`[5/9] manually complete B by PATCH status=completed`);
  const patchB = await request(
    "PATCH",
    `/api/features/${byLabel.B.id}`,
    { status: "completed" },
  );
  if (patchB.status !== 200) {
    throw new Error(
      `PATCH B failed: ${patchB.status} ${JSON.stringify(patchB.body)}`,
    );
  }
  snap = featuresNow();
  console.log(`    -> db after B completed: ${JSON.stringify(snap)}`);

  console.log(`[6/9] start orchestrator second time`);
  const start2 = await request(
    "POST",
    `/api/projects/${projectId}/orchestrator`,
    { action: "start", outcome: "success", durationMs: 60000 },
  );
  if (start2.status !== 201 && start2.status !== 200) {
    throw new Error(
      `start2 failed: ${start2.status} ${JSON.stringify(start2.body)}`,
    );
  }
  console.log(
    `    -> second pick: feature id=${start2.body.feature.id} title=${start2.body.feature.title}`,
  );

  // Assertion 2: second pick MUST be feature C (priority 2), NOT A (priority 3).
  if (start2.body.feature.id !== byLabel.C.id) {
    throw new Error(
      `FAIL: expected second pick to be C (id=${byLabel.C.id}) but was id=${start2.body.feature.id}`,
    );
  }

  console.log(`[7/9] stop orchestrator again for cleanup`);
  await request("POST", `/api/projects/${projectId}/orchestrator`, {
    action: "stop",
  });

  // Wait for finalize
  for (let i = 0; i < 10; i++) {
    await sleep(200);
  }

  console.log(`[8/9] final DB snapshot`);
  snap = featuresNow();
  console.log(`    -> ${JSON.stringify(snap)}`);

  console.log(`[9/9] cleanup`);
  db.close();
  await request("DELETE", `/api/projects/${projectId}?removeFiles=true`);

  console.log(
    "OK: orchestrator picked B(prio1) first, then C(prio2) after B was completed",
  );
  process.exit(0);
})().catch(async (err) => {
  console.error(err?.message || err);
  process.exit(1);
});
