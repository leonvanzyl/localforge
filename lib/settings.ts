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
 * surfaced by {@link getProjectSettings} / {@link updateProjectSettings}.
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

/**
 * Keys that can be overridden on a per-project basis. `working_directory`
 * is global-only because it controls where new project folders get created
 * on disk — overriding it per-project would be paradoxical.
 */
export const PROJECT_SETTING_KEYS = ["lm_studio_url", "model"] as const;

export type GlobalSettingKey = (typeof GLOBAL_SETTING_KEYS)[number];
export type ProjectSettingKey = (typeof PROJECT_SETTING_KEYS)[number];

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

/* ----------------------------- Project-specific settings ------------------ */

function readProjectOverride(
  projectId: number,
  key: ProjectSettingKey,
): string | null {
  const row = db
    .select()
    .from(settings)
    .where(and(eq(settings.key, key), eq(settings.projectId, projectId)))
    .get();
  return row?.value ?? null;
}

function writeProjectOverride(
  projectId: number,
  key: ProjectSettingKey,
  value: string,
): void {
  const existing = db
    .select()
    .from(settings)
    .where(and(eq(settings.key, key), eq(settings.projectId, projectId)))
    .get();

  if (existing) {
    db.update(settings)
      .set({ value })
      .where(eq(settings.id, existing.id))
      .run();
  } else {
    db.insert(settings).values({ key, value, projectId }).run();
  }
}

function deleteProjectOverride(
  projectId: number,
  key: ProjectSettingKey,
): void {
  db.delete(settings)
    .where(and(eq(settings.key, key), eq(settings.projectId, projectId)))
    .run();
}

/**
 * Raw overrides set on a project. Each key is either the overridden value
 * or `null` when no override is set (i.e. the global default applies).
 *
 * The UI uses this to render placeholder text ("using global default") and
 * to decide whether to save or clear an override on submit.
 */
export type ProjectOverridesShape = Record<ProjectSettingKey, string | null>;

export function getProjectOverrides(projectId: number): ProjectOverridesShape {
  const out: Partial<ProjectOverridesShape> = {};
  for (const key of PROJECT_SETTING_KEYS) {
    out[key] = readProjectOverride(projectId, key);
  }
  return out as ProjectOverridesShape;
}

/**
 * Effective settings for a given project: project override when set, global
 * value otherwise. Downstream code (e.g. project folder .claude/settings.json
 * generation) reads through this so it always picks the most-specific value
 * without needing to know about the override layer.
 */
export type ProjectEffectiveShape = Record<ProjectSettingKey, string>;

export function getProjectEffectiveSettings(
  projectId: number,
): ProjectEffectiveShape {
  const overrides = getProjectOverrides(projectId);
  const globals = getGlobalSettings();
  const out: Partial<ProjectEffectiveShape> = {};
  for (const key of PROJECT_SETTING_KEYS) {
    out[key] = overrides[key] ?? globals[key];
  }
  return out as ProjectEffectiveShape;
}

/**
 * Update the settings for a single project. Each field is tri-state:
 *   - string (non-empty)  → set / update the override
 *   - empty string / null → clear the override (falls back to global)
 *   - undefined           → leave unchanged
 */
export type UpdateProjectSettingsInput = Partial<
  Record<ProjectSettingKey, string | null>
>;

function validateProjectInput(input: UpdateProjectSettingsInput): string | null {
  if (input.lm_studio_url) {
    const v = input.lm_studio_url.trim();
    if (v) {
      try {
        const url = new URL(v);
        if (!["http:", "https:"].includes(url.protocol)) {
          return "LM Studio URL must use http or https";
        }
      } catch {
        return "LM Studio URL is not a valid URL";
      }
    }
  }
  // model accepts any non-empty string, or empty/null to clear.
  return null;
}

export function updateProjectSettings(
  projectId: number,
  input: UpdateProjectSettingsInput,
): ProjectOverridesShape {
  const error = validateProjectInput(input);
  if (error) throw new Error(error);

  for (const key of PROJECT_SETTING_KEYS) {
    if (!(key in input)) continue;
    const raw = input[key];
    if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
      deleteProjectOverride(projectId, key);
    } else if (typeof raw === "string") {
      writeProjectOverride(projectId, key, raw.trim());
    }
  }
  return getProjectOverrides(projectId);
}
