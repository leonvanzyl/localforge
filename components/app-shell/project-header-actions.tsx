"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DeleteProjectDialog } from "./delete-project-dialog";

/**
 * Client-side action bar rendered inside the project page header
 * (app/projects/[id]/page.tsx).
 *
 * Currently houses the destructive "Delete project" trigger that opens a
 * confirmation dialog. Future actions (Rename, Settings, Export) can be
 * added alongside.
 */
export function ProjectHeaderActions({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <>
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
      <DeleteProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId}
        projectName={projectName}
      />
    </>
  );
}
