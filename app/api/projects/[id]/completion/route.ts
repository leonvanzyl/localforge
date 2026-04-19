import { NextRequest, NextResponse } from "next/server";
import { getProjectCompletionStats } from "@/lib/projects";

/**
 * GET /api/projects/:id/completion
 *
 * Returns the celebration-screen summary (Feature #101). Always 200 when the
 * project exists, regardless of current status — the client decides whether
 * to render the celebration view based on `status === "completed"`.
 */
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const projectId = parseId(id);
  if (projectId == null) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
  const stats = getProjectCompletionStats(projectId);
  if (!stats) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ completion: stats });
}
