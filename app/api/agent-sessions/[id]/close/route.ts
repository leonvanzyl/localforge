import { NextRequest, NextResponse } from "next/server";
import {
  closeAgentSession,
  getAgentSession,
} from "@/lib/agent-sessions";

/**
 * POST /api/agent-sessions/:id/close
 *
 * Mark an agent session (bootstrapper or coding) as completed. Used by the
 * bootstrapper panel's "End Conversation" button (Feature #60) so the user
 * can wrap up a chat without generating features. If the session is already
 * in a terminal state, returns it unchanged so the caller sees a stable
 * result.
 *
 * Body is optional. If `{ status: "completed" | "failed" | "terminated" }`
 * is provided it is used as the final status; otherwise we default to
 * "completed".
 */
type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const VALID_STATUSES = new Set([
  "completed",
  "failed",
  "terminated",
]);

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const sessionId = parseId(id);
  if (sessionId == null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const existing = getAgentSession(sessionId);
  if (!existing) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // If already closed, return the existing row (idempotent). This lets the
  // UI retry safely after a network hiccup without flipping endedAt around.
  if (existing.status !== "in_progress") {
    return NextResponse.json({ session: existing, closed: false });
  }

  let status: "completed" | "failed" | "terminated" = "completed";
  try {
    const body = (await req.json().catch(() => ({}))) as {
      status?: unknown;
    };
    if (typeof body.status === "string" && VALID_STATUSES.has(body.status)) {
      status = body.status as typeof status;
    }
  } catch {
    // Ignore malformed body; use default status.
  }

  const updated = closeAgentSession(sessionId, status);
  if (!updated) {
    return NextResponse.json(
      { error: "Failed to close session" },
      { status: 500 },
    );
  }
  return NextResponse.json({ session: updated, closed: true });
}
