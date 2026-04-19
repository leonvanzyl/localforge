import "server-only";
import path from "node:path";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { projects, settings } from "./db/schema";

/**
 * Project domain helpers.
 *
 * Single source of truth for project CRUD against the SQLite database. The API
 * routes in `app/api/projects/*` are thin wrappers around these functions.
 *
 * Design notes:
 * - `working_directory` is read from the global settings table (key:
 *   "working_directory"). If unset, we fall back to ./projects relative to
 *   process.cwd(). This lets later settings features change the destination
 *   without touching the project code.
 * - Folder paths are slugified from the project name to keep them filesystem-
 *   safe. Collisions get a numeric suffix.
 * - We always generate a `.claude/settings.json` inside the project folder so
 *   downstream agents (orchestrator, bootstrapper) inherit the LM Studio
 *   configuration. Defaults match app_spec.txt.
 */

const DEFAULT_WORKING_DIR = path.join(process.cwd(), "projects");
const DEFAULT_LM_STUDIO_URL = "http://127.0.0.1:1234";
const DEFAULT_MODEL = "google/gemma-4-31b";

export type ProjectRecord = typeof projects.$inferSelect;

export type CreateProjectInput = {
  name: string;
  description?: string | null;
};

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}

function getGlobalSetting(key: string): string | null {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .all()
    .find((s) => s.projectId === null);
  return row?.value ?? null;
}

export function getWorkingDirectory(): string {
  return getGlobalSetting("working_directory") || DEFAULT_WORKING_DIR;
}

export function getDefaultLmStudioUrl(): string {
  return getGlobalSetting("lm_studio_url") || DEFAULT_LM_STUDIO_URL;
}

export function getDefaultModel(): string {
  return getGlobalSetting("model") || DEFAULT_MODEL;
}

function pickUniqueFolder(base: string, slug: string): string {
  fs.mkdirSync(base, { recursive: true });
  let candidate = path.join(base, slug);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(base, `${slug}-${n}`);
    n++;
  }
  return candidate;
}

function writeClaudeSettings(folderPath: string): void {
  const claudeDir = path.join(folderPath, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsContent = {
    env: {
      ANTHROPIC_BASE_URL: getDefaultLmStudioUrl(),
    },
    model: getDefaultModel(),
  };
  fs.writeFileSync(
    path.join(claudeDir, "settings.json"),
    JSON.stringify(settingsContent, null, 2),
    "utf8",
  );
}

export function listProjects(): ProjectRecord[] {
  return db.select().from(projects).all();
}

export function getProject(id: number): ProjectRecord | null {
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  return row ?? null;
}

export function createProject(input: CreateProjectInput): ProjectRecord {
  const name = input.name?.trim();
  if (!name) {
    throw new Error("Project name is required");
  }

  const workingDir = getWorkingDirectory();
  const folderPath = pickUniqueFolder(workingDir, slugify(name));
  fs.mkdirSync(folderPath, { recursive: true });

  try {
    writeClaudeSettings(folderPath);

    const inserted = db
      .insert(projects)
      .values({
        name,
        description: input.description ?? null,
        folderPath,
      })
      .returning()
      .get();
    return inserted;
  } catch (err) {
    // Roll back the folder creation if the DB write failed so we don't leave
    // orphan directories behind.
    try {
      fs.rmSync(folderPath, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

export type DeleteProjectOptions = {
  removeFiles?: boolean;
};

export function deleteProject(
  id: number,
  options: DeleteProjectOptions = {},
): { deleted: boolean; folderRemoved: boolean } {
  const existing = getProject(id);
  if (!existing) return { deleted: false, folderRemoved: false };

  db.delete(projects).where(eq(projects.id, id)).run();

  let folderRemoved = false;
  if (options.removeFiles && existing.folderPath) {
    try {
      fs.rmSync(existing.folderPath, { recursive: true, force: true });
      folderRemoved = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[localforge] failed to remove project folder:", err);
    }
  }

  return { deleted: true, folderRemoved };
}

export type UpdateProjectInput = {
  name?: string;
  description?: string | null;
  status?: string;
};

export function updateProject(
  id: number,
  input: UpdateProjectInput,
): ProjectRecord | null {
  const existing = getProject(id);
  if (!existing) return null;

  const patch: Partial<typeof projects.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (typeof input.name === "string") patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description;
  if (typeof input.status === "string") patch.status = input.status;

  return (
    db
      .update(projects)
      .set(patch)
      .where(eq(projects.id, id))
      .returning()
      .get() ?? null
  );
}
