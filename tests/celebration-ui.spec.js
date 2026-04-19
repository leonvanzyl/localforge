// Playwright test for Feature #101 — celebration screen when all features
// complete.
//
// We avoid running the orchestrator because parallel test runs contend on
// one LM Studio / agent-runner simulator and the completion time becomes
// unpredictable. Instead we seed a project + feature + mark everything
// "completed" directly via the REST API, then navigate the page and assert
// the UI behaves correctly.
const { test, expect } = require("@playwright/test");
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

test.setTimeout(60_000);

test("celebration screen renders for a completed project", async ({ page }) => {
  const unique = `UI_CELEBRATION_${Date.now()}`;
  const proj = await httpReq("POST", "/api/projects", { name: unique });
  expect(proj.status).toBeLessThan(300);
  const projectId = proj.body.project.id;

  const feat = await httpReq("POST", `/api/projects/${projectId}/features`, {
    title: `${unique}_FEAT`,
    description: "seeded completion",
  });
  expect(feat.status).toBeLessThan(300);
  const featureId = feat.body.feature.id;

  // Mark feature + project completed directly — bypasses the orchestrator.
  await httpReq("PATCH", `/api/features/${featureId}`, { status: "completed" });
  await httpReq("PATCH", `/api/projects/${projectId}`, { status: "completed" });

  try {
    await page.goto(`${BASE}/projects/${projectId}`);

    await expect(page.getByTestId("celebration-screen")).toBeVisible();
    await expect(page.getByTestId("celebration-heading")).toHaveText(
      /Project Complete/i,
    );
    await expect(page.getByTestId("celebration-project-name")).toContainText(
      unique,
    );
    await expect(page.getByTestId("celebration-stats")).toBeVisible();
    await expect(page.getByTestId("celebration-stat-features")).toContainText(
      "1 / 1",
    );
    await expect(page.getByTestId("celebration-stat-tests")).toBeVisible();
    await expect(page.getByTestId("celebration-stat-duration")).toBeVisible();

    // Toggle to kanban view
    await page.getByTestId("celebration-view-kanban").click();
    await expect(page.getByTestId("completed-banner")).toBeVisible();

    // Toggle back to celebration
    await page.getByTestId("show-celebration-button").click();
    await expect(page.getByTestId("celebration-screen")).toBeVisible();
  } finally {
    await httpReq(
      "DELETE",
      `/api/projects/${projectId}?removeFiles=true`,
    );
  }
});
