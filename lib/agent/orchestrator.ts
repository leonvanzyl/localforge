import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

import {
  closeAgentSession,
  createAgentSession,
  getActiveSessionForProject,
  type AgentSessionRecord,
  type SessionStatus,
} from "../agent-sessions";
import {
  appendAgentLog,
  type AgentMessageType,
} from "./logs";
import {
  findNextReadyFeatureForProject,
  demoteFeatureToBacklog,
  getFeature,
  updateFeature,
  type FeatureRecord,
} from "../features";
import {
  getProject,
  markProjectCompletedIfAllDone,
} from "../projects";
import { getEffectiveProviderConfig } from "../settings";

/**
 * Coding-agent orchestrator.
 *
 * Responsibilities (features #63, #67, #68):
 *   1. Pick the highest-priority ready backlog feature for a project and
 *      transition it to `in_progress`.
 *   2. Spawn a Claude Agent SDK runner as a detached Node.js child process
 *      (scripts/agent-runner.mjs) wired to the project's LM Studio config.
 *   3. Parse the runner's JSON-lines stdout into agent_log rows and broadcast
 *      them to any live SSE subscribers (Feature #71 uses this via
 *      `subscribe(sessionId, listener)`).
 *   4. When the runner exits, transition the feature to `completed` on
 *      success or demote it back to the backlog with a lowered priority on
 *      failure. Close the agent_session row in either case.
 *
 * The active set of sessions lives in an in-process map. Persistence of
 * *results* (session rows, logs, feature status) is all in SQLite so nothing
 * is lost if the dev server restarts mid-run; the child process is
 * orphaned/reaped but the UI picks up the stored state on reload.
 *
 * This module is intentionally *not* a React/Next concern — it's a plain
 * Node.js module with an EventEmitter so API routes, SSE endpoints, and unit
 * tests can all share the same instance.
 */

export type OrchestratorLogEvent = {
  type: "log";
  sessionId: number;
  featureId: number | null;
  message: string;
  messageType: AgentMessageType;
  screenshotPath?: string | null;
  createdAt: string;
  logId: number;
};

export type OrchestratorStatusEvent = {
  type: "status";
  sessionId: number;
  featureId: number | null;
  sessionStatus: SessionStatus;
  featureName?: string;
  featureStatus?: FeatureRecord["status"];
};

/**
 * Emitted once when every feature in a project reaches the `completed` state
 * and the project row's status is flipped to `completed` (Feature #101). The
 * celebration screen subscribes to this so it can fire confetti without
 * polling.
 *
 * Note: sessionId is set to the final winning coding session so that listeners
 * using the generic `subscribeToAll` shape still have a defined field, but
 * consumers typically only key off `projectId`.
 */
export type OrchestratorProjectCompletedEvent = {
  type: "project_completed";
  sessionId: number;
  projectId: number;
};

export type OrchestratorEvent =
  | OrchestratorLogEvent
  | OrchestratorStatusEvent
  | OrchestratorProjectCompletedEvent;

type RunningSession = {
  session: AgentSessionRecord;
  feature: FeatureRecord;
  child: ChildProcessWithoutNullStreams;
  stdoutBuffer: string;
  stderrBuffer: string;
  /**
   * Absolute path to the JSON prompt file written for this run. The runner
   * reads it on startup; the orchestrator cleans it up in the close handler.
   */
  promptFile: string;
};

type OrchestratorState = {
  running: Map<number, RunningSession>; // keyed by session id
  events: EventEmitter;
};

// Hot-reload safe singleton. Next.js dev mode will clear this module's
// exports whenever the file changes, but child processes + subscribers are
// expensive to lose, so we stash the state on globalThis.
const GLOBAL_KEY = Symbol.for("localforge.orchestrator.state");
type GlobalStash = { [GLOBAL_KEY]?: OrchestratorState };
const g = globalThis as unknown as GlobalStash;

function getState(): OrchestratorState {
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      running: new Map(),
      events: new EventEmitter(),
    };
    // EventEmitter defaults to 10 listeners; SSE connections can stack up
    // during development hot reloads so raise the cap.
    g[GLOBAL_KEY].events.setMaxListeners(50);
  }
  return g[GLOBAL_KEY];
}

function broadcast(event: OrchestratorEvent): void {
  getState().events.emit("event", event);
  getState().events.emit(`session:${event.sessionId}`, event);
  if (event.type === "project_completed") {
    getState().events.emit(`project:${event.projectId}`, event);
  }
}

/**
 * Subscribe to project-scoped events (currently just project_completed). The
 * celebration screen uses this to fire confetti without polling.
 */
export function subscribeToProject(
  projectId: number,
  listener: (ev: OrchestratorEvent) => void,
): () => void {
  const key = `project:${projectId}`;
  getState().events.on(key, listener);
  return () => {
    getState().events.off(key, listener);
  };
}

/**
 * Subscribe to events emitted by the orchestrator for a given session. The
 * returned function removes the listener. Callers should call it on
 * disconnect to avoid leaking listeners.
 */
export function subscribeToSession(
  sessionId: number,
  listener: (ev: OrchestratorEvent) => void,
): () => void {
  const key = `session:${sessionId}`;
  getState().events.on(key, listener);
  return () => {
    getState().events.off(key, listener);
  };
}

/**
 * Subscribe to ALL orchestrator events (any session). Used by the toast
 * notifier so a single subscription picks up completion events for every
 * running session, including ones that are started after the client connects.
 */
export function subscribeToAll(
  listener: (ev: OrchestratorEvent) => void,
): () => void {
  getState().events.on("event", listener);
  return () => {
    getState().events.off("event", listener);
  };
}

export function isSessionRunning(sessionId: number): boolean {
  return getState().running.has(sessionId);
}

export function getRunningSessionsForProject(
  projectId: number,
): AgentSessionRecord[] {
  const out: AgentSessionRecord[] = [];
  for (const rs of getState().running.values()) {
    if (rs.session.projectId === projectId) out.push(rs.session);
  }
  return out;
}

export type StartResult = {
  session: AgentSessionRecord;
  feature: FeatureRecord;
  started: boolean;
};

/**
 * Start the orchestrator for a project. Picks the highest-priority ready
 * feature, creates the agent_session row, spawns the runner child process,
 * and returns the session + feature.
 *
 * Idempotent: if a coding session is already in progress for the project
 * (including one whose child process is still alive), returns it instead of
 * starting a new one.
 *
 * Throws when:
 *   - the project does not exist
 *   - there is no ready feature to work on
 */
export function startOrchestrator(projectId: number): StartResult {
  const project = getProject(projectId);
  if (!project) {
    throw new OrchestratorError("Project not found", 404);
  }

  // Return any running session as-is (idempotent). Also reconcile a stale
  // in_progress session row whose child process has died - this keeps the DB
  // from getting wedged if the dev server crashed mid-run.
  const existing = getActiveSessionForProject(projectId, "coding");
  if (existing && getState().running.has(existing.id)) {
    const rs = getState().running.get(existing.id)!;
    return {
      session: rs.session,
      feature: rs.feature,
      started: false,
    };
  }
  if (existing && !getState().running.has(existing.id)) {
    // Reap: close the orphaned row so we can create a fresh session below.
    closeAgentSession(existing.id, "terminated");
  }

  const feature = findNextReadyFeatureForProject(projectId);
  if (!feature) {
    throw new OrchestratorError(
      "No ready features to work on (backlog empty or all blocked)",
      409,
    );
  }

  // Flip the feature to in_progress before creating the session so the UI
  // sees a consistent state if it reloads between these two writes.
  const movedFeature = updateFeature(feature.id, { status: "in_progress" });
  if (!movedFeature) {
    throw new OrchestratorError("Failed to transition feature status", 500);
  }

  const session = createAgentSession({
    projectId,
    sessionType: "coding",
    featureId: movedFeature.id,
  });

  // Persist + broadcast a startup log so the UI has something to render
  // immediately (the runner's first line lands ~50ms later).
  const startLog = appendAgentLog({
    sessionId: session.id,
    featureId: movedFeature.id,
    message: `Orchestrator starting coding agent for "${movedFeature.title}"`,
    messageType: "info",
  });
  broadcast({
    type: "log",
    sessionId: session.id,
    featureId: movedFeature.id,
    message: startLog.message,
    messageType: startLog.messageType as AgentMessageType,
    screenshotPath: startLog.screenshotPath,
    createdAt: startLog.createdAt,
    logId: startLog.id,
  });
  broadcast({
    type: "status",
    sessionId: session.id,
    featureId: movedFeature.id,
    sessionStatus: "in_progress",
    featureName: movedFeature.title,
    featureStatus: "in_progress",
  });

  const { child, promptFile } = spawnAgentRunner({
    session,
    feature: movedFeature,
    projectDir: project.folderPath,
  });

  const rs: RunningSession = {
    session,
    feature: movedFeature,
    child,
    stdoutBuffer: "",
    stderrBuffer: "",
    promptFile,
  };
  getState().running.set(session.id, rs);

  attachChildHandlers(rs);

  return { session, feature: movedFeature, started: true };
}

/**
 * Force-stop a running orchestrator session. Terminates the child process
 * and marks the session as terminated. The feature is moved back to the
 * backlog if it was still in_progress.
 */
export function stopOrchestratorSession(sessionId: number): {
  stopped: boolean;
  session: AgentSessionRecord | null;
} {
  const rs = getState().running.get(sessionId);
  if (!rs) {
    // The session may already have finished, or this is an orphan row from
    // a dev-server crash. Either way, close the DB row as terminated so the
    // UI can render a consistent state. closeAgentSession is a no-op if the
    // row already has a terminal status.
    const closed = closeAgentSession(sessionId, "terminated");
    return { stopped: false, session: closed };
  }

  // Signal the child first so its SIGTERM handler can emit a final log
  // line. Fall back to SIGKILL after 500ms if it's still alive.
  try {
    rs.child.kill("SIGTERM");
  } catch {
    // best-effort
  }
  const killTimer = setTimeout(() => {
    try {
      if (!rs.child.killed) rs.child.kill("SIGKILL");
    } catch {
      /* noop */
    }
  }, 500);
  killTimer.unref();

  // The 'close' handler will finish the cleanup: feature → backlog,
  // session → terminated, running map entry removed. Return the current
  // session row here so the HTTP caller has something to report.
  return { stopped: true, session: rs.session };
}

/** Internal error class so API routes can translate to the right status code. */
export class OrchestratorError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
    this.name = "OrchestratorError";
  }
}

/* --------------------------- Child process ---------------------------- */

function spawnAgentRunner(args: {
  session: AgentSessionRecord;
  feature: FeatureRecord;
  projectDir: string;
}): { child: ChildProcessWithoutNullStreams; promptFile: string } {
  const runnerPath = path.join(process.cwd(), "scripts", "agent-runner.mjs");
  const { baseUrl, model, provider } = getEffectiveProviderConfig(
    args.session.projectId,
  );

  // Write the feature context to a temp JSON file so the runner can read
  // long descriptions and acceptance criteria without argv escaping pain.
  const promptFile = path.join(
    os.tmpdir(),
    `localforge-prompt-${args.session.id}.json`,
  );
  fs.writeFileSync(
    promptFile,
    JSON.stringify(
      {
        id: args.feature.id,
        title: args.feature.title,
        description: args.feature.description,
        acceptanceCriteria: args.feature.acceptanceCriteria,
      },
      null,
      2,
    ),
    "utf8",
  );

  const argv = [
    runnerPath,
    "--session-id",
    String(args.session.id),
    "--feature-id",
    String(args.feature.id),
    "--feature-title",
    args.feature.title,
    "--prompt-file",
    promptFile,
    "--project-dir",
    args.projectDir,
    "--base-url",
    baseUrl,
    "--provider",
    provider,
    "--model",
    model,
  ];

  const child = spawn(process.execPath, argv, {
    cwd: args.projectDir,
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: baseUrl,
      LOCALFORGE_SESSION_ID: String(args.session.id),
      LOCALFORGE_FEATURE_ID: String(args.feature.id),
    },
    stdio: "pipe",
  });
  return { child, promptFile };
}

function attachChildHandlers(rs: RunningSession): void {
  const { child, session, feature } = rs;

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk: string) => {
    rs.stdoutBuffer += chunk;
    let nl = rs.stdoutBuffer.indexOf("\n");
    while (nl !== -1) {
      const line = rs.stdoutBuffer.slice(0, nl).trim();
      rs.stdoutBuffer = rs.stdoutBuffer.slice(nl + 1);
      if (line.length > 0) handleRunnerLine(rs, line);
      nl = rs.stdoutBuffer.indexOf("\n");
    }
  });

  child.stderr.on("data", (chunk: string) => {
    rs.stderrBuffer += chunk;
    // Don't try to parse JSON from stderr — just buffer it for the close
    // handler in case of a crash diagnostic. A non-empty stderr by itself
    // isn't a failure signal.
  });

  child.on("error", (err) => {
    const log = appendAgentLog({
      sessionId: session.id,
      featureId: feature.id,
      message: `Failed to spawn agent runner: ${err.message}`,
      messageType: "error",
    });
    broadcast({
      type: "log",
      sessionId: session.id,
      featureId: feature.id,
      message: log.message,
      messageType: "error",
      screenshotPath: log.screenshotPath,
      createdAt: log.createdAt,
      logId: log.id,
    });
    finalizeSession(rs, "failed");
  });

  child.on("close", (code, signal) => {
    // Flush any unterminated line still in the stdout buffer.
    if (rs.stdoutBuffer.trim().length > 0) {
      handleRunnerLine(rs, rs.stdoutBuffer.trim());
      rs.stdoutBuffer = "";
    }

    // Decide outcome: the runner's "done" event sets this via
    // finalizeSession() already; if not, infer from exit code.
    if (getState().running.has(session.id)) {
      if (code === 0) {
        finalizeSession(rs, "success");
      } else {
        const reason =
          signal != null
            ? `terminated by ${signal}`
            : `runner exited with code ${code ?? "unknown"}`;
        const log = appendAgentLog({
          sessionId: session.id,
          featureId: feature.id,
          message: reason,
          messageType: "error",
        });
        broadcast({
          type: "log",
          sessionId: session.id,
          featureId: feature.id,
          message: log.message,
          messageType: "error",
          screenshotPath: log.screenshotPath,
          createdAt: log.createdAt,
          logId: log.id,
        });
        finalizeSession(
          rs,
          signal === "SIGTERM" || signal === "SIGKILL" ? "terminated" : "failed",
        );
      }
    }
  });
}

type RunnerLogLine = {
  type: "log";
  message: string;
  messageType?: string;
  screenshotPath?: string | null;
};
type RunnerDoneLine = {
  type: "done";
  outcome: "success" | "failure";
  reason?: string;
};
type RunnerLine = RunnerLogLine | RunnerDoneLine;

function handleRunnerLine(rs: RunningSession, raw: string): void {
  let parsed: RunnerLine | null = null;
  try {
    const obj = JSON.parse(raw) as RunnerLine;
    parsed = obj;
  } catch {
    // Not JSON — treat it as a raw info log so nothing is lost.
    const log = appendAgentLog({
      sessionId: rs.session.id,
      featureId: rs.feature.id,
      message: raw,
      messageType: "info",
    });
    broadcast({
      type: "log",
      sessionId: rs.session.id,
      featureId: rs.feature.id,
      message: log.message,
      messageType: "info",
      screenshotPath: log.screenshotPath,
      createdAt: log.createdAt,
      logId: log.id,
    });
    return;
  }

  if (parsed.type === "log") {
    const messageType = normaliseMessageType(parsed.messageType);
    const log = appendAgentLog({
      sessionId: rs.session.id,
      featureId: rs.feature.id,
      message: parsed.message,
      messageType,
      screenshotPath: parsed.screenshotPath ?? null,
    });
    broadcast({
      type: "log",
      sessionId: rs.session.id,
      featureId: rs.feature.id,
      message: log.message,
      messageType,
      screenshotPath: log.screenshotPath,
      createdAt: log.createdAt,
      logId: log.id,
    });
    return;
  }

  if (parsed.type === "done") {
    const outcome = parsed.outcome;
    finalizeSession(rs, outcome === "success" ? "success" : "failed");
  }
}

function normaliseMessageType(raw: unknown): AgentMessageType {
  const valid: AgentMessageType[] = [
    "info",
    "action",
    "error",
    "screenshot",
    "test_result",
  ];
  if (typeof raw === "string" && valid.includes(raw as AgentMessageType)) {
    return raw as AgentMessageType;
  }
  return "info";
}

function finalizeSession(
  rs: RunningSession,
  outcome: "success" | "failed" | "terminated",
): void {
  // Idempotent — only run once per session.
  if (!getState().running.has(rs.session.id)) return;
  getState().running.delete(rs.session.id);

  // Best-effort cleanup of the temp prompt file the runner consumed.
  try {
    if (rs.promptFile) fs.unlinkSync(rs.promptFile);
  } catch {
    /* ignore */
  }

  let finalSessionStatus: SessionStatus;
  let finalFeature: FeatureRecord | null = getFeature(rs.feature.id);

  if (outcome === "success") {
    finalSessionStatus = "completed";
    finalFeature = updateFeature(rs.feature.id, { status: "completed" });
    const log = appendAgentLog({
      sessionId: rs.session.id,
      featureId: rs.feature.id,
      message: `Feature "${rs.feature.title}" marked completed`,
      messageType: "info",
    });
    broadcast({
      type: "log",
      sessionId: rs.session.id,
      featureId: rs.feature.id,
      message: log.message,
      messageType: "info",
      screenshotPath: log.screenshotPath,
      createdAt: log.createdAt,
      logId: log.id,
    });
  } else if (outcome === "failed") {
    finalSessionStatus = "failed";
    const demoted = demoteFeatureToBacklog(rs.feature.id);
    finalFeature = demoted;
    const log = appendAgentLog({
      sessionId: rs.session.id,
      featureId: rs.feature.id,
      message: demoted
        ? `Feature "${rs.feature.title}" demoted back to backlog (priority ${demoted.priority})`
        : `Feature "${rs.feature.title}" returned to backlog`,
      messageType: "error",
    });
    broadcast({
      type: "log",
      sessionId: rs.session.id,
      featureId: rs.feature.id,
      message: log.message,
      messageType: "error",
      screenshotPath: log.screenshotPath,
      createdAt: log.createdAt,
      logId: log.id,
    });
  } else {
    // terminated — move feature back to backlog (no priority demotion since
    // the user explicitly stopped).
    finalSessionStatus = "terminated";
    finalFeature =
      updateFeature(rs.feature.id, { status: "backlog" }) ?? finalFeature;
    const log = appendAgentLog({
      sessionId: rs.session.id,
      featureId: rs.feature.id,
      message: `Session stopped — feature "${rs.feature.title}" returned to backlog`,
      messageType: "info",
    });
    broadcast({
      type: "log",
      sessionId: rs.session.id,
      featureId: rs.feature.id,
      message: log.message,
      messageType: "info",
      screenshotPath: log.screenshotPath,
      createdAt: log.createdAt,
      logId: log.id,
    });
  }

  closeAgentSession(rs.session.id, finalSessionStatus);

  broadcast({
    type: "status",
    sessionId: rs.session.id,
    featureId: rs.feature.id,
    sessionStatus: finalSessionStatus,
    featureName: rs.feature.title,
    featureStatus: finalFeature?.status,
  });

  // Feature #101 — celebration screen hook. Whenever a feature transitions
  // to "completed" we check whether the project as a whole is now done and,
  // if so, flip its status + broadcast a one-shot event so the UI can react.
  // The helper is idempotent so it is safe to call from every successful
  // finalize (it returns null when nothing changed).
  //
  // Feature #70 — auto-continue loop. If the project is NOT fully done but
  // has another ready feature in the backlog, spawn the next coding session
  // automatically so the user doesn't have to click Start between features.
  if (outcome === "success") {
    let projectIsDone = false;
    try {
      const completedProject = markProjectCompletedIfAllDone(
        rs.session.projectId,
      );
      if (completedProject) {
        projectIsDone = true;
        broadcast({
          type: "project_completed",
          sessionId: rs.session.id,
          projectId: completedProject.id,
        });
      }
    } catch (err) {
      // Completion detection is best-effort — never let it break the session
      // finalize path. Log and move on.
      // eslint-disable-next-line no-console
      console.error("[localforge] project completion check failed:", err);
    }

    if (!projectIsDone) {
      maybeContinueWithNextFeature(rs);
    }
  }
}

/**
 * Feature #70 — "orchestrator continues to next feature after completion".
 *
 * After a successful finalize we check whether another backlog feature is
 * ready and, if so, spawn a fresh session for it. Wrapped in `setImmediate`
 * so we unwind the current call stack (releasing the `getState().running`
 * slot we just deleted) before the new `startOrchestrator` runs.
 *
 * Errors are swallowed + logged — any failure leaves the kanban in its
 * current state and the user can click Start again manually.
 */
function maybeContinueWithNextFeature(rs: RunningSession): void {
  const projectId = rs.session.projectId;

  setImmediate(() => {
    try {
      const next = findNextReadyFeatureForProject(projectId);
      if (!next) return;
      // startOrchestrator is idempotent; if something else already spun up a
      // session for this project it returns the existing one.
      startOrchestrator(projectId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        "[localforge] auto-continue to next feature failed:",
        err,
      );
    }
  });
}

/**
 * Testing helper: reset orchestrator state. Only exported for unit tests /
 * dev scripts. Does NOT touch database rows.
 */
export function __resetStateForTests(): void {
  const state = getState();
  state.running.clear();
  state.events.removeAllListeners();
}
