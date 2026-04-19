import { NextRequest, NextResponse } from "next/server";
import {
  appendChatMessage,
  getAgentSession,
  listChatMessages,
} from "@/lib/agent-sessions";
import {
  streamChatCompletion,
  type LMStudioChatMessage,
} from "@/lib/agent/lm-studio";
import { getGlobalSettings } from "@/lib/settings";

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
 * System prompt that shapes the bootstrapper's behaviour. It keeps replies
 * short so a local CPU model can stay responsive, and nudges the model
 * towards the spec-style questions the user ultimately needs answered.
 */
const BOOTSTRAPPER_SYSTEM_PROMPT = `You are LocalForge's AI bootstrapper. You help the user describe an app they
want to build. You are friendly, concise, and speak in 2-4 sentences per
reply. Ask one or two follow-up questions at a time about the app's users,
core features, data, and UI. When the user seems satisfied with the plan,
say so and invite them to click "Generate feature list" to continue.
Never produce code, markdown tables, or long bullet walls — keep replies
conversational.`;

/**
 * POST /api/agent-sessions/:id/messages
 *
 * Appends a user message to the session and streams the assistant reply as
 * Server-Sent Events. Events emitted:
 *   {"type":"user","message":ChatMessageRecord}
 *   {"type":"delta","content":string}      — zero or more, incremental text
 *   {"type":"assistant","message":ChatMessageRecord}
 *   {"type":"done"}
 *   {"type":"error","message":string}     — if LM Studio is unreachable
 *
 * The assistant's full text is persisted to chat_messages after streaming
 * completes so subsequent page loads show the final reply. When LM Studio
 * errors, no assistant row is saved and the client renders the error bubble.
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

  // Feature #93 step 3: once a session has been closed (completed / failed /
  // terminated) it must not accept any further messages. Reject with 409
  // so a stale client — either the bootstrapper panel before it refreshes or
  // a raw API caller — gets a clear "conversation is over" signal instead
  // of silently piling onto a finished transcript.
  if (session.status !== "in_progress") {
    return NextResponse.json(
      {
        error:
          "This session is closed. Start a new conversation to keep chatting.",
      },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { content } = (body ?? {}) as { content?: unknown };
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json(
      { error: "Field 'content' is required" },
      { status: 400 },
    );
  }

  // Persist the user message up-front so even if LM Studio blows up, the
  // transcript still contains what the user asked.
  const userMessage = appendChatMessage({
    sessionId,
    role: "user",
    content: content.trim(),
  });

  // Build the LLM transcript from the full chat history (including the just-
  // inserted user row) plus our steering system prompt.
  const history = listChatMessages(sessionId);
  const llmMessages: LMStudioChatMessage[] = [
    { role: "system", content: BOOTSTRAPPER_SYSTEM_PROMPT },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const settings = getGlobalSettings();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(obj)}\n\n`),
        );
      };

      send({ type: "user", message: userMessage });

      let full = "";
      let errored = false;
      try {
        for await (const evt of streamChatCompletion({
          baseUrl: settings.lm_studio_url,
          model: settings.model,
          messages: llmMessages,
          signal: req.signal,
        })) {
          if (evt.type === "delta") {
            full += evt.content;
            send({ type: "delta", content: evt.content });
          } else if (evt.type === "error") {
            errored = true;
            send({ type: "error", message: evt.message });
            break;
          } else if (evt.type === "done") {
            full = evt.fullText || full;
          }
        }

        if (!errored) {
          const assistantMessage = appendChatMessage({
            sessionId,
            role: "assistant",
            content: full.trim() || "(empty response)",
          });
          send({ type: "assistant", message: assistantMessage });
          send({ type: "done" });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
