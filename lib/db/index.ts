import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

/**
 * Singleton SQLite connection + Drizzle ORM client.
 *
 * The SQLite file lives under ./data/localforge.db (configurable via
 * LOCALFORGE_DB_PATH). The data/ directory is created on first run so that
 * the server can start with no manual filesystem setup.
 *
 * Feature 0 (Database connection established) and Feature 2 (Data persists
 * across server restart) depend on this module using a persistent file-backed
 * database - never in-memory or globalThis-based storage.
 */

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "localforge.db");
const DB_PATH = process.env.LOCALFORGE_DB_PATH || DEFAULT_DB_PATH;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Keep normal dev output quiet. SQL logging is still available when debugging
// database behavior by setting LOCALFORGE_LOG_SQL=1 (or true).
const shouldLogSql =
  process.env.LOCALFORGE_LOG_SQL === "1" ||
  process.env.LOCALFORGE_LOG_SQL === "true";

export const db = drizzle(sqlite, { schema, logger: shouldLogSql });

migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

// Opt-in connection logging for DB diagnostics. In dev/build, this module can
// be imported by many workers, so logging by default is noisy.
if (
  process.env.LOCALFORGE_LOG_DB_CONNECT === "1" ||
  process.env.LOCALFORGE_LOG_DB_CONNECT === "true"
) {
  // eslint-disable-next-line no-console
  console.log(`[localforge] SQLite connected: ${DB_PATH}`);
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    sqlite.prepare("SELECT 1").get();
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[localforge] DB health check failed:", err);
    return false;
  }
}

export { sqlite };
