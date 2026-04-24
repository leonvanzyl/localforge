import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { agentSessions, chatMessages } from "./db/schema";

/**
 * Agent session helpers.
 *
 * Agent sessions represent a single run of either the bootstrapper (AI
 * conversation to generate features) or a coding agent (implementing a
 * feature). They live in the `agent_sessions` table.
 *
 * Bootstrapper sessions are created when the user chooses
 * "Describe your project to AI" in the New Project dialog. Each project can
 * have at most one active bootstrapper session at a time - the UI checks
 * for one via GET and redirects to the chat if found.
 */

export type AgentSessionRecord = typeof agentSessions.$inferSelect;
export type ChatMessageRecord = typeof chatMessages.$inferSelect;

export type SessionType = "coding" | "bootstrapper";
export type SessionStatus =
  | "in_progress"
  | "completed"
  | "failed"
  | "terminated";

export type CreateAgentSessionInput = {
  projectId: number;
  sessionType: SessionType;
  featureId?: number | null;
};

/** Create a new agent_session row. Defaults to status='in_progress'. */
export function createAgentSession(
  input: CreateAgentSessionInput,
): AgentSessionRecord {
  const inserted = db
    .insert(agentSessions)
    .values({
      projectId: input.projectId,
      sessionType: input.sessionType,
      featureId: input.featureId ?? null,
      status: "in_progress",
    })
    .returning()
    .get();
  return inserted;
}

export function getAgentSession(id: number): AgentSessionRecord | null {
  const row = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, id))
    .get();
  return row ?? null;
}

/**
 * Find the most recent active (in_progress) session for a project of a given
 * type. Used by the project page to determine whether to render the chat
 * bootstrapper panel.
 */
export function getActiveSessionForProject(
  projectId: number,
  sessionType: SessionType,
): AgentSessionRecord | null {
  const rows = db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.sessionType, sessionType),
        eq(agentSessions.status, "in_progress"),
      ),
    )
    .orderBy(desc(agentSessions.startedAt))
    .all();
  return rows[0] ?? null;
}

/**
 * Find ALL active (in_progress) sessions for a project of a given type.
 * Returns them ordered by most-recently started first.
 */
export function getActiveSessionsForProject(
  projectId: number,
  sessionType: SessionType,
): AgentSessionRecord[] {
  return db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.sessionType, sessionType),
        eq(agentSessions.status, "in_progress"),
      ),
    )
    .orderBy(desc(agentSessions.startedAt))
    .all();
}

/** Mark a session completed (or another terminal status). */
export function closeAgentSession(
  id: number,
  status: SessionStatus = "completed",
): AgentSessionRecord | null {
  const existing = getAgentSession(id);
  if (!existing) return null;
  const updated = db
    .update(agentSessions)
    .set({ status, endedAt: new Date().toISOString() })
    .where(eq(agentSessions.id, id))
    .returning()
    .get();
  return updated ?? null;
}

/* ----------------------------- Chat messages ---------------------------- */

export type AppendChatMessageInput = {
  sessionId: number;
  role: "user" | "assistant";
  content: string;
};

export function appendChatMessage(
  input: AppendChatMessageInput,
): ChatMessageRecord {
  return db
    .insert(chatMessages)
    .values({
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
    })
    .returning()
    .get();
}

export function listChatMessages(sessionId: number): ChatMessageRecord[] {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .all()
    .sort((a, b) => a.id - b.id);
}
