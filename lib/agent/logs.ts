import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { agentLogs } from "../db/schema";

/**
 * Agent log helpers.
 *
 * Every message emitted by a running agent session (whether a coding run or
 * the bootstrapper AI conversation) is persisted to the `agent_logs` table
 * so the UI can replay history after a reload and per-feature detail pages
 * can show historical runs. The live agent-activity panel subscribes to the
 * orchestrator's in-memory pub/sub for real-time streaming, and uses these
 * stored rows to bootstrap when reconnecting mid-session.
 */

export type AgentLogRecord = typeof agentLogs.$inferSelect;
export type AgentMessageType =
  | "info"
  | "action"
  | "error"
  | "screenshot"
  | "test_result";

export type AppendAgentLogInput = {
  sessionId: number;
  featureId?: number | null;
  message: string;
  messageType?: AgentMessageType;
  screenshotPath?: string | null;
};

/** Insert a log row and return the inserted record. */
export function appendAgentLog(input: AppendAgentLogInput): AgentLogRecord {
  return db
    .insert(agentLogs)
    .values({
      sessionId: input.sessionId,
      featureId: input.featureId ?? null,
      message: input.message,
      messageType: input.messageType ?? "info",
      screenshotPath: input.screenshotPath ?? null,
    })
    .returning()
    .get();
}

/** List log rows for a session, ordered by id ascending (oldest first). */
export function listAgentLogsForSession(sessionId: number): AgentLogRecord[] {
  return db
    .select()
    .from(agentLogs)
    .where(eq(agentLogs.sessionId, sessionId))
    .all()
    .sort((a, b) => a.id - b.id);
}

/** List log rows for a specific feature across all sessions. */
export function listAgentLogsForFeature(featureId: number): AgentLogRecord[] {
  return db
    .select()
    .from(agentLogs)
    .where(eq(agentLogs.featureId, featureId))
    .all()
    .sort((a, b) => a.id - b.id);
}
