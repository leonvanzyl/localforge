import { NextRequest, NextResponse } from "next/server";
import {
  FeatureValidationError,
  addDependency,
  getFeature,
  listDependencies,
  removeDependency,
  setDependencies,
} from "@/lib/features";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** GET /api/features/:id/dependencies - list prerequisite features. */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const featureId = parseId(id);
  if (featureId == null) {
    return NextResponse.json({ error: "Invalid feature id" }, { status: 400 });
  }
  const feature = getFeature(featureId);
  if (!feature) {
    return NextResponse.json({ error: "Feature not found" }, { status: 404 });
  }
  const deps = listDependencies(featureId);
  return NextResponse.json({ dependencies: deps });
}

/**
 * POST /api/features/:id/dependencies - add a single dependency.
 * Body: { dependsOnFeatureId: number }
 *
 * Or bulk replace: { dependsOn: number[] } replaces the entire dep set.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const featureId = parseId(id);
  if (featureId == null) {
    return NextResponse.json({ error: "Invalid feature id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const { dependsOnFeatureId, dependsOn } = (body ?? {}) as Record<
    string,
    unknown
  >;

  try {
    if (Array.isArray(dependsOn)) {
      const ids = dependsOn
        .map((v) =>
          typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null,
        )
        .filter((v): v is number => v != null);
      const updated = setDependencies(featureId, ids);
      return NextResponse.json({ dependencies: updated }, { status: 200 });
    }

    if (
      typeof dependsOnFeatureId !== "number" ||
      !Number.isFinite(dependsOnFeatureId) ||
      dependsOnFeatureId <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Body must include dependsOnFeatureId (number) or dependsOn (number[])",
        },
        { status: 400 },
      );
    }

    const inserted = addDependency(featureId, dependsOnFeatureId);
    return NextResponse.json({ dependency: inserted }, { status: 201 });
  } catch (err) {
    if (err instanceof FeatureValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/features/:id/dependencies?dependsOnFeatureId=NN
 * Remove a single dependency row.
 */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const featureId = parseId(id);
  if (featureId == null) {
    return NextResponse.json({ error: "Invalid feature id" }, { status: 400 });
  }
  const dependsOnRaw = req.nextUrl.searchParams.get("dependsOnFeatureId");
  const dependsOnFeatureId = dependsOnRaw ? parseId(dependsOnRaw) : null;
  if (dependsOnFeatureId == null) {
    return NextResponse.json(
      { error: "Query param dependsOnFeatureId is required" },
      { status: 400 },
    );
  }
  const removed = removeDependency(featureId, dependsOnFeatureId);
  if (!removed) {
    return NextResponse.json(
      { error: "Dependency not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ success: true });
}
