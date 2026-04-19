import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
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

export const db = drizzle(sqlite, { schema });

// Log a connection message so Feature 0 / 4 can detect DB activity in stdout.
if (process.env.NODE_ENV !== "test") {
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
