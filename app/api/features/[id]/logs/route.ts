import { NextRequest, NextResponse } from "next/server";

import { getFeature } from "@/lib/features";
import { listAgentLogsForFeature } from "@/lib/agent/logs";

/**
 * GET /api/features/:id/logs
 *
 * Returns every agent_log row tagged to this feature across ALL historical
 * sessions, ordered oldest-first. Used by the feature detail modal's "Agent
 * activity" section (Feature #97) so a user can open any completed feature
 * and see exactly which messages the coding agent emitted while working on
 * it — info, actions, test results, error traces, screenshot refs, etc.
 *
 * This endpoint intentionally spans sessions: a feature that was demoted
 * back to the backlog after a failure and later picked up successfully will
 * have logs from both runs, in chronological order, so you can compare the
 * failure run against the successful one without clicking between sessions.
 *
 * Response:
 *   { logs: AgentLogRecord[] }  — with 200 even when there are no logs
 *   { error: string }           — with 400/404 on validation issues
 */
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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
  const logs = listAgentLogsForFeature(featureId);
  return NextResponse.json({ logs });
}
