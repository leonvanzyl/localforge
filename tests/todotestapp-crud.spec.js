// Playwright test for Feature #100 — the generated TodoTestApp supports
// full CRUD (create, edit, delete) with real SQLite persistence.
//
// Strategy (mirrors the #98 kanban test):
//   - Spawn projects/todotestapp/server.js on its own port against an
//     isolated TODOS_DB_PATH temp file.
//   - Wait for /api/health.
//   - Create, inline-edit (Enter to save), verify DB + UI, then delete
//     and verify the row is gone both from the DOM and SQLite.
//   - Tear down: kill server, unlink temp DB.
//
// We prove persistence by opening the SQLite file directly with
// better-sqlite3 (not by re-querying the same REST API) so an in-memory
// / mock backend would fail the assertions.

const { test, expect } = require("@playwright/test");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const TODOAPP_PORT = 3103;
const BASE = `http://127.0.0.1:${TODOAPP_PORT}`;
const PROJECT_ROOT = path.resolve(__dirname, "..");
const SERVER_SCRIPT = path.join(
  PROJECT_ROOT,
  "projects",
  "todotestapp",
  "server.js",
);
// Use the parent project's better-sqlite3 install.
const Database = require(path.join(
  PROJECT_ROOT,
  "node_modules",
  "better-sqlite3",
));

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
          return reject(new Error("health check never reached 200"));
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
    `todotestapp-crud-${Date.now()}-${process.pid}.db`,
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
      setTimeout(() => {
        try {
          serverProc.kill("SIGKILL");
        } catch (_) {}
        resolve();
      }, 2500);
    });
  }
  for (const suffix of ["", "-shm", "-wal"]) {
    try {
      fs.unlinkSync(tmpDbPath + suffix);
    } catch (_) {
      /* ignore */
    }
  }
});

function readDbRow(id) {
  // Open the DB read-only so WAL writes are still observable.
  const db = new Database(tmpDbPath, { readonly: true });
  try {
    return db
      .prepare("SELECT id, title, status FROM todos WHERE id = ?")
      .get(id);
  } finally {
    db.close();
  }
}

test.setTimeout(60_000);

test("TodoTestApp supports create + edit + delete with SQLite persistence", async ({
  page,
}) => {
  await page.goto(BASE);
  await expect(page.getByTestId("kanban-board")).toBeVisible();

  // ------ Step 1 & 2: create a new todo ----------
  const originalTitle = `CRUD E2E ${Date.now()}`;
  await page.locator("#new-todo-input").fill(originalTitle);
  await page.locator("#new-todo-form button[type=submit]").click();
  await expect(page.getByTestId("count-backlog")).toHaveText("1");
  await expect(
    page.getByTestId("column-backlog").getByText(originalTitle),
  ).toBeVisible();

  const cardLocator = page
    .getByTestId("column-backlog")
    .locator(".todo-card")
    .first();
  const todoId = Number(await cardLocator.getAttribute("data-id"));
  expect(Number.isFinite(todoId) && todoId > 0).toBe(true);

  // DB row exists with the original title
  const rowCreated = readDbRow(todoId);
  expect(rowCreated).toBeTruthy();
  expect(rowCreated.title).toBe(originalTitle);
  expect(rowCreated.status).toBe("backlog");

  // ------ Step 3 & 4: edit the title ----------
  const updatedTitle = `${originalTitle} (edited)`;
  await page.getByTestId(`edit-${todoId}`).click();
  const editInput = page.getByTestId(`title-input-${todoId}`);
  await expect(editInput).toBeVisible();
  await editInput.fill(updatedTitle);
  await editInput.press("Enter");

  // UI reflects the new title (card re-renders via loadTodos)
  await expect(page.getByTestId(`title-${todoId}`)).toHaveText(updatedTitle);
  // Old title is gone from anywhere in the page
  await expect(page.getByText(originalTitle, { exact: true })).toHaveCount(0);

  // DB row reflects the new title
  const rowEdited = readDbRow(todoId);
  expect(rowEdited).toBeTruthy();
  expect(rowEdited.title).toBe(updatedTitle);

  // ------ Step 5 & 6: delete the todo ----------
  await page.getByTestId(`delete-${todoId}`).click();
  await expect(page.getByTestId(`title-${todoId}`)).toHaveCount(0);
  await expect(page.getByTestId("count-backlog")).toHaveText("0");
  await expect(page.getByTestId("count-in-progress")).toHaveText("0");
  await expect(page.getByTestId("count-done")).toHaveText("0");

  // DB row is gone
  const rowDeleted = readDbRow(todoId);
  expect(rowDeleted).toBeUndefined();
});
