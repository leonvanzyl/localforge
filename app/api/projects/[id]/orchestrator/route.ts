import { NextRequest, NextResponse } from "next/server";
import {
  closeAgentSession,
  createAgentSession,
  getActiveSessionForProject,
} from "@/lib/agent-sessions";
import { getProject } from "@/lib/projects";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(idStr: string): number | null {
  const n = Number.parseInt(idStr, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * GET /api/projects/:id/orchestrator
 *
 * Returns the currently-active (in_progress) coding orchestrator session
 * for a project, or `null` if none exists. The project header uses this
 * to determine whether to show "Start Orchestrator" or "Stop".
 */
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
  return NextResponse.json({ session });
}

/**
 * POST /api/projects/:id/orchestrator
 *
 * Body: { action?: "start" | "stop" }
 *
 * Starts a new coding agent_session for the project (idempotent - if one is
 * already in_progress it is returned as-is). When `action: "stop"` is
 * supplied, the active session is marked terminated.
 *
 * The Start Orchestrator button rendered in the project header (Feature
 * #62) hits this endpoint with `action: "start"`. Subsequent features
 * (orchestrator loop, agent SDK invocation, log streaming) will layer on
 * top of the row created here.
 */
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

  let action: "start" | "stop" = "start";
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action === "stop") action = "stop";
  } catch {
    // body parse error — fall through with default action.
  }

  if (action === "stop") {
    const existing = getActiveSessionForProject(projectId, "coding");
    if (!existing) {
      return NextResponse.json({ session: null, stopped: false });
    }
    const closed = closeAgentSession(existing.id, "terminated");
    return NextResponse.json({ session: closed, stopped: true });
  }

  // start
  const existing = getActiveSessionForProject(projectId, "coding");
  if (existing) {
    return NextResponse.json({ session: existing, started: false });
  }
  const session = createAgentSession({
    projectId,
    sessionType: "coding",
  });
  return NextResponse.json({ session, started: true }, { status: 201 });
}
