import { NextRequest, NextResponse } from "next/server";
import {
  FeatureValidationError,
  deleteFeature,
  getFeature,
  updateFeature,
  countDependencies,
} from "@/lib/features";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** GET /api/features/:id - fetch a single feature with its dependency count. */
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
  return NextResponse.json({
    feature: {
      ...feature,
      dependencyCount: countDependencies(featureId),
    },
  });
}

/** PATCH /api/features/:id - update title, description, acceptance, status, priority, category. */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
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

  const {
    title,
    description,
    acceptanceCriteria,
    status,
    priority,
    category,
  } = (body ?? {}) as Record<string, unknown>;

  try {
    const updated = updateFeature(featureId, {
      title: typeof title === "string" ? title : undefined,
      description:
        description === null
          ? null
          : typeof description === "string"
            ? description
            : undefined,
      acceptanceCriteria:
        acceptanceCriteria === null
          ? null
          : typeof acceptanceCriteria === "string"
            ? acceptanceCriteria
            : undefined,
      status: typeof status === "string" ? (status as never) : undefined,
      priority: typeof priority === "number" ? priority : undefined,
      category: typeof category === "string" ? (category as never) : undefined,
    });
    if (!updated) {
      return NextResponse.json(
        { error: "Feature not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ feature: updated });
  } catch (err) {
    if (err instanceof FeatureValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/features/:id - remove a feature (cascades to dependencies). */
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const featureId = parseId(id);
  if (featureId == null) {
    return NextResponse.json({ error: "Invalid feature id" }, { status: 400 });
  }
  const deleted = deleteFeature(featureId);
  if (!deleted) {
    return NextResponse.json({ error: "Feature not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
