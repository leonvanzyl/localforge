/**
 * Feature #18 verification: "No horizontal scroll on any viewport."
 *
 * Visits http://localhost:3000/ , /settings, and two /projects/:id pages at
 * three viewport sizes (375, 768, 1920) and reports:
 *   1. document.documentElement.scrollWidth vs window.innerWidth
 *   2. any element whose bounding box extends past the viewport's right edge
 *      (ignoring descendants of an ancestor that already clips horizontal
 *      overflow - those create container-level scroll, not page-level)
 *
 * Also runs an extra pass at 375px with the mobile sidebar drawer open, to
 * ensure the slide-in navigation does not leak content past the right edge.
 *
 * Usage: node scripts/check-overflow-all.js
 */
const { chromium } = require("playwright");

const URLS = [
  { label: "home", url: "http://localhost:3000/" },
  { label: "settings", url: "http://localhost:3000/settings" },
  { label: "kanban-8", url: "http://localhost:3000/projects/8" },
  { label: "kanban-10", url: "http://localhost:3000/projects/10" },
];

const VIEWPORTS = [
  { w: 375, h: 667, label: "mobile" },
  { w: 768, h: 1024, label: "tablet" },
  { w: 1920, h: 1080, label: "desktop" },
];

function pageScript() {
  const w = window.innerWidth;
  const overflowing = [];
  document.querySelectorAll("*").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    let p = el.parentElement;
    let clipped = false;
    while (p && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      if (
        cs.overflowX === "hidden" ||
        cs.overflowX === "auto" ||
        cs.overflowX === "scroll" ||
        cs.overflow === "hidden" ||
        cs.overflow === "auto" ||
        cs.overflow === "scroll"
      ) {
        clipped = true;
        break;
      }
      p = p.parentElement;
    }
    if (clipped) return;
    if (r.right > w + 0.5) {
      overflowing.push({
        tag: el.tagName,
        testid: el.getAttribute("data-testid"),
        cls: String(el.className || "").slice(0, 100),
        right: Math.round(r.right),
        left: Math.round(r.left),
        w: Math.round(r.width),
      });
    }
  });
  return {
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    win: w,
    overflowCount: overflowing.length,
    firstOverflow: overflowing.slice(0, 10),
  };
}

async function runAt(browser, vp, target, extra) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`);
  });
  await page.goto(target.url, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);
  if (extra === "open-mobile-drawer") {
    const toggle = page.getByTestId("sidebar-toggle");
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(250);
    }
  }
  const result = await page.evaluate(pageScript);
  await ctx.close();
  return { result, consoleErrors };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let totalFails = 0;
  for (const vp of VIEWPORTS) {
    for (const target of URLS) {
      const { result, consoleErrors } = await runAt(browser, vp, target);
      const pageScroll = result.doc > result.win;
      const hasOverflow = result.overflowCount > 0;
      const ok = !pageScroll && !hasOverflow && consoleErrors.length === 0;
      if (!ok) totalFails++;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${target.label.padEnd(10)} ${vp.w}x${vp.h}: doc=${result.doc} body=${result.body} win=${result.win} overflow=${result.overflowCount} consoleErr=${consoleErrors.length}`,
      );
      if (hasOverflow) {
        for (const o of result.firstOverflow) {
          console.log(
            `  overflow: <${o.tag.toLowerCase()}${o.testid ? ` data-testid="${o.testid}"` : ""}> right=${o.right} width=${o.w} cls="${o.cls}"`,
          );
        }
      }
      if (consoleErrors.length) {
        for (const e of consoleErrors) console.log(`  ${e}`);
      }
    }
  }
  // Extra: mobile drawer open at 375 on home + kanban
  const mobile = VIEWPORTS[0];
  for (const target of [URLS[0], URLS[2]]) {
    const { result, consoleErrors } = await runAt(browser, mobile, target, "open-mobile-drawer");
    const pageScroll = result.doc > result.win;
    const hasOverflow = result.overflowCount > 0;
    const ok = !pageScroll && !hasOverflow && consoleErrors.length === 0;
    if (!ok) totalFails++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${target.label.padEnd(10)} ${mobile.w}x${mobile.h} [drawer-open]: doc=${result.doc} body=${result.body} win=${result.win} overflow=${result.overflowCount} consoleErr=${consoleErrors.length}`,
    );
    if (hasOverflow) {
      for (const o of result.firstOverflow) {
        console.log(
          `  overflow: <${o.tag.toLowerCase()}${o.testid ? ` data-testid="${o.testid}"` : ""}> right=${o.right} width=${o.w} cls="${o.cls}"`,
        );
      }
    }
  }
  await browser.close();
  if (totalFails > 0) {
    console.log(`\nTOTAL FAILS: ${totalFails}`);
    process.exit(1);
  }
  console.log("\nAll viewports pass - no horizontal overflow anywhere.");
})();
