/*
 * Dev-only inspection helper for orchestrator features.
 * Usage: node scripts/check-project.js <projectId>
 */
const Database = require("better-sqlite3");
const projectId = Number.parseInt(process.argv[2] || "0", 10);
if (!Number.isFinite(projectId) || projectId <= 0) {
  process.stderr.write("Usage: node scripts/check-project.js <projectId>\n");
  process.exit(2);
}
const db = new Database("./data/localforge.db");
const features = db
  .prepare(
    "SELECT id, title, status, priority FROM features WHERE project_id = ? ORDER BY priority, id",
  )
  .all(projectId);
process.stdout.write(`FEATURES (${features.length}):\n`);
for (const f of features) {
  process.stdout.write(`  #${f.id} [${f.status}] p${f.priority} ${f.title}\n`);
}
const sessions = db
  .prepare(
    "SELECT id, feature_id, session_type, status, started_at, ended_at FROM agent_sessions WHERE project_id = ? ORDER BY id DESC LIMIT 10",
  )
  .all(projectId);
process.stdout.write(`\nRECENT SESSIONS (${sessions.length}):\n`);
for (const s of sessions) {
  process.stdout.write(
    `  session #${s.id} [${s.status}] type=${s.session_type} feature=${s.feature_id} started=${s.started_at} ended=${s.ended_at}\n`,
  );
}
