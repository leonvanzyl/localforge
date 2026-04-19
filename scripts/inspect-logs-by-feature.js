// Dump every agent_logs row for a given feature id so we can spot-check that
// messages are human-readable (Feature #73). Usage: node scripts/inspect-logs-by-feature.js <featureId>
const Database = require("better-sqlite3");
const path = require("node:path");

const fid = Number.parseInt(process.argv[2] ?? "0", 10);
if (!Number.isFinite(fid) || fid <= 0) {
  console.error("Usage: node scripts/inspect-logs-by-feature.js <featureId>");
  process.exit(1);
}

const dbPath = path.join(__dirname, "..", "data", "localforge.db");
const db = new Database(dbPath, { readonly: true });

const rows = db
  .prepare(
    `SELECT id, session_id, feature_id, message_type, message, created_at
     FROM agent_logs
     WHERE feature_id = ?
     ORDER BY id ASC`,
  )
  .all(fid);

console.log(`Feature ${fid}: ${rows.length} log rows`);
const byType = new Map();
for (const r of rows) {
  byType.set(r.message_type, (byType.get(r.message_type) ?? 0) + 1);
}
console.log(`message_type counts:`, Object.fromEntries(byType));
console.log("---");
for (const r of rows) {
  const msg = String(r.message).replace(/\n+/g, " ").slice(0, 200);
  console.log(`#${r.id} [${r.message_type}] ${msg}`);
}
