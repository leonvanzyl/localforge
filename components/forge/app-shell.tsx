"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/theme/theme-provider";
import { useShell } from "@/components/app-shell/shell-context";
import { TopBar } from "@/components/forge/top-bar";
import { ForgeSidebar } from "@/components/forge/sidebar";
import { ShortcutsModal } from "@/components/forge/modals";
import { HelpModal } from "@/components/forge/help-modal";
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
  const [helpOpen, setHelpOpen] = React.useState(false);

  // Allow any component to open the help modal via a custom event
  React.useEffect(() => {
    const onHelpOpen = () => setHelpOpen(true);
    window.addEventListener("help:open", onHelpOpen);
    return () => window.removeEventListener("help:open", onHelpOpen);
  }, []);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [events, setEvents] = React.useState<ActivityEvent[]>([]);
  const router = useRouter();

  // Close the mobile drawer whenever the viewport grows past the
  // tablet breakpoint so the desktop sidebar isn't stuck in the
  // "open" state (which uses `position: fixed` only on small screens).
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) setMobileMenuOpen(false);
    };
    handler(mq);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Lock body scroll while the mobile drawer is visible so the
  // page underneath doesn't scroll behind it.
  React.useEffect(() => {
    if (!mobileMenuOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [mobileMenuOpen]);

  const { toggleTheme } = useTheme();
  const { openNewProjectDialog, projects } = useShell();
  const { activeProject, isRunning, requestRefresh } = useActiveProject();

  const getActiveProjectId = React.useCallback(() => {
    if (activeProject) return activeProject.id;
    const match = window.location.pathname.match(/^\/projects\/(\d+)(?:\/|$)/);
    return match ? Number.parseInt(match[1], 10) : null;
  }, [activeProject]);

  // ENH-006: surface the effective model/provider on the top bar so the
  // user can see at a glance which model the orchestrator will actually
  // use when they click run queue. This matters because settings have a
  // global default + a per-project override, and confusion about which
  // is active is a real source of mistakes (especially when retrying
  // after switching models). Re-fetched whenever the active project
  // changes, the project-settings dialog dispatches a settings-changed
  // event, or another part of the app bumps `refreshTick` (which the
  // run-queue / pause-all buttons already do, so the badge stays fresh
  // across settings changes).
  React.useEffect(() => {
    const onSettingsChanged = () => {
      requestRefresh();
    };
    window.addEventListener("localforge:settings-changed", onSettingsChanged);
    return () => {
      window.removeEventListener(
        "localforge:settings-changed",
        onSettingsChanged,
      );
    };
  }, [requestRefresh]);
  //
  // We store the fetched value keyed by projectId so a stale fetch from a
  // previous project never bleeds into a new one. The derived
  // `effectiveModel` returns null whenever the stored value's id doesn't
  // match the current active project, avoiding any setState-inside-effect
  // pattern (linted out by react-hooks/set-state-in-effect).
  const [fetchedModel, setFetchedModel] = React.useState<{
    projectId: number;
    model: string;
    provider: string;
  } | null>(null);
  const refreshTick = useActiveProject().refreshTick;
  React.useEffect(() => {
    if (!activeProject) return;
    let cancelled = false;
    const pid = activeProject.id;
    fetch(`/api/projects/${pid}/settings`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { effective?: { model: string; provider: string } } | null) => {
        if (cancelled || !data?.effective) return;
        setFetchedModel({
          projectId: pid,
          model: data.effective.model,
          provider: data.effective.provider,
        });
      })
      .catch(() => {
        /* ignore — we just won't show the badge */
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject, refreshTick]);
  const effectiveModel =
    activeProject && fetchedModel?.projectId === activeProject.id
      ? { model: fetchedModel.model, provider: fetchedModel.provider }
      : null;

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

  // Keyboard shortcuts
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
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
        setMobileMenuOpen(false);
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

      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (isRunning) {
          handlePauseAll();
        } else {
          handleStartAll();
        }
        return;
      }

      const digit = parseInt(e.key, 10);
      if (
        digit >= 1 &&
        digit <= 9 &&
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey
      ) {
        const list = projects ?? [];
        const target = list[digit - 1];
        if (target) {
          e.preventDefault();
          router.push(`/projects/${target.id}`);
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleTheme, openNewProjectDialog, isRunning, projects, router, handleStartAll, handlePauseAll]);

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
        activeModel={effectiveModel}
        isRunning={isRunning}
        onStartAll={handleStartAll}
        onPauseAll={handlePauseAll}
        onToggleDrawer={() => setDrawerOpen((v) => !v)}
        onToggleShortcuts={() => setShortcutsOpen((v) => !v)}
        onToggleHelp={() => setHelpOpen((v) => !v)}
        onToggleMobileMenu={() => setMobileMenuOpen((v) => !v)}
        drawerOpen={drawerOpen}
      />

      <div className="lf-main">
        <ForgeSidebar
          mobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
        />
        {/* Backdrop behind the mobile sidebar drawer. Click anywhere on
            it to dismiss. CSS hides it on desktop. */}
        <div
          className={"lf-mobile-backdrop" + (mobileMenuOpen ? " open" : "")}
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
          data-testid="mobile-menu-backdrop"
        />
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
      <HelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
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
