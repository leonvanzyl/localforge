import "server-only";
import path from "node:path";
import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import {
  projects,
  features,
  settings,
  agentSessions,
  agentLogs,
} from "./db/schema";
import { getProjectEffectiveSettings } from "./settings";

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

/** Max length for a project name. Matches the Input maxLength in the dialog. */
export const MAX_PROJECT_NAME_LENGTH = 120;

/**
 * Domain-specific validation error. API routes translate this into a 400
 * Bad Request rather than a 500 so the client can surface the message.
 */
export class ProjectValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

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

/**
 * Parse a timestamp string stored by SQLite or by our ISO-emitting code.
 * SQLite's `CURRENT_TIMESTAMP` default yields "YYYY-MM-DD HH:MM:SS" which
 * `Date.parse` does not reliably treat as UTC across runtimes. Our own
 * `updateProject` writes ISO-8601 ("YYYY-MM-DDTHH:MM:SS.sssZ"). Normalise
 * both to ms-since-epoch; returns null on an unparseable value.
 */
function parseTimestamp(raw: string): number | null {
  if (!raw) return null;
  // If the string already looks like ISO 8601 (contains a T), let Date parse
  // it directly — that path is unambiguous.
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
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

/**
 * Regenerate `.claude/settings.json` for an existing project using its
 * effective settings (project overrides take precedence over globals).
 * Called by the project-settings API after a save so the on-disk file
 * stays in sync with the database.
 *
 * Idempotent: always writes the full JSON object from scratch.
 */
export function writeProjectClaudeSettings(project: ProjectRecord): void {
  const effective = getProjectEffectiveSettings(project.id);
  const claudeDir = path.join(project.folderPath, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsContent = {
    env: {
      ANTHROPIC_BASE_URL: effective.lm_studio_url,
    },
    model: effective.model,
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

/**
 * Project record extended with feature progress counts. Used by the sidebar
 * to render the "{completed}/{total}" status indicator beside each project
 * (Feature #29).
 */
export type ProjectWithProgress = ProjectRecord & {
  featureCount: number;
  completedCount: number;
};

/**
 * List all projects, joining each row with completed/total feature counts.
 *
 * Done with two small queries instead of a SQL JOIN to keep the code path
 * driver-agnostic and trivially testable. Project counts are typically very
 * small (one row per project, a few features each), so the overhead is
 * negligible compared to the round-trip cost of one HTTP request.
 */
export function listProjectsWithProgress(): ProjectWithProgress[] {
  // Pull all features once and group in JS — single query is simpler than
  // GROUP BY when we already need the projects row anyway.
  const allProjects = db.select().from(projects).all();
  // Inline import keeps the schema dependency local without polluting the
  // top of the file (which is otherwise project-only).
  const allFeatures = db.select().from(features).all();

  const totals = new Map<number, number>();
  const completed = new Map<number, number>();
  for (const f of allFeatures) {
    totals.set(f.projectId, (totals.get(f.projectId) ?? 0) + 1);
    if (f.status === "completed") {
      completed.set(f.projectId, (completed.get(f.projectId) ?? 0) + 1);
    }
  }

  return allProjects.map((p) => ({
    ...p,
    featureCount: totals.get(p.id) ?? 0,
    completedCount: completed.get(p.id) ?? 0,
  }));
}

export function getProject(id: number): ProjectRecord | null {
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  return row ?? null;
}

export function createProject(input: CreateProjectInput): ProjectRecord {
  const rawName = typeof input.name === "string" ? input.name : "";
  const name = rawName.trim();
  // Validate: empty/whitespace-only names are rejected, as are excessively
  // long names that could confuse the filesystem or UI. We use the domain
  // error class so the API route can translate to a 400 Bad Request (the
  // client renders the message inline).
  if (!name) {
    throw new ProjectValidationError("Project name is required");
  }
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    throw new ProjectValidationError(
      `Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer`,
    );
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

/**
 * Completion statistics surfaced by the celebration screen (Feature #101).
 *
 * - `featureCount`  total features in the project
 * - `passedCount`   features with status='completed'
 * - `testsPassedCount` count of agent_log rows with messageType='test_result'
 *   across every coding session for this project (so the splash can brag
 *   about how many tests the agents ran)
 * - `startedAt` / `completedAt` / `durationMs` frame the wall-clock time the
 *   project took. `startedAt` = project.createdAt; `completedAt` = the
 *   project's updated_at, which `markProjectCompletedIfAllDone` stamps when
 *   the status transitions to "completed".
 *
 * Shape is intentionally small + serialisable so it can flow through the
 * API route and into the client component unchanged.
 */
export type ProjectCompletionStats = {
  status: string;
  featureCount: number;
  passedCount: number;
  testsPassedCount: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
};

/**
 * Compute summary numbers for the celebration screen. Returns `null` when the
 * project does not exist. Safe to call regardless of the project's current
 * status — the caller (API route / component) decides how to render based on
 * `status`.
 */
export function getProjectCompletionStats(
  projectId: number,
): ProjectCompletionStats | null {
  const project = getProject(projectId);
  if (!project) return null;

  const featureRows = db
    .select({ status: features.status })
    .from(features)
    .where(eq(features.projectId, projectId))
    .all();
  const featureCount = featureRows.length;
  const passedCount = featureRows.filter((r) => r.status === "completed").length;

  // Count test_result log rows for every coding session belonging to this
  // project. We do this via a JOIN on agent_sessions so tests logged on the
  // bootstrapper chat (which shouldn't exist, but defence in depth) are
  // ignored and not surfaced as fake "tests passed" numbers.
  const sessions = db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.sessionType, "coding"),
      ),
    )
    .all();
  const sessionIds = new Set(sessions.map((s) => s.id));
  let testsPassedCount = 0;
  if (sessionIds.size > 0) {
    const logs = db
      .select({
        sessionId: agentLogs.sessionId,
        messageType: agentLogs.messageType,
      })
      .from(agentLogs)
      .where(eq(agentLogs.messageType, "test_result"))
      .all();
    for (const l of logs) {
      if (sessionIds.has(l.sessionId)) testsPassedCount += 1;
    }
  }

  const startedAt = project.createdAt;
  const completedAt =
    project.status === "completed" ? project.updatedAt : null;
  let durationMs: number | null = null;
  if (completedAt) {
    const start = parseTimestamp(startedAt);
    const end = parseTimestamp(completedAt);
    if (start != null && end != null && end >= start) {
      durationMs = end - start;
    }
  }

  return {
    status: project.status,
    featureCount,
    passedCount,
    testsPassedCount,
    startedAt,
    completedAt,
    durationMs,
  };
}

/**
 * Flip a project's status to "completed" when every feature in it has reached
 * the `completed` state (Feature #101 — celebration screen).
 *
 * Idempotent + cheap to call on every successful coding-session finish:
 * - Returns `null` when the project does not exist, has zero features, or is
 *   already marked completed.
 * - Returns the freshly-updated project record when we transitioned it.
 *
 * Callers (orchestrator `finalizeSession`) use the non-null return as a signal
 * to broadcast a project-level event so the UI can surface the celebration
 * screen without polling.
 */
export function markProjectCompletedIfAllDone(
  projectId: number,
): ProjectRecord | null {
  const project = getProject(projectId);
  if (!project) return null;
  if (project.status === "completed") return null;

  const rows = db
    .select({ status: features.status })
    .from(features)
    .where(eq(features.projectId, projectId))
    .all();

  if (rows.length === 0) return null;
  if (!rows.every((r) => r.status === "completed")) return null;

  return updateProject(projectId, { status: "completed" });
}
