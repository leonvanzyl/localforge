import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { createProject, ProjectValidationError } from "@/lib/projects";
import { createFeature, setDependencies } from "@/lib/features";

interface ExampleFeature {
  title: string;
  description: string;
  acceptanceCriteria: string;
  category: "functional" | "style";
  dependsOnIndices: number[];
}

interface ExampleProject {
  name: string;
  description: string;
  features: ExampleFeature[];
}

function loadExample(slug: string): ExampleProject | null {
  try {
    const filePath = join(process.cwd(), "data", "examples", `${slug}.json`);
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ExampleProject;
  } catch {
    return null;
  }
}

/**
 * POST /api/projects/load-example
 *
 * Creates a project from a bundled example file, including all features
 * and their dependency graph.
 *
 * Body: { example: "retro-todo", name?: string }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { example, name } = (body ?? {}) as {
    example?: unknown;
    name?: unknown;
  };

  if (typeof example !== "string" || !example.trim()) {
    return NextResponse.json(
      { error: "Field 'example' is required (e.g. 'retro-todo')" },
      { status: 400 },
    );
  }

  const exampleData = loadExample(example.trim());
  if (!exampleData) {
    return NextResponse.json(
      { error: `Example '${example}' not found` },
      { status: 404 },
    );
  }

  const projectName =
    typeof name === "string" && name.trim()
      ? name.trim()
      : exampleData.name;

  try {
    const project = createProject({
      name: projectName,
      description: exampleData.description,
    });

    const createdIds: number[] = [];
    for (const feat of exampleData.features) {
      const created = createFeature({
        projectId: project.id,
        title: feat.title,
        description: feat.description,
        acceptanceCriteria: feat.acceptanceCriteria,
        category: feat.category,
      });
      createdIds.push(created.id);
    }

    let depsWired = 0;
    for (let i = 0; i < exampleData.features.length; i++) {
      const depIndices = exampleData.features[i].dependsOnIndices;
      if (depIndices.length > 0) {
        const depIds = depIndices
          .filter((idx) => idx >= 0 && idx < createdIds.length)
          .map((idx) => createdIds[idx]);
        if (depIds.length > 0) {
          setDependencies(createdIds[i], depIds);
          depsWired++;
        }
      }
    }

    return NextResponse.json(
      {
        project,
        featuresCreated: createdIds.length,
        dependenciesWired: depsWired,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ProjectValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
