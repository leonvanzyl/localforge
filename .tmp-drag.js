async (page) => {
  await page.evaluate(() => {
    window.__dragLog = [];
    window.addEventListener("error", (e) => window.__dragLog.push("err:" + e.message));
  });
  var card = page.locator('[data-testid="sortable-feature-card-78"]');
  var target = page.locator('[data-testid="kanban-column-body-in_progress"]');
  await card.dragTo(target, { force: true });
  await page.waitForTimeout(800);
  var resp = await page.evaluate(async () => {
    var r = await fetch("/api/features/78", { cache: "no-store" });
    return await r.json();
  });
  return { feature: resp.feature, log: await page.evaluate(() => window.__dragLog) };
};
