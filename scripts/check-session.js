/*
 * Dev-only inspection helper used while verifying orchestrator features.
 * Usage: node scripts/check-session.js <sessionId>
 */
const Database = require("better-sqlite3");
const sessionId = Number.parseInt(process.argv[2] || "0", 10);
if (!Number.isFinite(sessionId) || sessionId <= 0) {
  process.stderr.write("Usage: node scripts/check-session.js <sessionId>\n");
  process.exit(2);
}
const db = new Database("./data/localforge.db");
const session = db
  .prepare(
    "SELECT id, project_id, feature_id, session_type, status, started_at, ended_at FROM agent_sessions WHERE id = ?",
  )
  .get(sessionId);
process.stdout.write(JSON.stringify(session, null, 2) + "\n");
const logs = db
  .prepare(
    "SELECT id, session_id, feature_id, message, message_type, created_at FROM agent_logs WHERE session_id = ? ORDER BY id",
  )
  .all(sessionId);
process.stdout.write(`LOGS: ${logs.length} rows\n`);
for (const l of logs) {
  process.stdout.write(`  [${l.message_type}] ${l.message}\n`);
}
