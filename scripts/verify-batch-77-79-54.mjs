#!/usr/bin/env node
/**
 * Programmatic Playwright verification for the batch of features
 * #77 (test badge), #79 (screenshot gallery + lightbox), #54 (no
 * double-submit). Drives the running Next.js dev server on :3000.
 *
 * Writes up to four screenshots under <repo>/screenshots/ named
 * "batch-77-79-54-*.png" for manual inspection.
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = "http://localhost:3000";
const projectId = 64;
const passFeatureId = 102;
const failFeatureId = 114;

const shotDir = path.join(root, "screenshots");
fs.mkdirSync(shotDir, { recursive: true });

const results = [];
function record(name, ok, detail = "") {
  const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`;
  console.log(line);
  results.push({ name, ok, detail });
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

try {
  // --- #77: badge on feature card ---
  await page.goto(`${baseUrl}/projects/${projectId}`, {
    waitUntil: "networkidle",
  });

  // Pass badge
  const passBadge = page.locator(
    `[data-testid="feature-card-test-result-${passFeatureId}"]`,
  );
  await passBadge.waitFor({ state: "visible", timeout: 5000 });
  const passOk = await passBadge.getAttribute("data-test-ok");
  const passLabel = await passBadge.getAttribute("aria-label");
  record(
    "#77 pass badge visible with data-test-ok=true",
    passOk === "true",
    `aria-label="${passLabel}"`,
  );

  // Fail badge
  const failBadge = page.locator(
    `[data-testid="feature-card-test-result-${failFeatureId}"]`,
  );
  await failBadge.waitFor({ state: "visible", timeout: 5000 });
  const failOk = await failBadge.getAttribute("data-test-ok");
  const failLabel = await failBadge.getAttribute("aria-label");
  record(
    "#77 fail badge visible with data-test-ok=false",
    failOk === "false",
    `aria-label="${failLabel}"`,
  );

  await page.screenshot({
    path: path.join(shotDir, "batch-77-badges.png"),
    fullPage: false,
  });

  // --- #79: open the detail dialog and verify gallery ---
  await page
    .locator(`[data-testid="feature-card-${passFeatureId}"]`)
    .click();

  const grid = page.locator('[data-testid="feature-detail-screenshots-grid"]');
  await grid.waitFor({ state: "visible", timeout: 5000 });
  const thumbCount = await grid.locator("button").count();
  record(
    "#79 gallery has 3+ thumbnails",
    thumbCount >= 3,
    `thumbs=${thumbCount}`,
  );

  await page.screenshot({
    path: path.join(shotDir, "batch-79-gallery.png"),
    fullPage: false,
  });

  // Click first thumbnail
  await grid.locator("button").first().click();
  const lightbox = page.locator('[data-testid="feature-detail-lightbox"]');
  await lightbox.waitFor({ state: "visible", timeout: 3000 });
  const captionAfterOpen = await page
    .locator('[data-testid="feature-detail-lightbox-caption"]')
    .innerText();
  record(
    "#79 lightbox opens on thumbnail click",
    captionAfterOpen.startsWith("1 /"),
    `caption="${captionAfterOpen}"`,
  );
  await page.screenshot({
    path: path.join(shotDir, "batch-79-lightbox-1.png"),
    fullPage: false,
  });

  // Next
  await page.locator('[data-testid="feature-detail-lightbox-next"]').click();
  const captionAfterNext = await page
    .locator('[data-testid="feature-detail-lightbox-caption"]')
    .innerText();
  record(
    "#79 next button advances to image 2",
    captionAfterNext.startsWith("2 /"),
    `caption="${captionAfterNext}"`,
  );

  // Arrow key navigation
  await page.keyboard.press("ArrowRight");
  const captionAfterArrow = await page
    .locator('[data-testid="feature-detail-lightbox-caption"]')
    .innerText();
  record(
    "#79 ArrowRight advances to image 3",
    captionAfterArrow.startsWith("3 /"),
    `caption="${captionAfterArrow}"`,
  );

  // Escape closes
  await page.keyboard.press("Escape");
  await lightbox.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  const lightboxVisible = await lightbox.isVisible();
  record("#79 Escape closes lightbox", !lightboxVisible);

  // Close detail dialog
  await page.locator('[data-testid="feature-detail-cancel"]').click();

  // --- #54: double-click Add Feature ---
  // Count features before
  const beforeRes = await fetch(
    `${baseUrl}/api/projects/${projectId}/features`,
  );
  const beforeData = await beforeRes.json();
  const beforeCount = (beforeData.features ?? []).filter(
    (f) => f.title === "BATCH_DUP_SAFETY",
  ).length;

  // Open add-feature modal
  await page.locator('[data-testid="add-feature-trigger"]').click();
  const titleInput = page.locator('[data-testid="add-feature-title-input"]');
  await titleInput.waitFor({ state: "visible", timeout: 3000 });
  // Use a unique title so we can count precisely even across retries
  const uniqueTitle = "BATCH_DUP_SAFETY_" + Date.now();
  await titleInput.fill(uniqueTitle);

  // Fire two clicks in rapid succession, WITHOUT awaiting in between.
  // Playwright's click() auto-waits, so we have to fire real DOM events
  // to truly test the synchronous guard.
  const submit = page.locator('[data-testid="add-feature-submit"]');
  await submit.evaluate((el) => {
    // Two synchronous clicks within the same task.
    el.click();
    el.click();
  });

  // Wait for the modal to close
  await page
    .locator('[data-testid="add-feature-submit"]')
    .waitFor({ state: "hidden", timeout: 5000 })
    .catch(() => {});

  // Give the server a beat to process
  await page.waitForTimeout(300);

  const afterRes = await fetch(
    `${baseUrl}/api/projects/${projectId}/features`,
  );
  const afterData = await afterRes.json();
  const afterMatches = (afterData.features ?? []).filter(
    (f) => f.title === uniqueTitle,
  );
  record(
    "#54 double-click creates exactly ONE feature",
    afterMatches.length === 1,
    `count=${afterMatches.length} (title=${uniqueTitle})`,
  );

  await page.screenshot({
    path: path.join(shotDir, "batch-54-after-submit.png"),
    fullPage: false,
  });
} finally {
  await browser.close();
}

const failures = results.filter((r) => !r.ok);
if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${results.length} checks passed`);
