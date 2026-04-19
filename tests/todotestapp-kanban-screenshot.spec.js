// Visual screenshot for Feature #98 — capture the TodoTestApp kanban board
// with todos spread across all 3 columns. Spawns its own isolated server.

const { test, expect } = require("@playwright/test");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const TODOAPP_PORT = 3102;
const BASE = `http://127.0.0.1:${TODOAPP_PORT}`;
const SERVER_SCRIPT = path.resolve(
  __dirname,
  "..",
  "projects",
  "todotestapp",
  "server.js",
);

let serverProc = null;
let tmpDbPath = null;

function waitForHealth(timeoutMs = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(`${BASE}/api/health`, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          return resolve();
        }
        res.resume();
        if (Date.now() - started > timeoutMs) return reject(new Error(`health check never reached 200`));
        setTimeout(tryOnce, 150);
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) return reject(new Error("server never came up"));
        setTimeout(tryOnce, 150);
      });
    };
    tryOnce();
  });
}

function postJSON(p, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: TODOAPP_PORT,
        path: p,
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
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(buf || "null") }));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function patchJSON(p, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: TODOAPP_PORT,
        path: p,
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode }));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

test.beforeAll(async () => {
  tmpDbPath = path.join(os.tmpdir(), `todotestapp-shot-${Date.now()}.db`);
  serverProc = spawn("node", [SERVER_SCRIPT], {
    env: { ...process.env, PORT: String(TODOAPP_PORT), TODOS_DB_PATH: tmpDbPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stdout.on("data", () => {});
  serverProc.stderr.on("data", () => {});
  await waitForHealth();
});

test.afterAll(async () => {
  if (serverProc && !serverProc.killed) {
    await new Promise((resolve) => {
      serverProc.once("exit", () => resolve());
      try { serverProc.kill("SIGTERM"); } catch (_) { resolve(); }
      setTimeout(() => { try { serverProc.kill("SIGKILL"); } catch (_) {} resolve(); }, 2500);
    });
  }
  for (const s of ["", "-shm", "-wal"]) { try { fs.unlinkSync(tmpDbPath + s); } catch (_) {} }
});

test("TodoTestApp kanban screenshot (all 3 columns populated)", async ({ page }) => {
  // Seed 3 todos, one per status, via the REST API.
  const a = await postJSON("/api/todos", { title: "Review last PR", status: "backlog" });
  const b = await postJSON("/api/todos", { title: "Wire confetti", status: "backlog" });
  const c = await postJSON("/api/todos", { title: "Fix drag-drop bug", status: "backlog" });
  await patchJSON(`/api/todos/${b.body.todo.id}`, { status: "in-progress" });
  await patchJSON(`/api/todos/${c.body.todo.id}`, { status: "done" });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(BASE);
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  await expect(page.getByTestId("count-backlog")).toHaveText("1");
  await expect(page.getByTestId("count-in-progress")).toHaveText("1");
  await expect(page.getByTestId("count-done")).toHaveText("1");

  const outputPath = path.resolve("screenshots", "feature-98-todotestapp-kanban.png");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await page.screenshot({ path: outputPath, fullPage: true });
  console.log("Screenshot saved to:", outputPath);
});
