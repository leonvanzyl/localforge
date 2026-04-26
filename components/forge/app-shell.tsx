"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/theme/theme-provider";
import { useShell } from "@/components/app-shell/shell-context";
import { TopBar } from "@/components/forge/top-bar";
import { ForgeSidebar } from "@/components/forge/sidebar";
import { ShortcutsModal } from "@/components/forge/modals";
import { ActivityDrawer, type ActivityEvent } from "@/components/forge/activity-drawer";
import { NewProjectDialog } from "@/components/app-shell/new-project-dialog";
import { AgentNotifications } from "@/components/agent/agent-notifications";
import {
  ProjectProvider,
  useActiveProject,
} from "@/components/forge/project-context";

/**
 * Inner shell that has access to both the ShellProvider and ProjectProvider
 * contexts. This is where the TopBar reads the active project and wires up
 * keyboard shortcuts.
 */
function ForgeShellInner({ children }: { children: React.ReactNode }) {
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [events, setEvents] = React.useState<ActivityEvent[]>([]);
  const router = useRouter();

  const { toggleTheme } = useTheme();
  const { openNewProjectDialog } = useShell();
  const { activeProject, isRunning, requestRefresh } = useActiveProject();

  const getActiveProjectId = React.useCallback(() => {
    if (activeProject) return activeProject.id;
    const match = window.location.pathname.match(/^\/projects\/(\d+)(?:\/|$)/);
    return match ? Number.parseInt(match[1], 10) : null;
  }, [activeProject]);

  // SSE subscription for activity events
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
            createdAt: string;
          };
          const ev: ActivityEvent = {
            id: `log-${data.sessionId}-${Date.now()}-${Math.random()}`,
            kind: data.messageType === "error" ? "err" : "run",
            who: `Agent #${data.sessionId}`,
            text: data.message.slice(0, 120),
            when: new Date(data.createdAt).toLocaleTimeString(),
          };
          setEvents((prev) => [ev, ...prev].slice(0, 50));
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("status", (e) => {
        try {
          const data = JSON.parse(e.data) as {
            sessionId: number;
            sessionStatus: string;
            featureName?: string;
            featureStatus?: string;
          };
          const isGood =
            data.sessionStatus === "completed" ||
            data.featureStatus === "completed";
          const isWarn = data.sessionStatus === "failed";
          const ev: ActivityEvent = {
            id: `status-${data.sessionId}-${Date.now()}`,
            kind: isGood ? "good" : isWarn ? "warn" : "run",
            who: `Agent #${data.sessionId}`,
            text: data.featureName
              ? `${data.featureStatus ?? data.sessionStatus}: ${data.featureName}`
              : `session ${data.sessionStatus}`,
            when: new Date().toLocaleTimeString(),
          };
          setEvents((prev) => [ev, ...prev].slice(0, 50));
        } catch {
          /* ignore */
        }
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
  }, []);

  // Keyboard shortcuts
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }

      if (e.key === "Escape") {
        setShortcutsOpen(false);
        setDrawerOpen(false);
        return;
      }

      if (e.key === "\\" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setDrawerOpen((v) => !v);
        return;
      }

      if (
        e.key === "d" &&
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        toggleTheme();
        return;
      }

      if (
        e.key === "n" &&
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        openNewProjectDialog();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleTheme, openNewProjectDialog]);

  // Start/pause all handlers — these POST to the active project's orchestrator
  // and then bump the shared refresh tick so project-view re-fetches slot
  // state immediately instead of waiting for the 5s poll tick. Without this
  // nudge the UI feels unresponsive after "run queue" and users may
  // double-click, racing another start_all against the first.
  const handleStartAll = React.useCallback(() => {
    const projectId = getActiveProjectId();
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/orchestrator`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start_all" }),
    })
      .then(() => {
        requestRefresh();
        router.refresh();
      })
      .catch(() => {
        /* ignore */
      });
  }, [getActiveProjectId, requestRefresh, router]);

  const handlePauseAll = React.useCallback(() => {
    const projectId = getActiveProjectId();
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/orchestrator`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop_all" }),
    })
      .then(() => {
        requestRefresh();
        router.refresh();
      })
      .catch(() => {
        /* ignore */
      });
  }, [getActiveProjectId, requestRefresh, router]);

  return (
    <div
      className="app"
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <TopBar
        activeProject={activeProject}
        isRunning={isRunning}
        onStartAll={handleStartAll}
        onPauseAll={handlePauseAll}
        onToggleDrawer={() => setDrawerOpen((v) => !v)}
        onToggleShortcuts={() => setShortcutsOpen((v) => !v)}
        drawerOpen={drawerOpen}
      />

      <div className="lf-main">
        <ForgeSidebar />
        <main className="lf-content">{children}</main>
        <ActivityDrawer
          open={drawerOpen}
          events={events}
          onClose={() => setDrawerOpen(false)}
        />
      </div>

      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
      <NewProjectDialog />
      <AgentNotifications />
    </div>
  );
}

/**
 * Top-level application chrome for the LocalForge redesign.
 *
 * Composes: TopBar, ForgeSidebar, main content area, ActivityDrawer,
 * ShortcutsModal, NewProjectDialog, and AgentNotifications.
 *
 * Wrapped in a ProjectProvider so child routes (especially the project
 * page) can set the active project and running state.
 */
export function ForgeAppShell({ children }: { children: React.ReactNode }) {
  return (
    <ProjectProvider>
      <ForgeShellInner>{children}</ForgeShellInner>
    </ProjectProvider>
  );
}
