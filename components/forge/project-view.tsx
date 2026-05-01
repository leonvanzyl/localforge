"use client";

import React from "react";
import { useActiveProject } from "@/components/forge/project-context";
import {
  AgentPods,
  type AgentPodData,
  type LogLine,
} from "@/components/forge/agent-pods";
import { AgentLogModal } from "@/components/forge/modals";
import { ForgeKanban } from "@/components/forge/forge-kanban";
import { SettingsIcon, PlayIcon } from "@/components/forge/icons";
import { ExternalLink, Square } from "lucide-react";
import { ProjectSettingsDialog } from "@/components/app-shell/project-settings-dialog";
import { pickAgentName } from "@/components/forge/agent-names";

type ProjectViewProps = {
  project: {
    id: number;
    name: string;
    description?: string | null;
    folderPath: string;
    status: string;
  };
};

type OrchestratorSlot = {
  slotIndex: number;
  running: boolean;
  sessionId?: number;
  featureId?: number;
  featureTitle?: string;
};

type OrchestratorGetResponse = {
  slots?: OrchestratorSlot[];
  runningCount?: number;
  maxConcurrentAgents?: number;
  session?: { id: number } | null;
  running?: boolean;
  feature?: { id: number; name: string } | null;
};

const DEFAULT_MAX_AGENTS = 1;

type FeatureCountsResponse = {
  features?: Array<{ status: string }>;
};

function makeEmptySlots(count: number): AgentPodData[] {
  return Array.from({ length: count }, (_, i) => ({
    slotIndex: i,
    running: false,
    logs: [],
    progress: 0,
    mood: "idle",
  }));
}

export function ProjectView({ project }: ProjectViewProps) {
  const { setActiveProject, setIsRunning, setRunningCount, refreshTick } =
    useActiveProject();

  const [maxConcurrentAgents, setMaxConcurrentAgents] =
    React.useState<number>(DEFAULT_MAX_AGENTS);
  const [agentSlots, setAgentSlots] = React.useState<AgentPodData[]>(() =>
    makeEmptySlots(DEFAULT_MAX_AGENTS),
  );
  const [backlogCount, setBacklogCount] = React.useState(0);
  const [inProgressCount, setInProgressCount] = React.useState(0);
  const [completedCount, setCompletedCount] = React.useState(0);
  const [runningAgents, setRunningAgents] = React.useState(0);
  // Track the expanded pod by slotIndex so the modal re-renders from the
  // live `agentSlots` on every poll/SSE tick. Storing a snapshot of the pod
  // object here would freeze logs + running state at expand-time.
  const [expandedSlotIndex, setExpandedSlotIndex] = React.useState<number | null>(
    null,
  );
  const [logModalOpen, setLogModalOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [devServerRunning, setDevServerRunning] = React.useState(false);
  const [devServerPort, setDevServerPort] = React.useState<string | null>(null);
  const [devServerStarting, setDevServerStarting] = React.useState(false);

  // Stable refs for context setters so they don't cause effect re-runs
  const setIsRunningRef = React.useRef(setIsRunning);
  const setRunningCountRef = React.useRef(setRunningCount);
  React.useEffect(() => {
    setIsRunningRef.current = setIsRunning;
    setRunningCountRef.current = setRunningCount;
  });

  // Set active project in context on mount
  React.useEffect(() => {
    setActiveProject({
      id: project.id,
      name: project.name,
      folderPath: project.folderPath,
      status: project.status,
    });
    return () => {
      setActiveProject(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const projectId = project.id;

  // Poll dev server status
  React.useEffect(() => {
    let cancelled = false;
    async function checkDevServer() {
      try {
        const res = await fetch(`/api/projects/${projectId}/dev-server`);
        const data = await res.json();
        if (!cancelled) {
          setDevServerRunning(!!data.running);
          setDevServerPort(data.port ?? null);
        }
      } catch {
        if (!cancelled) setDevServerRunning(false);
      }
    }
    checkDevServer();
    const interval = setInterval(checkDevServer, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  async function handleStartDevServer() {
    setDevServerStarting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/dev-server`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.running) {
        setDevServerRunning(true);
        setDevServerPort(data.port);
      }
    } catch {
      // ignore
    } finally {
      setDevServerStarting(false);
    }
  }

  async function handleStopDevServer() {
    try {
      await fetch(`/api/projects/${projectId}/dev-server`, {
        method: "DELETE",
      });
      setDevServerRunning(false);
      setDevServerPort(null);
    } catch {
      // ignore
    }
  }

  function handleOpenDevServer() {
    if (devServerPort) {
      window.open(`http://localhost:${devServerPort}`, "_blank");
    }
  }

  // Fetch feature counts
  const fetchFeatureCounts = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/features`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as FeatureCountsResponse;
      const feats = data.features ?? [];
      let backlog = 0;
      let inProg = 0;
      let done = 0;
      for (const f of feats) {
        if (f.status === "completed") done++;
        else if (f.status === "in_progress") inProg++;
        else backlog++;
      }
      setBacklogCount(backlog);
      setInProgressCount(inProg);
      setCompletedCount(done);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  // Poll orchestrator for slot data
  const fetchSlots = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/orchestrator`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as OrchestratorGetResponse;

      if (data.slots && Array.isArray(data.slots)) {
        // The server returns exactly as many slot objects as the configured
        // max (or the running count if it exceeds the configured max, so
        // in-flight agents keep a UI slot after a user lowers the setting).
        const serverSlots = data.slots;
        const slotCount = Math.max(
          serverSlots.length,
          data.maxConcurrentAgents ?? DEFAULT_MAX_AGENTS,
        );
        setMaxConcurrentAgents(data.maxConcurrentAgents ?? DEFAULT_MAX_AGENTS);
        setAgentSlots((prev) => {
          // Names already held by slots that still have the same sessionId
          // this tick — used to avoid handing the same name to two
          // concurrent agents when a fresh session needs a name.
          const namesInUse = new Set<string>();
          for (let i = 0; i < slotCount; i++) {
            const slot = serverSlots.find((s) => s.slotIndex === i);
            const prevSlot = prev.find((p) => p.slotIndex === i);
            if (
              slot?.sessionId &&
              prevSlot?.sessionId === slot.sessionId &&
              prevSlot.name
            ) {
              namesInUse.add(prevSlot.name);
            }
          }

          return Array.from({ length: slotCount }, (_, i) => {
            const slot = serverSlots.find((s) => s.slotIndex === i);
            const prevSlot = prev.find((p) => p.slotIndex === i);
            if (slot) {
              // Carry the name forward if this is the same session; pick a
              // fresh one for a brand-new session; drop it when idle.
              let name: string | undefined;
              if (slot.running && slot.sessionId != null) {
                if (
                  prevSlot?.sessionId === slot.sessionId &&
                  prevSlot.name
                ) {
                  name = prevSlot.name;
                } else {
                  name = pickAgentName(namesInUse);
                  namesInUse.add(name);
                }
              }

              return {
                slotIndex: slot.slotIndex,
                running: slot.running,
                sessionId: slot.sessionId,
                featureId: slot.featureId,
                featureTitle: slot.featureTitle,
                logs: prevSlot?.logs ?? [],
                progress: prevSlot?.progress ?? (slot.running ? 10 : 0),
                mood: slot.running
                  ? prevSlot?.running && prevSlot?.mood
                    ? prevSlot.mood
                    : "working"
                  : "idle",
                name,
              };
            }
            return {
              slotIndex: i,
              running: false,
              logs: [],
              progress: 0,
              mood: "idle",
            };
          });
        });

        const count = data.runningCount ?? 0;
        setRunningAgents(count);
        setIsRunningRef.current(count > 0);
        setRunningCountRef.current(count);
      } else {
        const running = !!data.running;
        setRunningAgents(running ? 1 : 0);
        setIsRunningRef.current(running);
        setRunningCountRef.current(running ? 1 : 0);
      }
    } catch {
      /* ignore */
    }
  }, [projectId]);

  // Poll every 5 seconds — stable deps so the interval doesn't churn
  React.useEffect(() => {
    fetchSlots();
    fetchFeatureCounts();

    const interval = setInterval(() => {
      fetchSlots();
      fetchFeatureCounts();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchSlots, fetchFeatureCounts]);

  // On-demand refresh triggered by the top-bar "run queue" / "pause all"
  // buttons. Skip the initial render (refreshTick === 0) since the poll
  // effect above already did a first fetch.
  React.useEffect(() => {
    if (refreshTick === 0) return;
    fetchSlots();
    fetchFeatureCounts();
    window.dispatchEvent(new CustomEvent("kanban:refresh"));
  }, [refreshTick, fetchSlots, fetchFeatureCounts]);

  // SSE for real-time log updates
  React.useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      if (closed) return;
      es = new EventSource("/api/agent/events");

      es.addEventListener("log", (e) => {
        try {
          const data = JSON.parse(e.data) as {
            sessionId: number;
            message: string;
            messageType: string;
          };

          let cls = "";
          if (data.messageType === "error") cls = "red";
          else if (data.messageType === "action") cls = "cmd";
          else if (data.messageType === "test_result") cls = "grn";
          else cls = "dim";

          const line: LogLine = {
            prompt: data.messageType === "action" ? "$" : ">",
            text: data.message.slice(0, 200),
            cls,
          };

          setAgentSlots((prev) => {
            const idx = prev.findIndex((s) => s.sessionId === data.sessionId);
            if (idx < 0) return prev;
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              logs: [...next[idx].logs, line].slice(-50),
            };
            return next;
          });
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("status", () => {
        // Refresh on status changes
        fetchSlots();
        fetchFeatureCounts();
        window.dispatchEvent(new CustomEvent("kanban:refresh"));
      });

      es.onerror = () => {
        es?.close();
        if (!closed) {
          reconnectTimer = setTimeout(connect, 10000);
        }
      };
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [projectId, fetchSlots, fetchFeatureCounts]);

  const handleStartAgent = React.useCallback(
    (_slotIndex: number) => {
      fetch(`/api/projects/${projectId}/orchestrator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      })
        .then(() => setTimeout(fetchSlots, 500))
        .catch(() => {});
    },
    [projectId, fetchSlots],
  );

  const handleStopAgent = React.useCallback(
    (sessionId: number) => {
      fetch(`/api/projects/${projectId}/orchestrator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop", sessionId }),
      })
        .then(() => setTimeout(fetchSlots, 500))
        .catch(() => {});
    },
    [projectId, fetchSlots],
  );

  const handleExpandAgent = React.useCallback(
    (sessionId: number) => {
      const slot = agentSlots.find((s) => s.sessionId === sessionId);
      if (slot) {
        setExpandedSlotIndex(slot.slotIndex);
        setLogModalOpen(true);
      }
    },
    [agentSlots],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
      }}
    >
      {/* Content Header */}
      <div className="content-head">
        <div className="crumbs">
          <div className="sup">you are viewing</div>
          <h1>
            {project.name}{" "}
            <span className="branch-chip">
              {project.status === "completed" ? "completed" : "active"}
            </span>
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="btn icon-btn ghost"
            aria-label={`Open project settings for ${project.name}`}
            data-testid="project-settings-button"
          >
            <SettingsIcon size={16} />
          </button>
          {devServerRunning ? (
            <>
              <button
                type="button"
                onClick={handleOpenDevServer}
                className="btn ghost"
                aria-label="Open dev server in browser"
                title={`Open http://localhost:${devServerPort}`}
                data-testid="open-dev-server-button"
                style={{ fontSize: "0.75rem", gap: 4, padding: "4px 8px" }}
              >
                <ExternalLink size={14} />
                <span>:{devServerPort}</span>
              </button>
              <button
                type="button"
                onClick={handleStopDevServer}
                className="btn icon-btn ghost"
                aria-label="Stop dev server"
                title="Stop dev server"
                data-testid="stop-dev-server-button"
              >
                <Square size={12} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleStartDevServer}
              disabled={devServerStarting}
              className="btn ghost"
              aria-label="Start dev server"
              title="Start dev server"
              data-testid="start-dev-server-button"
              style={{ fontSize: "0.75rem", gap: 4, padding: "4px 8px" }}
            >
              <PlayIcon size={12} />
              <span>{devServerStarting ? "Starting…" : "Dev Server"}</span>
            </button>
          )}
        </div>
        <div className="head-stats">
          <div className="stat">
            <div className="v">{backlogCount}</div>
            <div className="l">backlog</div>
          </div>
          <div className="stat">
            <div className="v">
              <span className="accent-text">{inProgressCount}</span>
            </div>
            <div className="l">in progress</div>
          </div>
          <div className="stat">
            <div className="v">
              <span className="good-text">{completedCount}</span>
            </div>
            <div className="l">done</div>
          </div>
          <div className="stat">
            <div className="v">
              {runningAgents}
              <span
                style={{
                  color: "var(--ink-3)",
                  fontWeight: 400,
                  fontSize: "0.75em",
                }}
              >
                /{maxConcurrentAgents}
              </span>
            </div>
            <div className="l">agents</div>
          </div>
        </div>
      </div>

      {/* Agent Pods */}
      <AgentPods
        projectId={projectId}
        slots={agentSlots}
        maxConcurrentAgents={maxConcurrentAgents}
        onStartAgent={handleStartAgent}
        onStopAgent={handleStopAgent}
        onExpandAgent={handleExpandAgent}
      />

      {/* Kanban Board */}
      <ForgeKanban projectId={projectId} projectName={project.name} />

      {/* Agent Log Expand Modal — derive the live slot from agentSlots every
          render so running state, mood, and logs stay in sync with polling
          / SSE updates while the modal is open. */}
      {(() => {
        const expanded =
          expandedSlotIndex != null
            ? agentSlots.find((s) => s.slotIndex === expandedSlotIndex) ?? null
            : null;
        return (
          <AgentLogModal
            open={logModalOpen}
            onClose={() => {
              setLogModalOpen(false);
              setExpandedSlotIndex(null);
            }}
            agent={
              expanded
                ? {
                    slotIndex: expanded.slotIndex,
                    running: expanded.running,
                    mood: expanded.mood,
                    logs: expanded.logs,
                    name: expanded.name,
                  }
                : null
            }
            featureTitle={expanded?.featureTitle}
          />
        );
      })()}

      {/* Project Settings Dialog */}
      <ProjectSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        projectId={projectId}
        projectName={project.name}
      />
    </div>
  );
}
