// Playwright test for Feature #98 — the generated TodoTestApp renders a
// working 3-column kanban board and todos can be dragged between columns.
//
// Strategy:
//   - Spawn the TodoTestApp server (projects/todotestapp/server.js) in a
//     child process on a free port, pointing at an isolated temp DB
//     (TODOS_DB_PATH).
//   - Wait for /api/health to respond.
//   - Visit the page, assert 3 columns exist.
//   - Add a todo, drag it backlog -> in-progress -> done, verify UI + DB.
//   - Tear down: kill server, unlink temp DB.
//
// HTML5 native drag-and-drop events are dispatched manually with a shared
// DataTransfer handle — Playwright's real-mouse dragTo() does not reliably
// fire native drag events in headless mode.

const { test, expect } = require("@playwright/test");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const TODOAPP_PORT = 3101;
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
        if (Date.now() - started > timeoutMs) {
          return reject(new Error(`health check never reached 200`));
        }
        setTimeout(tryOnce, 150);
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          return reject(new Error("server never came up"));
        }
        setTimeout(tryOnce, 150);
      });
    };
    tryOnce();
  });
}

test.beforeAll(async () => {
  tmpDbPath = path.join(
    os.tmpdir(),
    `todotestapp-kanban-${Date.now()}-${process.pid}.db`,
  );
  serverProc = spawn("node", [SERVER_SCRIPT], {
    env: {
      ...process.env,
      PORT: String(TODOAPP_PORT),
      TODOS_DB_PATH: tmpDbPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stdout.on("data", (c) =>
    process.stdout.write(`[todoapp] ${c}`),
  );
  serverProc.stderr.on("data", (c) =>
    process.stderr.write(`[todoapp:err] ${c}`),
  );
  await waitForHealth();
});

test.afterAll(async () => {
  if (serverProc && !serverProc.killed) {
    await new Promise((resolve) => {
      serverProc.once("exit", () => resolve());
      try {
        serverProc.kill("SIGTERM");
      } catch (_) {
        resolve();
      }
      // Safety fallback
      setTimeout(() => {
        try {
          serverProc.kill("SIGKILL");
        } catch (_) {}
        resolve();
      }, 2500);
    });
  }
  // Clean up isolated DB files (todos.db, -shm, -wal)
  for (const suffix of ["", "-shm", "-wal"]) {
    try {
      fs.unlinkSync(tmpDbPath + suffix);
    } catch (_) {
      /* ignore */
    }
  }
});

test.setTimeout(60_000);

test("TodoTestApp renders a working 3-column kanban board", async ({ page }) => {
  await page.goto(BASE);

  // Step 3: 3 columns
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  await expect(page.getByTestId("column-backlog")).toBeVisible();
  await expect(page.getByTestId("column-in-progress")).toBeVisible();
  await expect(page.getByTestId("column-done")).toBeVisible();

  // Start empty
  await expect(page.getByTestId("count-backlog")).toHaveText("0");
  await expect(page.getByTestId("count-in-progress")).toHaveText("0");
  await expect(page.getByTestId("count-done")).toHaveText("0");

  // Step 4: add a todo, verify it lands in backlog
  const title = `Kanban E2E ${Date.now()}`;
  await page.locator("#new-todo-input").fill(title);
  await page.locator("#new-todo-form button[type=submit]").click();

  await expect(page.getByTestId("count-backlog")).toHaveText("1");
  const backlogCol = page.getByTestId("column-backlog");
  await expect(backlogCol.getByText(title)).toBeVisible();

  // Extract the card's id for drag operations
  const cardLocator = backlogCol.locator(".todo-card").first();
  await expect(cardLocator).toBeVisible();
  const todoId = await cardLocator.getAttribute("data-id");
  expect(todoId).toBeTruthy();
  const cardTestId = `todo-card-${todoId}`;

  // Helper: simulate HTML5 drag by dispatching events with a shared
  // DataTransfer handle. This is Playwright's recommended pattern for
  // native DnD and actually fires dragstart + drop on our handlers.
  async function dragTodoTo(targetTestId) {
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const source = page.getByTestId(cardTestId);
    const target = page.getByTestId(targetTestId);
    await source.dispatchEvent("dragstart", { dataTransfer: dt });
    await target.dispatchEvent("dragover", { dataTransfer: dt });
    await target.dispatchEvent("drop", { dataTransfer: dt });
    await source.dispatchEvent("dragend", { dataTransfer: dt });
    await dt.dispose();
  }

  // Step 5: drag backlog -> in-progress
  await dragTodoTo("column-in-progress");
  await expect(page.getByTestId("count-backlog")).toHaveText("0");
  await expect(page.getByTestId("count-in-progress")).toHaveText("1");
  const inProgressCol = page.getByTestId("column-in-progress");
  await expect(inProgressCol.getByText(title)).toBeVisible();

  // Verify DB-side status via the REST API (proves the status actually
  // updated, not just the DOM).
  const afterMove1 = await page.evaluate(() =>
    fetch("/api/todos").then((r) => r.json()),
  );
  const row1 = afterMove1.todos.find((t) => String(t.id) === todoId);
  expect(row1).toBeTruthy();
  expect(row1.status).toBe("in-progress");

  // Step 6: drag in-progress -> done
  await dragTodoTo("column-done");
  await expect(page.getByTestId("count-in-progress")).toHaveText("0");
  await expect(page.getByTestId("count-done")).toHaveText("1");
  const doneCol = page.getByTestId("column-done");
  await expect(doneCol.getByText(title)).toBeVisible();

  const afterMove2 = await page.evaluate(() =>
    fetch("/api/todos").then((r) => r.json()),
  );
  const row2 = afterMove2.todos.find((t) => String(t.id) === todoId);
  expect(row2).toBeTruthy();
  expect(row2.status).toBe("done");
});
