/**
 * Browser-side helper: returns JSON describing any element whose bounding box
 * extends past the current viewport width. Used by feature #18 verification.
 *
 * Read this with Node.js (fs.readFileSync) and pass as a single-expression
 * argument to `playwright-cli eval`. Written as a plain function expression
 * so it can be passed through the CLI safely.
 */
(() => {
  const w = window.innerWidth;
  const overflowing = [];
  document.querySelectorAll("*").forEach((el) => {
    const r = el.getBoundingClientRect();
    // Ignore hidden elements (offsetParent===null means display:none ancestor, or fixed without layout)
    // But keep fixed/absolute since they can cause overflow too.
    if (r.width === 0 && r.height === 0) return;
    if (r.right > w + 0.5) {
      overflowing.push({
        tag: el.tagName,
        testid: el.getAttribute("data-testid"),
        cls: String(el.className || "").slice(0, 120),
        right: Math.round(r.right),
        left: Math.round(r.left),
        w: Math.round(r.width),
      });
    }
  });
  return JSON.stringify({
    count: overflowing.length,
    winW: w,
    first10: overflowing.slice(0, 10),
  });
})();
