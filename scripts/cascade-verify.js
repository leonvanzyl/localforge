// Query the SQLite DB to verify that cascade deletes removed every related row
// for a given project id. Feature #27 uses this to prove no orphans remain.
//
// Usage: node scripts/cascade-verify.js <projectId> <featureIdsCSV> <sessionIdsCSV>
//
// Example: node scripts/cascade-verify.js 15 9,10,11 2
const path = require("node:path");
const Database = require("better-sqlite3");

const projectId = Number.parseInt(process.argv[2], 10);
const featureIds = (process.argv[3] || "")
  .split(",")
  .map((s) => Number.parseInt(s, 10))
  .filter((n) => Number.isFinite(n));
const sessionIds = (process.argv[4] || "")
  .split(",")
  .map((s) => Number.parseInt(s, 10))
  .filter((n) => Number.isFinite(n));

const dbPath =
  process.env.LOCALFORGE_DB_PATH ||
  path.join(process.cwd(), "data", "localforge.db");
const db = new Database(dbPath, { readonly: true });
db.pragma("foreign_keys = ON");

function countByProject(table, col = "project_id") {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`)
    .get(projectId).n;
}

function countForIds(table, col, ids) {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} IN (${placeholders})`)
    .get(...ids).n;
}

const result = {
  project: db
    .prepare("SELECT COUNT(*) AS n FROM projects WHERE id = ?")
    .get(projectId).n,
  features: countByProject("features"),
  feature_dependencies: countForIds(
    "feature_dependencies",
    "feature_id",
    featureIds,
  ),
  feature_dependencies_as_target: countForIds(
    "feature_dependencies",
    "depends_on_feature_id",
    featureIds,
  ),
  agent_sessions: countByProject("agent_sessions"),
  agent_logs: countForIds("agent_logs", "session_id", sessionIds),
  chat_messages: countForIds("chat_messages", "session_id", sessionIds),
  settings: countByProject("settings"),
};

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
