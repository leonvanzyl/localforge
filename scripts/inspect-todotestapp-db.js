#!/usr/bin/env node
/**
 * Read-only inspector for the TodoTestApp SQLite database.
 * Prints every row (id, title, status, created_at) and a per-status count.
 * Used by feature #99 verification to prove real persistence (not an
 * in-memory / mock implementation).
 */

const path = require("node:path");
const fs = require("node:fs");
const Database = require(path.resolve(
  __dirname,
  "..",
  "node_modules",
  "better-sqlite3"
));

const dbPath = path.resolve(
  __dirname,
  "..",
  "projects",
  "todotestapp",
  "todos.db"
);

if (!fs.existsSync(dbPath)) {
  console.error(`ERROR: todos.db not found at ${dbPath}`);
  process.exit(2);
}

const db = new Database(dbPath, { readonly: true });

const rows = db
  .prepare("SELECT id, title, status, created_at FROM todos ORDER BY id ASC")
  .all();

const counts = rows.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] || 0) + 1;
  return acc;
}, {});

console.log(`db: ${dbPath}`);
console.log(`total rows: ${rows.length}`);
console.log(`counts by status:`, counts);
console.log(`--- rows ---`);
for (const r of rows) {
  console.log(
    `#${String(r.id).padEnd(3)} ${r.status.padEnd(12)} ${r.title}  (${r.created_at})`
  );
}

db.close();
