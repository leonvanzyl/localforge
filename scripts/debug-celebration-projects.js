// Debug helper: list UI_CELEBRATION test projects and their feature state.
const Database = require("better-sqlite3");
const db = new Database("./data/localforge.db", { readonly: true });
const projects = db
  .prepare(
    "SELECT id, name, status, created_at FROM projects WHERE name LIKE 'UI_CELEBRATION_%' ORDER BY id DESC",
  )
  .all();
console.log("Projects:");
console.log(projects);
for (const p of projects) {
  const feats = db
    .prepare(
      "SELECT id, title, status, priority FROM features WHERE project_id = ?",
    )
    .all(p.id);
  const sessions = db
    .prepare(
      "SELECT id, session_type, status, started_at, ended_at FROM agent_sessions WHERE project_id = ?",
    )
    .all(p.id);
  console.log(`\nproject #${p.id} ${p.name} status=${p.status}`);
  console.log("  features:", feats);
  console.log("  sessions:", sessions);
}
