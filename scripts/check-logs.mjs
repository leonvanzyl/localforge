#!/usr/bin/env node
/**
 * Tiny helper: read /api/features/:id/logs via http and summarise
 * the messageType counts. Used manually during batch verification.
 */
const featureId = Number.parseInt(process.argv[2] ?? "0", 10);
if (!Number.isFinite(featureId) || featureId <= 0) {
  console.error("Usage: node scripts/check-logs.mjs <featureId>");
  process.exit(1);
}

const res = await fetch(`http://localhost:7777/api/features/${featureId}/logs`);
const data = await res.json();
const logs = data.logs ?? [];
const byType = new Map();
for (const log of logs) {
  byType.set(log.messageType, (byType.get(log.messageType) ?? 0) + 1);
}
console.log(`Feature #${featureId} total logs: ${logs.length}`);
for (const [k, v] of byType) console.log(`  ${k}: ${v}`);
const screenshots = logs.filter(
  (l) => l.messageType === "screenshot" && l.screenshotPath,
);
for (const s of screenshots) console.log("  path:", s.screenshotPath);
