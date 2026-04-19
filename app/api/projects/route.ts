import { NextRequest, NextResponse } from "next/server";
import {
  createProject,
  listProjectsWithProgress,
  ProjectValidationError,
} from "@/lib/projects";

// GET /api/projects - list all projects with feature progress counts
export async function GET() {
  try {
    const all = listProjectsWithProgress();
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
    // Domain validation errors (empty name, overly long name, etc.) surface
    // as 400 so the client can show the message inline. Anything else is
    // an unexpected server problem and becomes a 500.
    if (err instanceof ProjectValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
