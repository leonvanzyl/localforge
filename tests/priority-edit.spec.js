// Playwright test for Feature #45 — edit feature priority via the
// feature detail dialog.
//
// We seed the project + features via REST so the test does not depend on
// the orchestrator or LM Studio. Then we drive the dialog in a real
// browser to confirm:
//   1. The Priority field renders with the current priority.
//   2. Editing the value and clicking Save persists priority through the
//      same PATCH /api/features/:id endpoint the rest of the dialog uses.
//   3. The kanban re-orders so the lower-priority feature jumps to the top
//      of its column.
//   4. The new priority survives a full page reload (Drizzle/SQLite write
//      reached disk, not just optimistic state).
const { test, expect } = require("@playwright/test");
const http = require("node:http");

const BASE = "http://localhost:7777";

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

async function createProject(name) {
  const r = await httpReq("POST", "/api/projects", {
    name,
    description: "priority edit verification",
  });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`Create project failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body.project;
}

async function createFeature(projectId, title, priority) {
  const r = await httpReq("POST", `/api/projects/${projectId}/features`, {
    category: "functional",
    title,
    priority,
  });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`Create feature failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body.feature;
}

async function deleteProject(projectId) {
  await httpReq("DELETE", `/api/projects/${projectId}`);
}

async function getFeature(featureId) {
  const r = await httpReq("GET", `/api/features/${featureId}`);
  return r.body.feature;
}

test.describe("Feature #45 - edit feature priority", () => {
  test("editing priority in dialog reorders kanban and persists to DB", async ({
    page,
  }) => {
    const uniq = `PRIO_EDIT_${Date.now()}`;
    const project = await createProject(uniq);
    const fA = await createFeature(project.id, `${uniq}_A`, 1);
    const fB = await createFeature(project.id, `${uniq}_B`, 2);
    const fC = await createFeature(project.id, `${uniq}_C`, 3);

    try {
      await page.goto(`${BASE}/projects/${project.id}`);

      // Wait for the kanban to render with all 3 cards.
      await expect(page.getByTestId(`feature-card-${fA.id}`)).toBeVisible();
      await expect(page.getByTestId(`feature-card-${fB.id}`)).toBeVisible();
      await expect(page.getByTestId(`feature-card-${fC.id}`)).toBeVisible();

      // Sanity check: initial backlog order is A, B, C (priorities 1,2,3).
      const backlog = page.getByTestId("kanban-column-backlog");
      const initialOrder = await backlog
        .locator('[data-testid^="feature-card-title-"]')
        .allTextContents();
      expect(initialOrder).toEqual([
        `${uniq}_A`,
        `${uniq}_B`,
        `${uniq}_C`,
      ]);

      // Open feature B's detail modal by clicking the card button.
      await page.getByTestId(`feature-card-${fB.id}`).click();
      await expect(
        page.getByTestId("feature-detail-priority-input"),
      ).toBeVisible();

      // The Priority input should reflect the existing priority (2).
      await expect(
        page.getByTestId("feature-detail-priority-input"),
      ).toHaveValue("2");

      // Change priority to 0 and save.
      await page.getByTestId("feature-detail-priority-input").fill("0");
      await page.getByTestId("feature-detail-save").click();

      // Dialog should close on success. Then the kanban should rerender
      // with B at the top (priority 0 sorts first).
      await expect(
        page.getByTestId("feature-detail-priority-input"),
      ).toBeHidden();

      await expect
        .poll(async () => {
          return await backlog
            .locator('[data-testid^="feature-card-title-"]')
            .allTextContents();
        }, { timeout: 5000 })
        .toEqual([`${uniq}_B`, `${uniq}_A`, `${uniq}_C`]);

      // Verify the DB row actually flipped to priority 0.
      const refreshed = await getFeature(fB.id);
      expect(refreshed.priority).toBe(0);

      // Reload the page and confirm the order persists across the round-trip.
      await page.reload();
      await expect(page.getByTestId(`feature-card-${fB.id}`)).toBeVisible();

      const reloadedBacklog = page.getByTestId("kanban-column-backlog");
      const reloadedOrder = await reloadedBacklog
        .locator('[data-testid^="feature-card-title-"]')
        .allTextContents();
      expect(reloadedOrder).toEqual([
        `${uniq}_B`,
        `${uniq}_A`,
        `${uniq}_C`,
      ]);
    } finally {
      await deleteProject(project.id);
    }
  });

  test("invalid priority is rejected client-side", async ({ page }) => {
    const uniq = `PRIO_INVALID_${Date.now()}`;
    const project = await createProject(uniq);
    const f = await createFeature(project.id, `${uniq}_X`, 5);

    try {
      await page.goto(`${BASE}/projects/${project.id}`);
      await expect(page.getByTestId(`feature-card-${f.id}`)).toBeVisible();
      await page.getByTestId(`feature-card-${f.id}`).click();
      await expect(
        page.getByTestId("feature-detail-priority-input"),
      ).toBeVisible();

      // Clear the input -> validation error, save blocked.
      await page.getByTestId("feature-detail-priority-input").fill("");
      await page.getByTestId("feature-detail-save").click();
      await expect(
        page.getByTestId("feature-detail-field-error"),
      ).toBeVisible();

      // DB should still hold original priority.
      const stored = await getFeature(f.id);
      expect(stored.priority).toBe(5);
    } finally {
      await deleteProject(project.id);
    }
  });
});
