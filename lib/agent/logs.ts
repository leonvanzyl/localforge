import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { agentLogs, features } from "../db/schema";

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

/**
 * Parsed Playwright test-result summary. The runner writes test_result log
 * rows with a message like:
 *   "npx playwright test completed: 1 passed, 0 failed (639ms)"
 * and older runs omit the failed/duration segments:
 *   "npx playwright test completed: 1 passed"
 *
 * Feature #96 surfaces the parsed counts on the kanban card so every feature
 * can advertise its most recent pass/fail badge without the user having to
 * open the detail modal.
 */
export type FeatureTestResult = {
  passed: number;
  failed: number;
  total: number;
  ok: boolean;
  durationMs: number | null;
  rawMessage: string;
  createdAt: string;
};

const TEST_RESULT_PATTERN =
  /(\d+)\s+passed(?:\s*,\s*(\d+)\s+failed)?(?:\s*\((\d+)\s*ms\))?/i;

/** Parse a test_result log message into structured counts; null if not parseable. */
export function parseTestResultMessage(raw: string): FeatureTestResult | null {
  if (typeof raw !== "string") return null;
  const match = TEST_RESULT_PATTERN.exec(raw);
  if (!match) return null;
  const passed = Number.parseInt(match[1] ?? "0", 10) || 0;
  const failed = Number.parseInt(match[2] ?? "0", 10) || 0;
  const durationMs =
    match[3] != null ? Number.parseInt(match[3], 10) || 0 : null;
  const total = passed + failed;
  return {
    passed,
    failed,
    total,
    ok: failed === 0 && passed > 0,
    durationMs,
    rawMessage: raw,
    // Caller fills createdAt — this helper only parses the message text.
    createdAt: "",
  };
}

/**
 * Fetch the most recent `test_result` log row for each of the supplied feature
 * ids and return a map `featureId -> FeatureTestResult`. Features without a
 * test_result row are simply omitted from the map.
 *
 * Used by `GET /api/projects/:id/features` so every kanban card carries the
 * counts from its latest Playwright run (Feature #96 verification step 4).
 */
export function getLatestTestResultsForFeatures(
  featureIds: number[],
): Map<number, FeatureTestResult> {
  const map = new Map<number, FeatureTestResult>();
  if (!Array.isArray(featureIds) || featureIds.length === 0) return map;

  const rows = db
    .select()
    .from(agentLogs)
    .where(
      and(
        eq(agentLogs.messageType, "test_result"),
        inArray(agentLogs.featureId, featureIds),
      ),
    )
    .all();

  // Sort DESC by id so the first row we encounter for a feature is the latest.
  rows.sort((a, b) => b.id - a.id);
  for (const row of rows) {
    if (row.featureId == null) continue;
    if (map.has(row.featureId)) continue;
    const parsed = parseTestResultMessage(row.message);
    if (parsed) {
      parsed.createdAt = row.createdAt;
      map.set(row.featureId, parsed);
    }
  }
  return map;
}

/**
 * Convenience wrapper: load every feature id in a project, then call
 * getLatestTestResultsForFeatures. Keeps the API route thin.
 */
export function getLatestTestResultsForProject(
  projectId: number,
): Map<number, FeatureTestResult> {
  const rows = db
    .select({ id: features.id })
    .from(features)
    .where(eq(features.projectId, projectId))
    .all();
  return getLatestTestResultsForFeatures(rows.map((r) => r.id));
}
