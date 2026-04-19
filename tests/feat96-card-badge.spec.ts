import { test, expect } from "@playwright/test";

/**
 * Feature #96 verification, step 4: the feature kanban card must advertise
 * a pass/fail badge reflecting the latest Playwright run for that feature.
 *
 * Project 31 has two features (#37, #48) that were processed by a live
 * orchestrator session; both have `test_result` log rows with "1 passed, 0
 * failed". The card for each should render a green "1/1" badge with the
 * `data-test-ok="true"` attribute so automated checks can assert on it
 * without parsing CSS colours.
 */
test.describe("Feature #96 kanban pass/fail badge", () => {
  test("card for feature 48 shows 1/1 passing badge", async ({ page }) => {
    await page.goto("/projects/31");

    const badge = page.getByTestId("feature-card-test-result-48");
    await expect(badge).toBeVisible({ timeout: 15_000 });

    // Counts come from parsing the `npx playwright test completed: 1 passed,
    // 0 failed (626ms)` log message written by scripts/agent-runner.mjs.
    await expect(badge).toHaveAttribute("data-test-ok", "true");
    await expect(badge).toHaveAttribute("data-tests-passed", "1");
    await expect(badge).toHaveAttribute("data-tests-failed", "0");
    await expect(badge).toContainText("1/1");
  });

  test("card for feature 37 also advertises passing tests", async ({ page }) => {
    await page.goto("/projects/31");
    const badge = page.getByTestId("feature-card-test-result-37");
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await expect(badge).toHaveAttribute("data-test-ok", "true");
  });
});
