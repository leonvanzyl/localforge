// Delete any leftover UI_STOP_TEST_ projects so the sidebar stays clean.
const http = require("node:http");
const Database = require("better-sqlite3");

const db = new Database("./data/localforge.db", { readonly: true });
const rows = db
  .prepare("SELECT id, name FROM projects WHERE name LIKE 'UI_STOP_TEST_%' OR name LIKE 'STOP_TEST_%'")
  .all();

function del(projectId) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: 3000,
        path: `/api/projects/${projectId}`,
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: buf }));
      },
    );
    req.on("error", reject);
    req.write(JSON.stringify({ removeFiles: true }));
    req.end();
  });
}

(async () => {
  for (const row of rows) {
    const res = await del(row.id);
    console.log(`deleted ${row.id} ${row.name} -> ${res.status}`);
  }
})();
