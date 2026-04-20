import { NextRequest, NextResponse } from "next/server";
import {
  getActiveSessionForProject,
} from "@/lib/agent-sessions";
import { getProject } from "@/lib/projects";
import { getFeature, listFeaturesForProject } from "@/lib/features";
import {
  OrchestratorError,
  isSessionRunning,
  startOrchestrator,
  stopOrchestratorSession,
} from "@/lib/agent/orchestrator";

/**
 * Orchestrator REST endpoint for a project.
 *
 * GET   /api/projects/:id/orchestrator  → current active session (or null)
 * POST  /api/projects/:id/orchestrator  → body { action?: "start" | "stop" }
 *
 * POST action=start picks the highest-priority ready feature, transitions it
 * to in_progress, creates an agent_session row, and spawns a Node.js child
 * process running the Claude Agent SDK runner (scripts/agent-runner.mjs),
 * which drives a real inference session against the configured local model.
 *
 * POST action=stop force-terminates the running child process (Feature #73
 * force-stop coverage).
 *
 * Must run on the Node.js runtime (not edge) because spawning child processes
 * and writing to SQLite are Node APIs.
 */
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(idStr: string): number | null {
  const n = Number.parseInt(idStr, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const projectId = parseId(id);
  if (projectId == null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const session = getActiveSessionForProject(projectId, "coding");
  const running = session ? isSessionRunning(session.id) : false;
  const feature = session?.featureId ? getFeature(session.featureId) : null;
  // Per-project 1-based feature index so the UI never surfaces the raw
  // (shared-autoincrement) DB id.
  let featureNumber: number | null = null;
  if (feature) {
    const sorted = [...listFeaturesForProject(projectId)].sort(
      (a, b) => a.id - b.id,
    );
    const i = sorted.findIndex((f) => f.id === feature.id);
    featureNumber = i >= 0 ? i + 1 : null;
  }
  return NextResponse.json({ session, running, feature, featureNumber });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const projectId = parseId(id);
  if (projectId == null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: { action?: string } = {};
  try {
    body = (await req.json().catch(() => ({}))) as typeof body;
  } catch {
    body = {};
  }

  const action = body.action === "stop" ? "stop" : "start";

  if (action === "stop") {
    const existing = getActiveSessionForProject(projectId, "coding");
    if (!existing) {
      return NextResponse.json({ session: null, stopped: false });
    }
    const result = stopOrchestratorSession(existing.id);
    return NextResponse.json({
      session: result.session,
      stopped: result.stopped,
    });
  }

  // action === "start"
  try {
    const result = startOrchestrator(projectId);
    return NextResponse.json(
      {
        session: result.session,
        feature: result.feature,
        started: result.started,
      },
      { status: result.started ? 201 : 200 },
    );
  } catch (err) {
    if (err instanceof OrchestratorError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
