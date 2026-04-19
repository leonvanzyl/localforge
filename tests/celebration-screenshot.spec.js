// Take a screenshot of the celebration screen for visual verification.
const { test, expect } = require("@playwright/test");
const http = require("node:http");
const path = require("node:path");

const BASE = "http://localhost:3000";

function httpReq(method, p, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(p, BASE);
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

test("screenshot celebration screen", async ({ page }) => {
  const unique = `SHOT_CELEBRATION_${Date.now()}`;
  const proj = await httpReq("POST", "/api/projects", { name: unique });
  const projectId = proj.body.project.id;
  const feat = await httpReq(
    "POST",
    `/api/projects/${projectId}/features`,
    {
      title: `${unique}_FEAT`,
      description: "demo completion",
    },
  );
  const featureId = feat.body.feature.id;
  await httpReq("PATCH", `/api/features/${featureId}`, { status: "completed" });
  await httpReq("PATCH", `/api/projects/${projectId}`, { status: "completed" });

  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/projects/${projectId}`);
    await expect(page.getByTestId("celebration-screen")).toBeVisible();
    // Allow confetti to render
    await page.waitForTimeout(500);
    const outputPath = path.resolve(
      "screenshots",
      "feature-101-celebration.png",
    );
    await page.screenshot({ path: outputPath, fullPage: true });
    console.log("Screenshot saved to:", outputPath);
  } finally {
    await httpReq(
      "DELETE",
      `/api/projects/${projectId}?removeFiles=true`,
    );
  }
});
