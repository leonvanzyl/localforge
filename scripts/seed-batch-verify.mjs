#!/usr/bin/env node
/**
 * One-off verification seed for batch features #77 and #79.
 *
 * Seeds into the existing BATCH_TEST_76_78 project (id=64):
 *   1. Creates two extra PNG copies under screenshots/ and emits
 *      agent_logs rows pointing to them — so feature #102's gallery
 *      has 3+ images (Feature #79 requires step 1: "3+ screenshots").
 *   2. Creates a new feature "BATCH_FEATURE_FAIL" with a failing
 *      test_result log so the red badge variant of Feature #77 is
 *      exercised in the UI.
 *
 * Idempotent-ish: picks an unused session id via MAX(id)+1 so you can
 * run it multiple times without PK collisions.
 */
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new Database(path.join(root, "data", "localforge.db"));

const projectId = 64;
const featureId = 102; // BATCH_FEATURE_A

// 1. Copy the existing screenshot twice so we have 3 files on disk.
const srcPng = path.join(root, "screenshots", "feature-102-batch-feature-a.png");
if (!fs.existsSync(srcPng)) {
  console.error("missing source screenshot", srcPng);
  process.exit(1);
}
for (const name of [
  "feature-102-batch-feature-a-extra-1.png",
  "feature-102-batch-feature-a-extra-2.png",
]) {
  const dst = path.join(root, "screenshots", name);
  fs.copyFileSync(srcPng, dst);
  console.log("wrote", dst);
}

// 2. Insert extra screenshot log rows for feature #102.
// Reuse an existing sessionId — any session that already has feature_id=102.
const existingSession = db
  .prepare(
    "SELECT session_id AS sid FROM agent_logs WHERE feature_id = ? LIMIT 1",
  )
  .get(featureId);
if (!existingSession) {
  console.error("no existing session found for feature", featureId);
  process.exit(1);
}
const sid = existingSession.sid;

const insertLog = db.prepare(
  "INSERT INTO agent_logs (session_id, feature_id, message, message_type, screenshot_path, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
);

for (const rel of [
  "screenshots/feature-102-batch-feature-a-extra-1.png",
  "screenshots/feature-102-batch-feature-a-extra-2.png",
]) {
  const info = insertLog.run(
    sid,
    featureId,
    `Captured verification screenshot: ${rel}`,
    "screenshot",
    rel,
  );
  console.log("inserted screenshot log", info.lastInsertRowid, "->", rel);
}

// 3. Create a feature with a failing test_result so the red badge shows up.
// Features table: id (auto), project_id, title, description, acceptance_criteria,
// status, priority, category, created_at, updated_at
const maxPriority = db
  .prepare(
    "SELECT COALESCE(MAX(priority), 0) AS p FROM features WHERE project_id = ?",
  )
  .get(projectId).p;
const insertFeature = db
  .prepare(
    `INSERT INTO features (project_id, title, description, acceptance_criteria,
      status, priority, category, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, 'completed', ?, 'functional', datetime('now'), datetime('now'))`,
  )
  .run(projectId, "BATCH_FEATURE_FAIL", maxPriority + 1);
const failFeatureId = Number(insertFeature.lastInsertRowid);
console.log("created failing-test feature", failFeatureId);

insertLog.run(
  sid,
  failFeatureId,
  "npx playwright test completed: 0 passed, 2 failed (812ms)",
  "test_result",
  null,
);
console.log("inserted failing test_result for feature", failFeatureId);
