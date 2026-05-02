import { NextRequest, NextResponse } from "next/server";

import {
  appendChatMessage,
  getAgentSession,
  listChatMessages,
} from "@/lib/agent-sessions";
import {
  OrchestratorError,
  startAdhocAgentTurn,
  type AdhocTurnIntent,
} from "@/lib/agent/orchestrator";
import { getProject } from "@/lib/projects";
import {
  parseAdhocImagesFromRequestBody,
  serializeAttachmentsForDb,
  transcriptTextWithAttachmentNote,
} from "@/lib/adhoc-chat-images";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseIntent(raw: unknown): AdhocTurnIntent {
  if (raw === "edit") return "edit";
  return "ask";
}

/**
 * POST /api/agent-sessions/:id/adhoc-turn
 *
 * Body: { "content": string (optional if images present), "intent"?: "ask" | "edit",
 *         "images"?: { "mimeType": string, "data": string }[] }
 *
 * Appends the user message, then spawns the Pi runner for one turn.
 * Live output: GET /api/agent/stream/:id
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const sessionId = parseId(id);
  if (sessionId == null) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  const session = getAgentSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.sessionType !== "adhoc") {
    return NextResponse.json(
      { error: "Not an ad-hoc chat session" },
      { status: 400 },
    );
  }
  if (session.status !== "in_progress") {
    return NextResponse.json(
      { error: "Session is closed" },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { content, intent: intentRaw, images: imagesRaw } = (body ?? {}) as {
    content?: unknown;
    intent?: unknown;
    images?: unknown;
  };

  const parsedImages = parseAdhocImagesFromRequestBody(imagesRaw);
  if (!parsedImages.ok) {
    return NextResponse.json({ error: parsedImages.error }, { status: 400 });
  }
  const images = parsedImages.images;

  const contentStr = typeof content === "string" ? content.trim() : "";
  if (!contentStr && images.length === 0) {
    return NextResponse.json(
      { error: "Provide message text and/or at least one image" },
      { status: 400 },
    );
  }

  const intent = parseIntent(intentRaw);

  const project = getProject(session.projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const storedContent =
    contentStr ||
    (images.length > 0 ? "(See attached image(s).)" : contentStr);

  appendChatMessage({
    sessionId,
    role: "user",
    content: storedContent,
    attachments: serializeAttachmentsForDb(images),
  });

  const history = listChatMessages(sessionId);
  if (history.length < 1) {
    return NextResponse.json(
      { error: "Failed to persist user message" },
      { status: 500 },
    );
  }
  const transcript = history.slice(0, -1).map((m) => ({
    role: m.role as "user" | "assistant",
    content: transcriptTextWithAttachmentNote(m.content, m.attachments),
  }));
  const userMessage = history[history.length - 1].content;

  try {
    startAdhocAgentTurn({
      session,
      projectDir: project.folderPath,
      transcript,
      userMessage,
      intent,
      userImages: images.length > 0 ? images : undefined,
    });
  } catch (err) {
    if (err instanceof OrchestratorError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    throw err;
  }

  return NextResponse.json({ ok: true, sessionId }, { status: 202 });
}
