#!/usr/bin/env node
/**
 * Read-only helper: show feature row by id with full acceptance criteria.
 * Usage: node scripts/inspect-feature-detail.js <featureId>
 */
const Database = require("better-sqlite3");
const path = require("node:path");

const featureId = Number.parseInt(process.argv[2] ?? "0", 10);
if (!Number.isFinite(featureId) || featureId <= 0) {
  console.error("Usage: node scripts/inspect-feature-detail.js <featureId>");
  process.exit(1);
}
const db = new Database(path.join(process.cwd(), "data", "localforge.db"));
const rows = db
  .prepare(
    "SELECT id, project_id, title, description, acceptance_criteria, status, updated_at FROM features WHERE id = ?",
  )
  .all(featureId);
console.log(JSON.stringify(rows, null, 2));
