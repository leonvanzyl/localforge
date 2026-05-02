import { NextRequest, NextResponse } from "next/server";

import {
  createAgentSession,
  getActiveSessionForProject,
} from "@/lib/agent-sessions";
import { reconcileOrphanAdhocSessions } from "@/lib/agent/orchestrator";
import { getProject } from "@/lib/projects";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function parseProjectId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * POST /api/projects/:id/adhoc-session
 *
 * Returns an existing in-progress ad-hoc Pi chat session or creates one.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id: idStr } = await ctx.params;
  const projectId = parseProjectId(idStr);
  if (projectId == null) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  reconcileOrphanAdhocSessions(projectId);

  const existing = getActiveSessionForProject(projectId, "adhoc");
  if (existing) {
    return NextResponse.json({ session: existing });
  }

  const session = createAgentSession({
    projectId,
    sessionType: "adhoc",
    featureId: null,
  });

  return NextResponse.json({ session });
}
