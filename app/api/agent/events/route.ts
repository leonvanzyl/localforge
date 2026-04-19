import { NextRequest } from "next/server";

import {
  subscribeToAll,
  type OrchestratorEvent,
} from "@/lib/agent/orchestrator";

/**
 * GET /api/agent/events
 *
 * Global SSE stream that broadcasts orchestrator events for ALL running
 * sessions. The root layout's <NotificationListener /> client subscribes
 * here so success/failure toasts fire regardless of which project page the
 * user is currently viewing (Feature #80 - toast on feature completion).
 *
 * Unlike `/api/agent/stream/:sessionId`, this stream never auto-closes - it
 * runs for the lifetime of the client connection and keeps emitting as new
 * sessions start and end.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sseFormat(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: NextRequest) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* noop */
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

      // Announce the connection so the client knows to start listening.
      safeEnqueue(sseFormat("connected", { ts: Date.now() }));

      // Keepalive comment every 15s.
      const keepalive = setInterval(() => {
        safeEnqueue(`: keepalive ${Date.now()}\n\n`);
      }, 15000);
      keepalive.unref?.();

      const unsubscribe = subscribeToAll((ev: OrchestratorEvent) => {
        safeEnqueue(sseFormat(ev.type, ev));
      });

      req.signal.addEventListener("abort", () => {
        clearInterval(keepalive);
        close();
      });
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
