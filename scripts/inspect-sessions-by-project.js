#!/usr/bin/env node
/**
 * Read-only helper: list agent_sessions rows for a given project id.
 * Usage: node scripts/inspect-sessions-by-project.js <projectId>
 */
const Database = require("better-sqlite3");
const path = require("node:path");

const projectId = Number.parseInt(process.argv[2] ?? "0", 10);
if (!Number.isFinite(projectId) || projectId <= 0) {
  console.error("Usage: node scripts/inspect-sessions-by-project.js <projectId>");
  process.exit(1);
}
const db = new Database(path.join(process.cwd(), "data", "localforge.db"));
const rows = db
  .prepare(
    "SELECT id, project_id, session_type, status, started_at, ended_at FROM agent_sessions WHERE project_id = ? ORDER BY id",
  )
  .all(projectId);
console.log(JSON.stringify(rows, null, 2));
