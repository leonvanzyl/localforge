#!/usr/bin/env node
/**
 * Read-only helper: list chat_messages rows for a session id.
 * Usage: node scripts/inspect-messages-for-session.js <sessionId>
 */
const Database = require("better-sqlite3");
const path = require("node:path");

const sessionId = Number.parseInt(process.argv[2] ?? "0", 10);
if (!Number.isFinite(sessionId) || sessionId <= 0) {
  console.error("Usage: node scripts/inspect-messages-for-session.js <sessionId>");
  process.exit(1);
}
const db = new Database(path.join(process.cwd(), "data", "localforge.db"));
const rows = db
  .prepare(
    "SELECT id, session_id, role, length(content) as len, substr(content, 1, 80) as preview, created_at FROM chat_messages WHERE session_id = ? ORDER BY id",
  )
  .all(sessionId);
console.log(JSON.stringify(rows, null, 2));
