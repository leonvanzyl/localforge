import { NextRequest, NextResponse } from "next/server";
import {
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
 * GET /api/projects/:id/bootstrapper-session
 *
 * Returns the currently-active (in_progress) bootstrapper session for a
 * project, or `null` if none exists. The project page uses this to decide
 * whether to render the chat UI.
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

  const session = getActiveSessionForProject(projectId, "bootstrapper");
  return NextResponse.json({ session });
}

/**
 * POST /api/projects/:id/bootstrapper-session
 *
 * Creates a new bootstrapper agent_session for the project with
 * status='in_progress'. If an active session already exists, returns it
 * instead of creating a duplicate (idempotent).
 */
export async function POST(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const projectId = parseId(id);
  if (projectId == null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const existing = getActiveSessionForProject(projectId, "bootstrapper");
  if (existing) {
    return NextResponse.json({ session: existing, reused: true });
  }

  try {
    const session = createAgentSession({
      projectId,
      sessionType: "bootstrapper",
    });
    return NextResponse.json({ session, reused: false }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
