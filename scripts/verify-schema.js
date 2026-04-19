// One-shot schema verification script for Feature 2.
// Prints all tables and the columns of each expected table from the SQLite DB.
const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(process.cwd(), "data", "localforge.db");
const db = new Database(dbPath, { readonly: true });

const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'",
  )
  .all()
  .map((r) => r.name)
  .sort();

console.log("Tables found:", tables.join(", "));

const expected = [
  "projects",
  "features",
  "feature_dependencies",
  "agent_sessions",
  "agent_logs",
  "chat_messages",
  "settings",
];

let allOk = true;
for (const t of expected) {
  if (!tables.includes(t)) {
    console.log("MISSING TABLE:", t);
    allOk = false;
    continue;
  }
  const cols = db.prepare(`PRAGMA table_info(${t})`).all();
  console.log(`\n[${t}] columns: ${cols.map((c) => c.name).join(", ")}`);
}

console.log("\nResult:", allOk ? "OK - all expected tables present" : "FAIL");
db.close();
