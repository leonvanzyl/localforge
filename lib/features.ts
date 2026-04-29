import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "./db";
import { features, featureDependencies, projects } from "./db/schema";

/**
 * Feature domain helpers.
 *
 * Features are the individual work items tracked on a project's kanban
 * board. They live in the `features` table and have dependency relationships
 * recorded in `feature_dependencies` (a feature can depend on zero or more
 * other features before it becomes "ready" for the orchestrator to pick up).
 *
 * The API routes in `app/api/projects/[id]/features` and `app/api/features`
 * are thin wrappers around these functions; no Next.js objects leak in here.
 */

export type FeatureRecord = typeof features.$inferSelect;
export type FeatureStatus = "backlog" | "in_progress" | "completed";
export type FeatureCategory = "functional" | "style";

const VALID_STATUSES: readonly FeatureStatus[] = [
  "backlog",
  "in_progress",
  "completed",
];
const VALID_CATEGORIES: readonly FeatureCategory[] = ["functional", "style"];

/** Maximum allowed length for a feature title (matches UI maxLength). */
export const MAX_TITLE_LENGTH = 200;
/** Maximum allowed length for a feature description. */
export const MAX_DESCRIPTION_LENGTH = 5000;

export type CreateFeatureInput = {
  projectId: number;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  status?: FeatureStatus;
  priority?: number;
  category?: FeatureCategory;
};

export type UpdateFeatureInput = {
  title?: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  status?: FeatureStatus;
  priority?: number;
  category?: FeatureCategory;
};

export class FeatureValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "FeatureValidationError";
  }
}

function assertValidStatus(s: string | undefined): FeatureStatus | undefined {
  if (s === undefined) return undefined;
  if (!VALID_STATUSES.includes(s as FeatureStatus)) {
    throw new FeatureValidationError(
      `Invalid status '${s}'. Expected one of: ${VALID_STATUSES.join(", ")}`,
    );
  }
  return s as FeatureStatus;
}

function assertValidCategory(
  c: string | undefined,
): FeatureCategory | undefined {
  if (c === undefined) return undefined;
  if (!VALID_CATEGORIES.includes(c as FeatureCategory)) {
    throw new FeatureValidationError(
      `Invalid category '${c}'. Expected one of: ${VALID_CATEGORIES.join(", ")}`,
    );
  }
  return c as FeatureCategory;
}

/**
 * Normalise + validate a title. Rejects empty / whitespace-only strings
 * and truncates to MAX_TITLE_LENGTH. Returns the cleaned string.
 */
function validateTitle(rawTitle: unknown): string {
  if (typeof rawTitle !== "string") {
    throw new FeatureValidationError("Title is required");
  }
  const trimmed = rawTitle.trim();
  if (trimmed.length === 0) {
    throw new FeatureValidationError("Title is required");
  }
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new FeatureValidationError(
      `Title must be ${MAX_TITLE_LENGTH} characters or fewer`,
    );
  }
  return trimmed;
}

function normaliseDescription(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") {
    throw new FeatureValidationError("Description must be a string");
  }
  if (raw.length > MAX_DESCRIPTION_LENGTH) {
    throw new FeatureValidationError(
      `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`,
    );
  }
  return raw;
}

function ensureProjectExists(projectId: number): void {
  const exists = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!exists) {
    const err = new FeatureValidationError(`Project ${projectId} not found`);
    err.status = 404;
    throw err;
  }
}

function reopenProjectIfFeatureIsOpen(projectId: number): void {
  db.update(projects)
    .set({ status: "active", updatedAt: new Date().toISOString() })
    .where(and(eq(projects.id, projectId), eq(projects.status, "completed")))
    .run();
}

/** List all features for a given project, ordered by priority then id. */
export function listFeaturesForProject(projectId: number): FeatureRecord[] {
  return db
    .select()
    .from(features)
    .where(eq(features.projectId, projectId))
    .all()
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id - b.id;
    });
}

export function getFeature(id: number): FeatureRecord | null {
  const row = db.select().from(features).where(eq(features.id, id)).get();
  return row ?? null;
}

/** Next priority slot for a project - one higher than the current max. */
function nextPriorityForProject(projectId: number): number {
  const rows = db
    .select({ priority: features.priority })
    .from(features)
    .where(eq(features.projectId, projectId))
    .all();
  if (rows.length === 0) return 0;
  return Math.max(...rows.map((r) => r.priority)) + 1;
}

export function createFeature(input: CreateFeatureInput): FeatureRecord {
  ensureProjectExists(input.projectId);

  const title = validateTitle(input.title);
  const description = normaliseDescription(input.description ?? null);
  const acceptanceCriteria = normaliseDescription(
    input.acceptanceCriteria ?? null,
  );
  const status = assertValidStatus(input.status) ?? "backlog";
  const category = assertValidCategory(input.category) ?? "functional";
  const priority =
    typeof input.priority === "number"
      ? input.priority
      : nextPriorityForProject(input.projectId);

  const inserted = db
    .insert(features)
    .values({
      projectId: input.projectId,
      title,
      description,
      acceptanceCriteria,
      status,
      priority,
      category,
    })
    .returning()
    .get();
  if (inserted.status !== "completed") {
    reopenProjectIfFeatureIsOpen(inserted.projectId);
  }
  return inserted;
}

export function updateFeature(
  id: number,
  input: UpdateFeatureInput,
): FeatureRecord | null {
  const existing = getFeature(id);
  if (!existing) return null;

  const patch: Partial<typeof features.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.title !== undefined) {
    patch.title = validateTitle(input.title);
  }
  if (input.description !== undefined) {
    patch.description = normaliseDescription(input.description);
  }
  if (input.acceptanceCriteria !== undefined) {
    patch.acceptanceCriteria = normaliseDescription(input.acceptanceCriteria);
  }
  const status = assertValidStatus(input.status);
  if (status !== undefined) patch.status = status;
  const category = assertValidCategory(input.category);
  if (category !== undefined) patch.category = category;
  if (typeof input.priority === "number") patch.priority = input.priority;

  const updated =
    db
      .update(features)
      .set(patch)
      .where(eq(features.id, id))
      .returning()
      .get() ?? null;
  if (updated && updated.status !== "completed") {
    reopenProjectIfFeatureIsOpen(updated.projectId);
  }
  return updated;
}

export function deleteFeature(id: number): boolean {
  const existing = getFeature(id);
  if (!existing) return false;
  db.delete(features).where(eq(features.id, id)).run();
  return true;
}

/* --------------------------- Dependencies --------------------------- */

export type FeatureDependencyRecord =
  typeof featureDependencies.$inferSelect;

/** Returns the list of features that `featureId` depends on (prerequisites). */
export function listDependencies(featureId: number): FeatureRecord[] {
  const deps = db
    .select()
    .from(featureDependencies)
    .where(eq(featureDependencies.featureId, featureId))
    .all();
  if (deps.length === 0) return [];
  const ids = deps.map((d) => d.dependsOnFeatureId);
  // Fetch each prerequisite feature. Using a loop keeps things simple and
  // deterministic across drivers; dependency lists are expected to be small.
  const results: FeatureRecord[] = [];
  for (const id of ids) {
    const row = getFeature(id);
    if (row) results.push(row);
  }
  return results;
}

/** Returns the features that depend on `featureId` (dependents). */
export function listDependents(featureId: number): FeatureRecord[] {
  const deps = db
    .select()
    .from(featureDependencies)
    .where(eq(featureDependencies.dependsOnFeatureId, featureId))
    .all();
  if (deps.length === 0) return [];
  const results: FeatureRecord[] = [];
  for (const d of deps) {
    const row = getFeature(d.featureId);
    if (row) results.push(row);
  }
  return results;
}

/**
 * Count the dependencies a feature has. Useful for quickly rendering a
 * dependency indicator on the kanban card without fetching full records.
 */
export function countDependencies(featureId: number): number {
  return db
    .select()
    .from(featureDependencies)
    .where(eq(featureDependencies.featureId, featureId))
    .all().length;
}

/**
 * Return just the IDs of a feature's prerequisites. Used by the kanban board
 * (Feature #52) to draw dependency lines without hydrating full feature
 * records for every edge.
 */
export function listDependencyIds(featureId: number): number[] {
  return db
    .select({ dependsOnFeatureId: featureDependencies.dependsOnFeatureId })
    .from(featureDependencies)
    .where(eq(featureDependencies.featureId, featureId))
    .all()
    .map((row) => row.dependsOnFeatureId);
}

/**
 * Add a dependency: feature `featureId` will now depend on `dependsOnFeatureId`.
 *
 * Enforces:
 *  - both features exist
 *  - same project (cross-project deps not supported)
 *  - no self-dependency
 *  - no duplicate rows
 *  - no direct cycles (A depends on B AND B depends on A)
 */
export function addDependency(
  featureId: number,
  dependsOnFeatureId: number,
): FeatureDependencyRecord {
  if (featureId === dependsOnFeatureId) {
    throw new FeatureValidationError(
      "A feature cannot depend on itself",
    );
  }
  const feature = getFeature(featureId);
  if (!feature) {
    const err = new FeatureValidationError(`Feature ${featureId} not found`);
    err.status = 404;
    throw err;
  }
  const dependsOn = getFeature(dependsOnFeatureId);
  if (!dependsOn) {
    const err = new FeatureValidationError(
      `Feature ${dependsOnFeatureId} not found`,
    );
    err.status = 404;
    throw err;
  }
  if (feature.projectId !== dependsOn.projectId) {
    throw new FeatureValidationError(
      "Dependencies must be between features in the same project",
    );
  }

  // Duplicate?
  const existing = db
    .select()
    .from(featureDependencies)
    .where(
      and(
        eq(featureDependencies.featureId, featureId),
        eq(featureDependencies.dependsOnFeatureId, dependsOnFeatureId),
      ),
    )
    .get();
  if (existing) return existing;

  // Cycle check: if dependsOnFeatureId already depends on featureId (direct
  // or transitive) reject. We do a BFS over the forward dependency graph.
  if (wouldCreateCycle(featureId, dependsOnFeatureId)) {
    throw new FeatureValidationError(
      "Adding this dependency would create a cycle",
    );
  }

  const inserted = db
    .insert(featureDependencies)
    .values({ featureId, dependsOnFeatureId })
    .returning()
    .get();
  return inserted;
}

function wouldCreateCycle(
  featureId: number,
  dependsOnFeatureId: number,
): boolean {
  // If any path from dependsOnFeatureId leads back to featureId, we have a
  // cycle. Walk the graph iteratively.
  const visited = new Set<number>();
  const queue: number[] = [dependsOnFeatureId];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    if (current === featureId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const next = db
      .select()
      .from(featureDependencies)
      .where(eq(featureDependencies.featureId, current))
      .all();
    for (const n of next) queue.push(n.dependsOnFeatureId);
  }
  return false;
}

export function removeDependency(
  featureId: number,
  dependsOnFeatureId: number,
): boolean {
  const existing = db
    .select()
    .from(featureDependencies)
    .where(
      and(
        eq(featureDependencies.featureId, featureId),
        eq(featureDependencies.dependsOnFeatureId, dependsOnFeatureId),
      ),
    )
    .get();
  if (!existing) return false;
  db
    .delete(featureDependencies)
    .where(
      and(
        eq(featureDependencies.featureId, featureId),
        eq(featureDependencies.dependsOnFeatureId, dependsOnFeatureId),
      ),
    )
    .run();
  return true;
}

/**
 * Replace the full dependency set for a feature. Useful when the detail
 * modal saves a new multi-select value — we diff and adjust.
 */
export function setDependencies(
  featureId: number,
  newDependsOn: number[],
): FeatureRecord[] {
  const current = db
    .select()
    .from(featureDependencies)
    .where(eq(featureDependencies.featureId, featureId))
    .all();
  const currentIds = new Set(current.map((r) => r.dependsOnFeatureId));
  const targetIds = new Set(newDependsOn);

  // Remove deps not in target.
  for (const existing of current) {
    if (!targetIds.has(existing.dependsOnFeatureId)) {
      removeDependency(featureId, existing.dependsOnFeatureId);
    }
  }
  // Add deps that are new.
  for (const id of targetIds) {
    if (!currentIds.has(id)) {
      addDependency(featureId, id);
    }
  }
  return listDependencies(featureId);
}

/**
 * List sibling features in the same project (excluding the feature itself).
 * Used by the dependency picker to offer candidates.
 */
export function listProjectSiblings(featureId: number): FeatureRecord[] {
  const feature = getFeature(featureId);
  if (!feature) return [];
  return db
    .select()
    .from(features)
    .where(
      and(
        eq(features.projectId, feature.projectId),
        ne(features.id, featureId),
      ),
    )
    .all();
}

/* ---------------------- Orchestrator selection ---------------------- */

/**
 * Return the highest-priority backlog feature in a project whose dependencies
 * are all completed. Returns null if nothing is ready. Used by the
 * orchestrator (Feature #63) to pick the next work item.
 *
 * "Highest priority" here means the smallest priority integer - the kanban
 * treats priority 0 as the top of the backlog, same as nextPriorityForProject
 * which appends with `max+1`.
 */
export function getInProgressFeaturesForProject(
  projectId: number,
): FeatureRecord[] {
  return db
    .select()
    .from(features)
    .where(
      and(eq(features.projectId, projectId), eq(features.status, "in_progress")),
    )
    .all();
}

export function findNextReadyFeatureForProject(
  projectId: number,
  options: { excludeIds?: ReadonlySet<number> } = {},
): FeatureRecord | null {
  const exclude = options.excludeIds;
  const backlog = db
    .select()
    .from(features)
    .where(
      and(eq(features.projectId, projectId), eq(features.status, "backlog")),
    )
    .all()
    .filter((f) => !exclude || !exclude.has(f.id))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id - b.id;
    });

  if (backlog.length === 0) return null;

  // Build a set of completed feature ids for the project so dependency checks
  // are O(1) per feature.
  const completed = new Set(
    db
      .select({ id: features.id })
      .from(features)
      .where(
        and(
          eq(features.projectId, projectId),
          eq(features.status, "completed"),
        ),
      )
      .all()
      .map((r) => r.id),
  );

  for (const feature of backlog) {
    const deps = db
      .select({ depId: featureDependencies.dependsOnFeatureId })
      .from(featureDependencies)
      .where(eq(featureDependencies.featureId, feature.id))
      .all();
    const allMet = deps.every((d) => completed.has(d.depId));
    if (allMet) return feature;
  }
  return null;
}

/**
 * Demote a feature back to the backlog after the agent failed on it
 * (Feature #68). The feature's status is reset to "backlog" and its priority
 * is bumped past the current max priority in the project so other backlog
 * items are attempted first before the orchestrator retries.
 *
 * Returns the updated feature, or null if the feature doesn't exist.
 */
export function demoteFeatureToBacklog(
  featureId: number,
): FeatureRecord | null {
  const existing = getFeature(featureId);
  if (!existing) return null;

  // Compute a new priority that sits strictly after every other feature in
  // the project (including currently-completed ones so re-runs still land at
  // the bottom).
  const maxRow = db
    .select({ priority: features.priority })
    .from(features)
    .where(eq(features.projectId, existing.projectId))
    .all();
  const currentMax = maxRow.reduce(
    (acc, r) => (r.priority > acc ? r.priority : acc),
    0,
  );
  const demotedPriority = Math.max(currentMax + 1, existing.priority + 1);

  return (
    db
      .update(features)
      .set({
        status: "backlog",
        priority: demotedPriority,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(features.id, featureId))
      .returning()
      .get() ?? null
  );
}
