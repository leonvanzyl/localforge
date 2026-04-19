import { NextRequest, NextResponse } from "next/server";

import { getAgentSession } from "@/lib/agent-sessions";
import {
  listAgentLogsForSession,
  type AgentMessageType,
} from "@/lib/agent/logs";
import {
  subscribeToSession,
  type OrchestratorEvent,
} from "@/lib/agent/orchestrator";

/**
 * GET /api/agent/stream/:sessionId
 *
 * Server-Sent Events stream that pushes live orchestrator events (log lines
 * and status transitions) for a single agent_session. This is what Feature
 * #71 connects to — the agent activity panel opens an EventSource and
 * appends every message as it arrives.
 *
 * The stream replays existing log rows on connect (so reopening the panel
 * after a scroll-away doesn't lose history) then subscribes to the in-memory
 * event bus for future messages. When the session reaches a terminal status,
 * a final `status` event is pushed and the stream is closed cleanly.
 *
 * Client contract:
 *   - event type "log"       - payload is OrchestratorLogEvent JSON
 *   - event type "status"    - payload is OrchestratorStatusEvent JSON
 *   - event type "replay-complete" - emitted after history is flushed
 *   - connection closes when session reaches a terminal status (completed |
 *     failed | terminated), or when the client disconnects.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sseFormat(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { sessionId: sessionIdStr } = await ctx.params;
  const sessionId = parseId(sessionIdStr);
  if (sessionId == null) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }
  const session = getAgentSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // controller may be closed already — swallow.
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          unsubscribe();
        } catch {
          /* noop */
        }
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };

      // Send a keepalive comment every 15 seconds so proxies / browsers
      // don't time out idle connections.
      const keepalive = setInterval(() => {
        safeEnqueue(`: keepalive ${Date.now()}\n\n`);
      }, 15000);
      keepalive.unref?.();

      // 1) Replay stored log history so reconnecting clients don't lose
      //    messages that were broadcast before they subscribed.
      const history = listAgentLogsForSession(sessionId);
      for (const row of history) {
        safeEnqueue(
          sseFormat("log", {
            type: "log",
            sessionId: row.sessionId,
            featureId: row.featureId,
            message: row.message,
            messageType: row.messageType as AgentMessageType,
            screenshotPath: row.screenshotPath,
            createdAt: row.createdAt,
            logId: row.id,
            replayed: true,
          }),
        );
      }
      safeEnqueue(
        sseFormat("replay-complete", { count: history.length }),
      );

      // 2) Subscribe to live events.
      const unsubscribe = subscribeToSession(sessionId, (ev: OrchestratorEvent) => {
        safeEnqueue(sseFormat(ev.type, ev));
        if (
          ev.type === "status" &&
          (ev.sessionStatus === "completed" ||
            ev.sessionStatus === "failed" ||
            ev.sessionStatus === "terminated")
        ) {
          // Flush and close shortly after the terminal status so the client
          // sees the final event before the stream ends.
          setTimeout(() => {
            clearInterval(keepalive);
            close();
          }, 50);
        }
      });

      // 3) If the session is ALREADY in a terminal state when the client
      //    connects (e.g. reopened the panel after completion), emit a
      //    synthetic status event and close the stream so the client knows
      //    not to wait forever.
      if (
        session.status === "completed" ||
        session.status === "failed" ||
        session.status === "terminated"
      ) {
        safeEnqueue(
          sseFormat("status", {
            type: "status",
            sessionId: session.id,
            featureId: session.featureId,
            sessionStatus: session.status,
            final: true,
          }),
        );
        setTimeout(() => {
          clearInterval(keepalive);
          close();
        }, 50);
      }

      // Clean up when the client disconnects.
      const abort = () => {
        clearInterval(keepalive);
        close();
      };
      req.signal.addEventListener("abort", abort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
