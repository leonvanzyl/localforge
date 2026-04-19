#!/usr/bin/env node
/**
 * Read-only inspection of the chat_messages table for a given session.
 *
 * Used during the Feature #91 verification ("E2E AI bootstrapper conversation
 * uses real local model") to prove that both the user message AND the LM
 * Studio assistant reply landed in the real SQLite database (not an in-memory
 * mock).
 *
 * Usage:  node scripts/inspect-chat-messages.js <sessionId>
 */
const Database = require("better-sqlite3");
const path = require("path");

const sessionId = Number.parseInt(process.argv[2], 10);
if (!Number.isFinite(sessionId) || sessionId <= 0) {
  console.error("Usage: node scripts/inspect-chat-messages.js <sessionId>");
  process.exit(2);
}

const dbPath = path.join(process.cwd(), "data", "localforge.db");
const db = new Database(dbPath, { readonly: true });

const rows = db
  .prepare(
    "SELECT id, session_id, role, length(content) AS chars, substr(content, 1, 200) AS preview, created_at FROM chat_messages WHERE session_id = ? ORDER BY id ASC",
  )
  .all(sessionId);

console.log(`Session ${sessionId} has ${rows.length} chat messages:`);
for (const r of rows) {
  console.log(
    `  #${r.id} ${r.role.padEnd(9)} chars=${String(r.chars).padStart(4)} at=${r.created_at}`,
  );
  console.log(`    preview: ${JSON.stringify(r.preview)}`);
}

db.close();
