import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { getProjectEffectiveSettings } from "@/lib/settings";
import {
  getDevServerStatus,
  startDevServer,
  stopDevServer,
} from "@/lib/dev-server";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** GET /api/projects/:id/dev-server — check if a dev server is running */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const projectId = parseId(id);
  if (projectId == null) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
  const status = getDevServerStatus(projectId);
  return NextResponse.json(status);
}

/** POST /api/projects/:id/dev-server — start the dev server */
export async function POST(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const projectId = parseId(id);
  if (projectId == null) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const effective = getProjectEffectiveSettings(projectId);
  const port = effective.dev_server_port || "3000";

  const result = startDevServer(projectId, project.folderPath, port);
  if (result.error) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result, { status: 200 });
}

/** DELETE /api/projects/:id/dev-server — stop the dev server */
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const projectId = parseId(id);
  if (projectId == null) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
  const stopped = stopDevServer(projectId);
  return NextResponse.json({ stopped });
}
