import { test, expect } from "@playwright/test";

/**
 * Feature #96 verification: open the feature detail modal for feature #48
 * (which has a real `screenshotPath` log row after a live coding-agent run)
 * and assert the screenshot image renders inline inside the agent activity
 * section.
 *
 * This spec is NOT part of the auto-generated per-feature specs — it lives in
 * the harness's own `tests/` directory and is executed manually via
 * `npx playwright test tests/feat96-dialog-screenshot.spec.ts`.
 */
test.describe("Feature #96 screenshot rendering", () => {
  test("feature 48 detail modal shows inline screenshot", async ({ page }) => {
    await page.goto("/projects/31");

    // The kanban card for feature 48 has `data-feature-id="48"` but clicking
    // it opens the detail modal. We navigate by finding its title first.
    const card = page.locator(`[data-feature-id="48"]`).first();
    await card.click();

    const logList = page.getByTestId("feature-detail-logs-list");
    await expect(logList).toBeVisible({ timeout: 15_000 });

    const screenshotLog = page.locator(
      '[data-testid^="feature-detail-log-screenshot-"]',
    );
    await expect(screenshotLog).toBeVisible();

    // The image must load successfully — naturalWidth > 0 confirms the
    // browser actually fetched and decoded bytes from /api/screenshots/*.
    const img = screenshotLog.locator("img");
    await expect(img).toBeVisible();

    // Wait for the <img> to finish loading — `toBeVisible` only tells us the
    // element is in the DOM, it doesn't guarantee the bytes came back yet.
    // `complete && naturalWidth > 0` is the canonical check for a decoded
    // image in the browser, and polling lets us tolerate a slow first paint.
    await expect
      .poll(
        async () =>
          img.evaluate(
            (el: HTMLImageElement) => el.complete && el.naturalWidth,
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  });
});
