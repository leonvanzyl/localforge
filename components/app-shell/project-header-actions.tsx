"use client";

import * as React from "react";
import { Cog, Play, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { ProjectSettingsDialog } from "./project-settings-dialog";

/**
 * Client-side action bar rendered inside the project page header
 * (app/projects/[id]/page.tsx).
 *
 * Houses the prominent "Start Orchestrator" CTA (Feature #62) along with
 * the destructive "Delete project" trigger. The Start button uses the
 * primary variant so it stands out as the dominant call-to-action when a
 * project is loaded.
 */
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
  const [startError, setStartError] = React.useState<string | null>(null);

  async function handleStart() {
    setStarting(true);
    setStartError(null);
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
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : "Failed to start orchestrator",
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
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
      {startError && (
        <span
          role="alert"
          data-testid="project-start-error"
          className="text-xs text-destructive"
        >
          {startError}
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
