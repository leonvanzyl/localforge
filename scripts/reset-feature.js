/*
 * Dev-only helper: reset a feature back to "backlog".
 * Usage: node scripts/reset-feature.js <featureId>
 */
const Database = require("better-sqlite3");
const featureId = Number.parseInt(process.argv[2] || "0", 10);
if (!Number.isFinite(featureId) || featureId <= 0) {
  process.stderr.write("Usage: node scripts/reset-feature.js <featureId>\n");
  process.exit(2);
}
const db = new Database("./data/localforge.db");
const result = db
  .prepare(
    "UPDATE features SET status = 'backlog', updated_at = datetime('now') WHERE id = ?",
  )
  .run(featureId);
process.stdout.write(`UPDATED ${result.changes} row(s) for feature #${featureId}\n`);
const f = db
  .prepare("SELECT id, title, status, priority FROM features WHERE id = ?")
  .get(featureId);
process.stdout.write(`  #${f.id} [${f.status}] p${f.priority} ${f.title}\n`);
