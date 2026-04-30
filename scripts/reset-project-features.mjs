#!/usr/bin/env node
// Wipe every feature for a given project via the running LocalForge HTTP
// API, regardless of status (backlog, in_progress, completed). The UI's
// per-column "Clear" button can only clear the Completed column, so this
// script covers the case where the backlog / in-progress columns need to
// be reset between test runs.
//
// Uses the existing single-feature DELETE endpoint — no new bulk API
// needed, and the same code path the UI uses, so timestamps and FK
// behaviour stay consistent.
//
// Usage:
//   node scripts/reset-project-features.mjs <projectId> [baseUrl]
//
// Example (DreamForgeIdeas at project id 2, default port 7777):
//   node scripts/reset-project-features.mjs 2
//
// Prerequisites:
//   - LocalForge dev server running (npm run dev)
//   - Target project exists; if not, this script is a no-op

const projectIdArg = process.argv[2];
const baseUrl = process.argv[3] ?? "http://localhost:7777";

if (!projectIdArg || !/^[0-9]+$/.test(projectIdArg)) {
  console.error(
    "usage: node scripts/reset-project-features.mjs <projectId> [baseUrl]",
  );
  process.exit(2);
}
const projectId = Number.parseInt(projectIdArg, 10);

const listRes = await fetch(`${baseUrl}/api/projects/${projectId}/features`, {
  cache: "no-store",
});
if (!listRes.ok) {
  console.error(
    `GET ${baseUrl}/api/projects/${projectId}/features → ${listRes.status}`,
  );
  process.exit(1);
}
const listData = await listRes.json();
const features = Array.isArray(listData?.features) ? listData.features : [];
if (features.length === 0) {
  console.log(`Project ${projectId} has no features. Nothing to delete.`);
  process.exit(0);
}

console.log(
  `Deleting ${features.length} feature${features.length === 1 ? "" : "s"} from project ${projectId}...`,
);

let ok = 0;
let failed = 0;
for (const f of features) {
  const res = await fetch(`${baseUrl}/api/features/${f.id}`, {
    method: "DELETE",
  });
  if (res.ok) {
    console.log(`  - #${f.id}  ${f.title} (${f.status})`);
    ok++;
  } else {
    const text = await res.text();
    console.error(`  ! #${f.id}  ${f.title} → ${res.status}: ${text}`);
    failed++;
  }
}

console.log(`\nDone. ${ok} deleted, ${failed} failed.`);
if (failed > 0) process.exit(1);
