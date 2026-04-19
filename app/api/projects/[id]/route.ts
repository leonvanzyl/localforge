import { NextRequest, NextResponse } from "next/server";
import {
  deleteProject,
  getProject,
  updateProject,
} from "@/lib/projects";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(idStr: string): number | null {
  const n = Number.parseInt(idStr, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// GET /api/projects/:id - fetch a single project
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const numericId = parseId(id);
  if (numericId == null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const project = getProject(numericId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ project });
}

// PATCH /api/projects/:id - update a project (name, description, status)
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const numericId = parseId(id);
  if (numericId == null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { name, description, status } = (body ?? {}) as {
    name?: unknown;
    description?: unknown;
    status?: unknown;
  };
  const updated = updateProject(numericId, {
    name: typeof name === "string" ? name : undefined,
    description:
      description === null
        ? null
        : typeof description === "string"
          ? description
          : undefined,
    status: typeof status === "string" ? status : undefined,
  });
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ project: updated });
}

// DELETE /api/projects/:id?removeFiles=true - delete a project, optionally removing the folder
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const numericId = parseId(id);
  if (numericId == null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const removeFiles = req.nextUrl.searchParams.get("removeFiles") === "true";
  const result = deleteProject(numericId, { removeFiles });
  if (!result.deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, ...result });
}
