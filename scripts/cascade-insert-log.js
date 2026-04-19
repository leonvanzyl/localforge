// Insert an agent_log row and a project-scoped settings row directly into the
// SQLite DB, so feature #27 (delete project cascade) can verify that cascade
// deletes from all related tables.
//
// Usage: node scripts/cascade-insert-log.js <projectId> <sessionId>
const path = require("node:path");
const Database = require("better-sqlite3");

const projectId = Number.parseInt(process.argv[2], 10);
const sessionId = Number.parseInt(process.argv[3], 10);
if (!Number.isFinite(projectId) || !Number.isFinite(sessionId)) {
  process.stderr.write(
    "Usage: node scripts/cascade-insert-log.js <projectId> <sessionId>\n",
  );
  process.exit(2);
}

const dbPath =
  process.env.LOCALFORGE_DB_PATH ||
  path.join(process.cwd(), "data", "localforge.db");
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const log = db
  .prepare(
    "INSERT INTO agent_logs (session_id, message, message_type) VALUES (?, ?, ?) RETURNING id",
  )
  .get(sessionId, "CASCADE_TEST agent log entry", "info");

const setting = db
  .prepare(
    "INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?) RETURNING id",
  )
  .get(projectId, "model", "google/gemma-test-cascade");

process.stdout.write(
  JSON.stringify(
    {
      agent_log_id: log.id,
      setting_id: setting.id,
    },
    null,
    2,
  ) + "\n",
);
