"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useShell } from "./shell-context";

/**
 * Confirmation dialog for deleting a project.
 *
 * Behaviour (Feature #25 "Delete project with confirmation dialog"):
 *   - Clicking the "Delete project" trigger button does NOT delete immediately;
 *     it only opens this modal.
 *   - The modal shows the project name, a warning about the destructive action,
 *     and an optional checkbox to also remove the project's folder from disk
 *     (app_spec <sensitive_operations>).
 *   - Cancel closes the dialog with no side effects -> project remains.
 *   - Confirm calls DELETE /api/projects/:id (?removeFiles=true when checked),
 *     then refreshes the sidebar and navigates back to /.
 *
 * This is a controlled component: the trigger lives inside
 * <ProjectHeaderActions /> and owns the open state.
 */
export type DeleteProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  projectName: string;
};

export function DeleteProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: DeleteProjectDialogProps) {
  const router = useRouter();
  const { refreshProjects } = useShell();
  const [removeFiles, setRemoveFiles] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset transient state whenever the dialog is (re)opened so the user sees
  // a clean slate each time.
  React.useEffect(() => {
    if (open) {
      setRemoveFiles(false);
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const url = `/api/projects/${projectId}${
        removeFiles ? "?removeFiles=true" : ""
      }`;
      const res = await fetch(url, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      // Refresh sidebar project list so the deleted project disappears
      // immediately, then send the user home (the project's own page no
      // longer exists).
      await refreshProjects();
      onOpenChange(false);
      router.push("/");
      // Ensure the router-cache reflects the new server state.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onOpenChange(false);
      }}
      labelledBy="delete-project-title"
    >
      <DialogCloseButton onClick={() => onOpenChange(false)} />
      <DialogHeader>
        <DialogTitle id="delete-project-title">Delete project?</DialogTitle>
        <DialogDescription>
          This action cannot be undone. The project and its features will be
          removed from LocalForge.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div
          data-testid="delete-project-name"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
        >
          <span className="text-muted-foreground">Project:</span>{" "}
          <span className="font-medium text-foreground">{projectName}</span>
        </div>
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={removeFiles}
            onChange={(e) => setRemoveFiles(e.target.checked)}
            disabled={submitting}
            data-testid="delete-project-remove-files"
            className="mt-1 h-4 w-4 cursor-pointer rounded border border-input bg-background"
          />
          <span>
            Also remove the project folder from disk.
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Permanently deletes files in the project&apos;s working directory.
            </span>
          </span>
        </label>
        {error && (
          <p
            role="alert"
            data-testid="delete-project-error"
            className="text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
          data-testid="delete-project-cancel"
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={handleConfirm}
          disabled={submitting}
          data-testid="delete-project-confirm"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Deleting…
            </>
          ) : (
            <>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete project
            </>
          )}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
