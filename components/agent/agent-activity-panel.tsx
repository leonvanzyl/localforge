"use client";

import * as React from "react";
import {
  Camera,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Loader2,
  TerminalSquare,
  XCircle,
} from "lucide-react";

/**
 * Collapsible agent-activity panel (Features #71 + companion UX for #63).
 *
 * Renders the live log stream for the currently-active coding session on a
 * project page. Connects to `/api/agent/stream/:sessionId` via EventSource,
 * displays messages progressively, and auto-scrolls as new lines arrive.
 *
 * Usage:
 *   <AgentActivityPanel projectId={projectId} />
 *
 * On mount the panel does a one-shot GET of
 *   /api/projects/:projectId/orchestrator
 * to discover the active session. When the orchestrator is started the panel
 * re-polls on orchestrator:changed events emitted by the page (or retries
 * periodically if no signal is available).
 */

type LogEvent = {
  type: "log";
  sessionId: number;
  featureId: number | null;
  message: string;
  messageType: "info" | "action" | "error" | "screenshot" | "test_result";
  screenshotPath?: string | null;
  createdAt: string;
  logId: number;
};

type StatusEvent = {
  type: "status";
  sessionId: number;
  featureId: number | null;
  sessionStatus: "in_progress" | "completed" | "failed" | "terminated";
  featureName?: string;
  featureStatus?: "backlog" | "in_progress" | "completed";
};

type ActiveSession = {
  id: number;
  projectId: number;
  featureId: number | null;
  status: "in_progress" | "completed" | "failed" | "terminated";
  startedAt: string;
  endedAt: string | null;
};

function badgeClass(
  mt: LogEvent["messageType"],
): { label: string; className: string } {
  switch (mt) {
    case "action":
      return {
        label: "action",
        className:
          "border border-blue-500/40 bg-blue-500/10 text-blue-400",
      };
    case "error":
      return {
        label: "error",
        className:
          "border border-destructive/40 bg-destructive/10 text-destructive",
      };
    case "screenshot":
      return {
        label: "screenshot",
        className:
          "border border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-400",
      };
    case "test_result":
      return {
        label: "tests",
        className:
          "border border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
      };
    case "info":
    default:
      return {
        label: "info",
        className:
          "border border-border bg-muted text-muted-foreground",
      };
  }
}

/**
 * localStorage key used to persist the collapsed/expanded state of the agent
 * activity panel across reloads (Feature #72). Stored value is "0" (collapsed)
 * or "1" (expanded); missing/invalid values default to expanded.
 */
const ACTIVITY_PANEL_OPEN_KEY = "localforge.agentActivity.open";

function readPersistedOpen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(ACTIVITY_PANEL_OPEN_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    // localStorage can throw in private-mode Safari and sandboxed iframes.
    // Fall back to the default expanded state in that case.
  }
  return true;
}

function writePersistedOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVITY_PANEL_OPEN_KEY, open ? "1" : "0");
  } catch {
    // Ignore write failures; the panel still works in-memory.
  }
}

export function AgentActivityPanel({ projectId }: { projectId: number }) {
  const [session, setSession] = React.useState<ActiveSession | null>(null);
  const [logs, setLogs] = React.useState<LogEvent[]>([]);
  const [statusText, setStatusText] = React.useState<
    "idle" | "connecting" | "streaming" | "completed" | "failed" | "terminated"
  >("idle");
  // Feature #72: the collapsed/expanded state is persisted to localStorage so
  // a user who prefers a minimal layout doesn't have to re-collapse the panel
  // on every page load. Default to expanded on first visit.
  //
  // We initialise from a lazy initializer so SSR + hydration render the
  // expanded default (matches the server-rendered DOM) and then an effect
  // below syncs the persisted value once the client hydrates.
  const [open, setOpen] = React.useState<boolean>(true);
  const [hydrated, setHydrated] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setOpen(readPersistedOpen());
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    writePersistedOpen(open);
  }, [open, hydrated]);

  // Fetch / poll the active session for this project. Polling every 2s is a
  // trivial fallback; the UI also explicitly re-fetches when the user clicks
  // the Start/Stop button via the window orchestrator:changed event.
  React.useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/orchestrator`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          session: ActiveSession | null;
          running: boolean;
        };
        if (cancelled) return;
        setSession((prev) => {
          if (data.session?.id === prev?.id) return prev;
          return data.session;
        });
      } catch {
        // ignore transient failures
      }
    }
    void refresh();

    const onChanged = () => {
      void refresh();
    };
    window.addEventListener("orchestrator:changed", onChanged);

    const pollId = window.setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      window.removeEventListener("orchestrator:changed", onChanged);
      window.clearInterval(pollId);
    };
  }, [projectId]);

  // Whenever the session changes, tear down any prior stream and open a new
  // EventSource against /api/agent/stream/:sessionId.
  React.useEffect(() => {
    if (!session) {
      setLogs([]);
      setStatusText("idle");
      return;
    }
    setLogs([]);
    setStatusText("connecting");

    const es = new EventSource(`/api/agent/stream/${session.id}`);

    es.addEventListener("log", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as LogEvent;
        setLogs((prev) => [...prev, data]);
        setStatusText("streaming");
      } catch {
        /* ignore malformed event */
      }
    });

    es.addEventListener("status", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as StatusEvent;
        if (
          data.sessionStatus === "completed" ||
          data.sessionStatus === "failed" ||
          data.sessionStatus === "terminated"
        ) {
          setStatusText(data.sessionStatus);
          // Let the orchestrator poll catch up and swap the session state.
          window.dispatchEvent(new CustomEvent("orchestrator:changed"));
        } else {
          setStatusText("streaming");
        }
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("replay-complete", () => {
      setStatusText("streaming");
    });

    es.addEventListener("error", () => {
      // EventSource reconnects automatically; we just surface the state.
      setStatusText((s) =>
        s === "completed" || s === "failed" || s === "terminated" ? s : "connecting",
      );
    });

    return () => {
      es.close();
    };
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom whenever logs arrive.
  React.useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, open]);

  const active =
    session &&
    session.status === "in_progress" &&
    (statusText === "connecting" || statusText === "streaming");

  // If there is no session at all, don't render the panel to avoid eating
  // layout space on idle projects.
  if (!session) return null;

  return (
    <section
      data-testid="agent-activity-panel"
      data-session-id={session.id}
      data-active={active ? "true" : "false"}
      data-status={statusText}
      data-open={open ? "true" : "false"}
      className="flex flex-col border-t border-border bg-card/40"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`agent-activity-body-${session.id}`}
        className="flex items-center justify-between gap-3 px-6 py-2 text-left hover:bg-muted/40"
        data-testid="agent-activity-toggle"
      >
        <div className="flex items-center gap-2 text-sm">
          <TerminalSquare className="h-4 w-4 text-primary" aria-hidden="true" />
          <span className="font-medium text-foreground">Agent activity</span>
          <StatusPill status={statusText} />
          {session.featureId && (
            <span className="text-xs text-muted-foreground">
              feature #{session.featureId}
            </span>
          )}
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div
          id={`agent-activity-body-${session.id}`}
          ref={scrollRef}
          data-testid="agent-activity-log"
          className="max-h-48 overflow-y-auto border-t border-border bg-background/60 px-6 py-3 font-mono text-xs text-foreground"
        >
          {logs.length === 0 ? (
            <p className="text-muted-foreground">Waiting for agent output…</p>
          ) : (
            <ul className="space-y-1">
              {logs.map((log) => (
                <li
                  key={log.logId}
                  data-testid="agent-activity-line"
                  data-message-type={log.messageType}
                  className="flex gap-2"
                >
                  <MessageTypeIcon type={log.messageType} />
                  <span
                    className={`shrink-0 rounded px-1.5 py-px text-[10px] uppercase tracking-wider ${badgeClass(log.messageType).className}`}
                  >
                    {badgeClass(log.messageType).label}
                  </span>
                  <span className="whitespace-pre-wrap break-words">
                    {log.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function MessageTypeIcon({
  type,
}: {
  type: LogEvent["messageType"];
}) {
  const iconProps = { className: "mt-0.5 h-3.5 w-3.5 shrink-0", "aria-hidden": true };
  if (type === "error") return <XCircle {...iconProps} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />;
  if (type === "screenshot") return <Camera {...iconProps} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fuchsia-400" />;
  if (type === "test_result") return <CheckCircle2 {...iconProps} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />;
  return <Loader2 {...iconProps} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

function StatusPill({
  status,
}: {
  status:
    | "idle"
    | "connecting"
    | "streaming"
    | "completed"
    | "failed"
    | "terminated";
}) {
  const map: Record<typeof status, { label: string; className: string }> = {
    idle: {
      label: "idle",
      className: "border border-border bg-muted text-muted-foreground",
    },
    connecting: {
      label: "connecting",
      className: "border border-sky-500/40 bg-sky-500/10 text-sky-400",
    },
    streaming: {
      label: "live",
      className: "border border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    },
    completed: {
      label: "completed",
      className: "border border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    },
    failed: {
      label: "failed",
      className:
        "border border-destructive/40 bg-destructive/10 text-destructive",
    },
    terminated: {
      label: "stopped",
      className: "border border-border bg-muted text-muted-foreground",
    },
  };
  const { label, className } = map[status];
  return (
    <span
      data-testid="agent-activity-status"
      className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${className}`}
    >
      {label}
    </span>
  );
}

