// Inspect agent_logs in the DB. Find a feature that has >=1 log row and
// print its project id + title so we can visit the UI for verification.
const Database = require("better-sqlite3");
const path = require("node:path");

const dbPath = path.join(__dirname, "..", "data", "localforge.db");
const db = new Database(dbPath, { readonly: true });

const feats = db
  .prepare(
    `SELECT f.id as fid, f.project_id as pid, f.title, f.status,
            COUNT(l.id) as log_count
     FROM features f
     LEFT JOIN agent_logs l ON l.feature_id = f.id
     GROUP BY f.id
     HAVING log_count > 0
     ORDER BY log_count DESC
     LIMIT 10`,
  )
  .all();

console.log(`features_with_logs (${feats.length}):`);
for (const row of feats) {
  console.log(
    `  fid=${row.fid} pid=${row.pid} logs=${row.log_count} status=${row.status} title=${row.title}`,
  );
}

const totals = db
  .prepare(
    `SELECT
        (SELECT COUNT(*) FROM agent_logs) AS logs_total,
        (SELECT COUNT(*) FROM agent_logs WHERE feature_id IS NOT NULL) AS logs_with_feature,
        (SELECT COUNT(DISTINCT message_type) FROM agent_logs) AS distinct_message_types,
        (SELECT GROUP_CONCAT(DISTINCT message_type) FROM agent_logs) AS message_types`,
  )
  .get();
console.log(`totals: ${JSON.stringify(totals)}`);

const projs = db
  .prepare(
    `SELECT id, name, folder_path, status FROM projects ORDER BY id DESC LIMIT 10`,
  )
  .all();
console.log(`recent projects:`);
for (const p of projs) {
  console.log(`  id=${p.id} status=${p.status} name=${p.name} path=${p.folder_path}`);
}
