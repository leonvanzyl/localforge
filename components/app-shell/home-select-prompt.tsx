"use client";

import { FolderKanban, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useShell } from "./shell-context";

/**
 * Landing screen at `/` when at least one project exists but none is
 * currently selected. Nudges the user to either pick from the sidebar or
 * create another project. We intentionally do NOT render the kanban here
 * - the kanban is per-project and lives under /projects/[id].
 */
export function HomeSelectPrompt({ projectCount }: { projectCount: number }) {
  const { openNewProjectDialog } = useShell();
  return (
    <section
      data-testid="home-select-prompt"
      className="flex flex-1 items-center justify-center p-8"
    >
      <div className="mx-auto w-full max-w-xl text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <FolderKanban className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
          Pick a project
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You have {projectCount} project{projectCount === 1 ? "" : "s"}.
          Select one from the sidebar to open its kanban board, or start a new
          one.
        </p>
        <div className="mt-6 flex justify-center">
          <Button onClick={openNewProjectDialog} data-testid="home-new-project">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New project
          </Button>
        </div>
      </div>
    </section>
  );
}
