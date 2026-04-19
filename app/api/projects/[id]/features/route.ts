import { NextRequest, NextResponse } from "next/server";
import {
  FeatureValidationError,
  createFeature,
  listFeaturesForProject,
  countDependencies,
  listDependencyIds,
} from "@/lib/features";
import { getProject } from "@/lib/projects";
import { getLatestTestResultsForProject } from "@/lib/agent/logs";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * GET /api/projects/:id/features - list all features for a project.
 *
 * Returns features sorted by priority, with a `dependencyCount` field on
 * each so the kanban card can render a dependency indicator without a
 * second round-trip.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const projectId = parseId(id);
  if (projectId == null) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const rows = listFeaturesForProject(projectId);
  // Feature #96: pull the most recent Playwright run counts for every feature
  // in the project in a single query so the kanban card can render a pass/
  // fail badge without an N+1 round-trip per card.
  const testResults = getLatestTestResultsForProject(projectId);
  const features = rows.map((f) => ({
    ...f,
    dependencyCount: countDependencies(f.id),
    // Feature #52: include the full list of prerequisite IDs so the kanban
    // board can draw a dependency-connector line between this card and each
    // of its prerequisites without a second round-trip per card.
    dependsOn: listDependencyIds(f.id),
    testResult: testResults.get(f.id) ?? null,
  }));
  return NextResponse.json({ features });
}

/**
 * POST /api/projects/:id/features - create a new feature in a project.
 *
 * Body (JSON): { title, description?, acceptanceCriteria?, status?, category?, priority? }
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const projectId = parseId(id);
  if (projectId == null) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const {
    title,
    description,
    acceptanceCriteria,
    status,
    priority,
    category,
  } = (body ?? {}) as Record<string, unknown>;

  try {
    const created = createFeature({
      projectId,
      title: typeof title === "string" ? title : "",
      description:
        description === null
          ? null
          : typeof description === "string"
            ? description
            : undefined,
      acceptanceCriteria:
        acceptanceCriteria === null
          ? null
          : typeof acceptanceCriteria === "string"
            ? acceptanceCriteria
            : undefined,
      status: typeof status === "string" ? (status as never) : undefined,
      priority: typeof priority === "number" ? priority : undefined,
      category: typeof category === "string" ? (category as never) : undefined,
    });
    return NextResponse.json({ feature: created }, { status: 201 });
  } catch (err) {
    if (err instanceof FeatureValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
