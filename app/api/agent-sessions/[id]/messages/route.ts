import { NextRequest, NextResponse } from "next/server";
import {
  appendChatMessage,
  getAgentSession,
  listChatMessages,
} from "@/lib/agent-sessions";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(idStr: string): number | null {
  const n = Number.parseInt(idStr, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * GET /api/agent-sessions/:id/messages
 *
 * Returns the chat history for a session, ordered oldest first.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const sessionId = parseId(id);
  if (sessionId == null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const session = getAgentSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const messages = listChatMessages(sessionId);
  return NextResponse.json({ messages });
}

/**
 * POST /api/agent-sessions/:id/messages
 *
 * Appends a user message to the session. Returns the persisted user row
 * plus a placeholder assistant reply (LM Studio plumbing arrives in a
 * later feature — we keep the API shape stable so the client doesn't
 * change).
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const sessionId = parseId(id);
  if (sessionId == null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const session = getAgentSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { content, role } = (body ?? {}) as {
    content?: unknown;
    role?: unknown;
  };
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json(
      { error: "Field 'content' is required" },
      { status: 400 },
    );
  }
  const safeRole = role === "assistant" ? "assistant" : "user";

  const user = appendChatMessage({
    sessionId,
    role: safeRole,
    content: content.trim(),
  });

  // Placeholder acknowledgement. A later feature will replace this with a
  // real Claude Agent SDK streaming reply.
  const assistant = appendChatMessage({
    sessionId,
    role: "assistant",
    content:
      "Got it. I'll keep track of what you've shared. (LM Studio streaming plugs in here in a future feature.)",
  });

  return NextResponse.json({ user, assistant });
}
