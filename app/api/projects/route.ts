import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/projects";

// GET /api/projects - list all projects
export async function GET() {
  try {
    const all = listProjects();
    return NextResponse.json({ projects: all });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/projects - create a new project (also creates folder on disk)
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { name, description } = (body ?? {}) as {
    name?: unknown;
    description?: unknown;
  };

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { error: "Field 'name' is required and must be a non-empty string" },
      { status: 400 },
    );
  }

  try {
    const created = createProject({
      name,
      description: typeof description === "string" ? description : null,
    });
    return NextResponse.json({ project: created }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
