#!/usr/bin/env node
/**
 * Read-only helper: show project row by id.
 * Usage: node scripts/inspect-project.js <projectId>
 */
const Database = require("better-sqlite3");
const path = require("node:path");

const projectId = Number.parseInt(process.argv[2] ?? "0", 10);
if (!Number.isFinite(projectId) || projectId <= 0) {
  console.error("Usage: node scripts/inspect-project.js <projectId>");
  process.exit(1);
}
const db = new Database(path.join(process.cwd(), "data", "localforge.db"));
const rows = db.prepare("SELECT * FROM projects WHERE id = ?").all(projectId);
console.log(JSON.stringify(rows, null, 2));
