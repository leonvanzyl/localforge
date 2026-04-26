import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { getFeature, listFeaturesForProject } from "@/lib/features";
import {
  OrchestratorError,
  getAgentSlots,
  getRunningSessionsForProject,
  startAllAgents,
  startOrchestrator,
  stopAllAgents,
  stopOrchestratorSession,
  getMaxConcurrentAgentsForProject,
} from "@/lib/agent/orchestrator";

/**
 * Orchestrator REST endpoint for a project.
 *
 * GET   /api/projects/:id/orchestrator  → current agent slots and running sessions
 * POST  /api/projects/:id/orchestrator  → body { action?: "start" | "stop" | "start_all" | "stop_all", sessionId?: number }
 *
 * POST action=start picks the highest-priority ready feature, transitions it
 * to in_progress, creates an agent_session row, and spawns a Node.js child
 * process running the Pi AgentSession runner (scripts/agent-runner.mjs),
 * which drives a real inference session against the configured local model.
 *
 * POST action=start_all fills all available agent slots with ready features.
 *
 * POST action=stop force-terminates a specific running child process (requires
 * sessionId in body), or the first running session if no sessionId provided.
 *
 * POST action=stop_all force-terminates all running sessions for the project.
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

  const slots = getAgentSlots(projectId);
  const runningSessions = getRunningSessionsForProject(projectId);

  // Build per-project 1-based feature index lookup so the UI never surfaces
  // the raw (shared-autoincrement) DB id.
  const allFeatures = listFeaturesForProject(projectId).sort(
    (a, b) => a.id - b.id,
  );

  // Backward compat: return the first running session as `session` + `feature`
  // so existing UI code doesn't break.
  const firstRunning = slots.find((s) => s.running);
  const session = firstRunning?.sessionId
    ? runningSessions.find((s) => s.id === firstRunning.sessionId) ?? null
    : null;
  const feature = session?.featureId ? getFeature(session.featureId) : null;
  let featureNumber: number | null = null;
  if (feature) {
    const i = allFeatures.findIndex((f) => f.id === feature.id);
    featureNumber = i >= 0 ? i + 1 : null;
  }

  return NextResponse.json({
    // Legacy single-session fields (backward compat)
    session,
    running: !!firstRunning,
    feature,
    featureNumber,
    // New multi-agent fields
    slots,
    runningCount: runningSessions.length,
    maxConcurrentAgents: getMaxConcurrentAgentsForProject(projectId),
  });
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

  let body: { action?: string; sessionId?: number } = {};
  try {
    body = (await req.json().catch(() => ({}))) as typeof body;
  } catch {
    body = {};
  }

  const action = body.action ?? "start";

  if (action === "stop_all") {
    const results = stopAllAgents(projectId);
    return NextResponse.json({ results, stoppedCount: results.length });
  }

  if (action === "stop") {
    if (body.sessionId) {
      // Stop a specific session
      const result = stopOrchestratorSession(body.sessionId);
      return NextResponse.json({
        session: result.session,
        stopped: result.stopped,
      });
    }
    // Fallback: stop the first running session (backward compat)
    const runningSessions = getRunningSessionsForProject(projectId);
    if (runningSessions.length === 0) {
      return NextResponse.json({ session: null, stopped: false });
    }
    const result = stopOrchestratorSession(runningSessions[0].id);
    return NextResponse.json({
      session: result.session,
      stopped: result.stopped,
    });
  }

  if (action === "start_all") {
    try {
      const results = startAllAgents(projectId);
      return NextResponse.json(
        {
          results: results.map((r) => ({
            session: r.session,
            feature: r.feature,
            started: r.started,
          })),
          startedCount: results.length,
        },
        { status: results.length > 0 ? 201 : 200 },
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

  // action === "start" (default)
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
