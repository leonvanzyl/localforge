#!/usr/bin/env node
/**
 * Dumps the latest test_result and screenshot log rows from agent_logs so we
 * can see what the agent runner actually produced during real orchestrator
 * runs. Read-only — safe to execute while the dev server is up.
 */
import Database from "better-sqlite3";

const db = new Database("data/localforge.db", { readonly: true });

const rows = db
  .prepare(
    "SELECT id, feature_id, message_type, message, screenshot_path, created_at FROM agent_logs WHERE message_type IN ('test_result','screenshot') ORDER BY id DESC LIMIT 30"
  )
  .all();

console.log(JSON.stringify(rows, null, 2));

const grouped = db
  .prepare(
    "SELECT feature_id, message_type, COUNT(*) as n FROM agent_logs WHERE message_type IN ('test_result','screenshot') GROUP BY feature_id, message_type ORDER BY feature_id"
  )
  .all();
console.log("---grouped---");
console.log(JSON.stringify(grouped, null, 2));
