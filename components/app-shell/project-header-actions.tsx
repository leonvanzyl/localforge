"use client";

import * as React from "react";
import { Activity, Cog, Play, StopCircle, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { ProjectSettingsDialog } from "./project-settings-dialog";

/**
 * Client-side action bar rendered inside the project page header
 * (app/projects/[id]/page.tsx).
 *
 * Houses:
 *   - the prominent "Start Orchestrator" CTA (Feature #62)
 *   - a matching "Stop" button and "Agent active" indicator shown while a
 *     coding agent session is running (Features #63 + force-stop coverage)
 *   - the destructive "Delete project" trigger
 *   - the per-project Settings dialog trigger
 *
 * Polls `/api/projects/:id/orchestrator` every 2s for active-session status
 * and also listens for the `orchestrator:changed` window event so Start/Stop
 * clicks reflect immediately.
 */
type OrchestratorStatus = {
  session: {
    id: number;
    status: "in_progress" | "completed" | "failed" | "terminated";
    featureId: number | null;
  } | null;
  running: boolean;
  feature?: { id: number; title: string; status: string } | null;
};

export function ProjectHeaderActions({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<OrchestratorStatus>({
    session: null,
    running: false,
  });

  // Keep a ref to the last status so we can diff without making setStatus a
  // side-effecting reducer (dispatching DOM events inside an updater fn
  // triggers React's "setState while rendering another component" warning).
  const lastStatusRef = React.useRef<OrchestratorStatus>({
    session: null,
    running: false,
  });

  const refreshStatus = React.useCallback(async () => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/orchestrator`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as OrchestratorStatus;
      const prev = lastStatusRef.current;
      const changed =
        prev.session?.id !== data.session?.id ||
        prev.running !== data.running ||
        prev.session?.status !== data.session?.status;
      lastStatusRef.current = data;
      setStatus(data);
      if (changed) {
        // Ask the kanban board to re-fetch so cards jump between columns
        // without waiting on its own poll cycle. Dispatching outside of
        // setState keeps React happy during concurrent renders.
        window.dispatchEvent(new CustomEvent("kanban:refresh"));
      }
    } catch {
      /* ignore polling failures */
    }
  }, [projectId]);

  React.useEffect(() => {
    void refreshStatus();
    const onChanged = () => {
      void refreshStatus();
    };
    window.addEventListener("orchestrator:changed", onChanged);
    const pollId = window.setInterval(refreshStatus, 2000);
    return () => {
      window.removeEventListener("orchestrator:changed", onChanged);
      window.clearInterval(pollId);
    };
  }, [refreshStatus]);

  async function handleStart() {
    setStarting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/orchestrator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Failed to start (${res.status})`);
      }
      window.dispatchEvent(new CustomEvent("orchestrator:changed"));
      window.dispatchEvent(new CustomEvent("kanban:refresh"));
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to start orchestrator",
      );
    } finally {
      setStarting(false);
    }
  }

  async function handleStop() {
    setStopping(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/orchestrator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Failed to stop (${res.status})`);
      }
      window.dispatchEvent(new CustomEvent("orchestrator:changed"));
      window.dispatchEvent(new CustomEvent("kanban:refresh"));
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to stop orchestrator",
      );
    } finally {
      setStopping(false);
    }
  }

  const isActive =
    status.running && status.session?.status === "in_progress";

  return (
    <>
      {isActive && (
        <span
          role="status"
          data-testid="agent-active-indicator"
          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
          </span>
          <Activity className="h-3 w-3" aria-hidden="true" />
          Agent active
        </span>
      )}

      {isActive ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleStop}
          disabled={stopping}
          data-testid="project-stop-orchestrator"
          aria-label={`Stop orchestrator for ${projectName}`}
          className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <StopCircle className="h-4 w-4" aria-hidden="true" />
          {stopping ? "Stopping…" : "Stop"}
        </Button>
      ) : (
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={handleStart}
          disabled={starting}
          data-testid="project-start-orchestrator"
          aria-label={`Start orchestrator for ${projectName}`}
          className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
        >
          <Play className="h-4 w-4" aria-hidden="true" />
          {starting ? "Starting…" : "Start Orchestrator"}
        </Button>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setSettingsOpen(true)}
        data-testid="project-settings-button"
        aria-label={`Open settings for ${projectName}`}
        className="gap-1.5"
      >
        <Cog className="h-4 w-4" aria-hidden="true" />
        Settings
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setDialogOpen(true)}
        data-testid="project-delete-button"
        aria-label={`Delete project ${projectName}`}
        className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Delete
      </Button>
      {actionError && (
        <span
          role="alert"
          data-testid="project-start-error"
          className="text-xs text-destructive"
        >
          {actionError}
        </span>
      )}
      <DeleteProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId}
        projectName={projectName}
      />
      <ProjectSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        projectId={projectId}
        projectName={projectName}
      />
    </>
  );
}
