// Playwright test that navigates to a completed project and asserts the
// celebration UI renders. Drives setup/teardown through the HTTP API.
const { test, expect, request } = require("@playwright/test");
const Database = require("better-sqlite3");
const http = require("node:http");

const BASE = "http://localhost:3000";

function httpReq(method, path, body) {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("celebration screen renders for a completed project", async ({ page }) => {
  const unique = `UI_CELEBRATION_${Date.now()}`;
  const proj = await httpReq("POST", "/api/projects", { name: unique });
  const projectId = proj.body.project.id;
  await httpReq("POST", `/api/projects/${projectId}/features`, {
    title: `${unique}_FEAT`,
    description: "drive to complete",
  });
  await httpReq("POST", `/api/projects/${projectId}/orchestrator`, {
    action: "start",
    durationMs: 1500,
  });

  const db = new Database("./data/localforge.db", { readonly: true });
  const stmt = db.prepare("SELECT status FROM projects WHERE id = ?");
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const row = stmt.get(projectId);
    if (row && row.status === "completed") break;
  }
  expect(stmt.get(projectId).status).toBe("completed");
  db.close();

  try {
    await page.goto(`${BASE}/projects/${projectId}`);

    // Core celebration markers
    await expect(
      page.getByTestId("celebration-screen"),
      "celebration section should mount",
    ).toBeVisible();
    await expect(page.getByTestId("celebration-heading")).toHaveText(
      /Project Complete/i,
    );
    await expect(page.getByTestId("celebration-stats")).toBeVisible();

    // Stats populated (any non-empty values)
    const featureStat = page.getByTestId("celebration-stat-features");
    await expect(featureStat).toContainText("1 / 1");
    await expect(page.getByTestId("celebration-stat-tests")).toBeVisible();
    await expect(page.getByTestId("celebration-stat-duration")).toBeVisible();

    // Clicking "View kanban" toggles to the completed banner + board
    await page.getByTestId("celebration-view-kanban").click();
    await expect(page.getByTestId("completed-banner")).toBeVisible();

    // Toggling back restores the celebration
    await page.getByTestId("show-celebration-button").click();
    await expect(page.getByTestId("celebration-screen")).toBeVisible();
  } finally {
    // Cleanup
    await httpReq(
      "DELETE",
      `/api/projects/${projectId}?removeFiles=true`,
    );
  }
});
