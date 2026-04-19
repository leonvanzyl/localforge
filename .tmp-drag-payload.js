async (page) => {
  var card = page.locator('[data-testid="sortable-feature-card-78"]');
  var target = page.locator('[data-testid="kanban-column-body-in_progress"]');
  await card.dragTo(target, { force: true });
  await page.waitForTimeout(800);
  var data = await page.evaluate(async () => {
    var r = await fetch('/api/features/78', { cache: 'no-store' });
    var d = await r.json();
    return d.feature;
  });
  return data;
};
