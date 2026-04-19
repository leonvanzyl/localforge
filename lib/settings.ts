import "server-only";
import { eq, isNull, and } from "drizzle-orm";
import path from "node:path";
import { db } from "./db";
import { settings } from "./db/schema";

/**
 * Global settings helpers backed by the `settings` SQLite table.
 *
 * Global rows are identified by `project_id = NULL`. Project-specific
 * overrides live in the same table with a non-null `project_id` and are
 * surfaced by separate helpers later when project settings land.
 *
 * This module is the single source of truth for reading/writing the
 * LM Studio URL, default model, and working directory. The values are
 * persisted in SQLite so they survive restarts (required by Feature
 * "Data persists across server restart").
 */

export const GLOBAL_SETTING_KEYS = [
  "lm_studio_url",
  "model",
  "working_directory",
] as const;

export type GlobalSettingKey = (typeof GLOBAL_SETTING_KEYS)[number];

export const DEFAULT_GLOBAL_SETTINGS: Record<GlobalSettingKey, string> = {
  lm_studio_url: "http://127.0.0.1:1234",
  model: "google/gemma-4-31b",
  working_directory: path.join(process.cwd(), "projects"),
};

function readGlobal(key: GlobalSettingKey): string | null {
  const row = db
    .select()
    .from(settings)
    .where(and(eq(settings.key, key), isNull(settings.projectId)))
    .get();
  return row?.value ?? null;
}

function writeGlobal(key: GlobalSettingKey, value: string): void {
  const existing = db
    .select()
    .from(settings)
    .where(and(eq(settings.key, key), isNull(settings.projectId)))
    .get();

  if (existing) {
    db.update(settings)
      .set({ value })
      .where(eq(settings.id, existing.id))
      .run();
  } else {
    db.insert(settings).values({ key, value, projectId: null }).run();
  }
}

export type GlobalSettingsShape = Record<GlobalSettingKey, string>;

export function getGlobalSettings(): GlobalSettingsShape {
  const out: Partial<GlobalSettingsShape> = {};
  for (const key of GLOBAL_SETTING_KEYS) {
    out[key] = readGlobal(key) ?? DEFAULT_GLOBAL_SETTINGS[key];
  }
  return out as GlobalSettingsShape;
}

export type UpdateGlobalSettingsInput = Partial<GlobalSettingsShape>;

function validate(input: UpdateGlobalSettingsInput): string | null {
  if (input.lm_studio_url !== undefined) {
    const v = input.lm_studio_url.trim();
    if (!v) return "LM Studio URL cannot be empty";
    try {
      const url = new URL(v);
      if (!["http:", "https:"].includes(url.protocol)) {
        return "LM Studio URL must use http or https";
      }
    } catch {
      return "LM Studio URL is not a valid URL";
    }
  }
  if (input.model !== undefined && !input.model.trim()) {
    return "Model name cannot be empty";
  }
  if (input.working_directory !== undefined && !input.working_directory.trim()) {
    return "Working directory cannot be empty";
  }
  return null;
}

export function updateGlobalSettings(
  input: UpdateGlobalSettingsInput,
): GlobalSettingsShape {
  const error = validate(input);
  if (error) throw new Error(error);

  for (const key of GLOBAL_SETTING_KEYS) {
    const value = input[key];
    if (typeof value === "string") {
      writeGlobal(key, value.trim());
    }
  }
  return getGlobalSettings();
}
