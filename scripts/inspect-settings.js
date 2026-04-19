// One-shot script to inspect rows in the `settings` table.
// Used for manual verification of features #32 / #33 (LM Studio URL + Model).
const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(process.cwd(), "data", "localforge.db");
const db = new Database(dbPath, { readonly: true });

const rows = db
  .prepare(
    "SELECT id, project_id, key, value FROM settings ORDER BY project_id IS NULL DESC, key",
  )
  .all();

console.log("settings rows:");
for (const r of rows) {
  console.log(
    `  #${r.id}  project_id=${r.project_id ?? "NULL"}  ${r.key}=${JSON.stringify(r.value)}`,
  );
}
db.close();
