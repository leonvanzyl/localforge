"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
 * Modal for creating a new project.
 *
 * Wired to POST /api/projects, which creates the SQLite row AND the
 * project folder on disk with a generated .claude/settings.json. On
 * success we navigate into the new project's kanban board.
 */
export function NewProjectDialog() {
  const { isNewProjectDialogOpen, closeNewProjectDialog, refreshProjects } =
    useShell();
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reset state whenever the dialog is reopened.
  React.useEffect(() => {
    if (isNewProjectDialogOpen) {
      setName("");
      setError(null);
      setSubmitting(false);
      // focus input on next tick so it is mounted
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [isNewProjectDialogOpen]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Project name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        project?: { id: number; name: string };
        error?: string;
      };
      if (!res.ok || !data.project) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      await refreshProjects();
      closeNewProjectDialog();
      router.push(`/projects/${data.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={isNewProjectDialogOpen}
      onOpenChange={(open) => {
        if (!open) closeNewProjectDialog();
      }}
      labelledBy="new-project-title"
    >
      <DialogCloseButton onClick={closeNewProjectDialog} />
      <form onSubmit={handleSubmit} data-testid="new-project-form">
        <DialogHeader>
          <DialogTitle id="new-project-title">Create new project</DialogTitle>
          <DialogDescription>
            Give your project a name. LocalForge will create a folder on disk
            and generate an .claude/settings.json for agent sessions.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="new-project-name"
              className="text-sm font-medium text-foreground"
            >
              Project name
            </label>
            <Input
              id="new-project-name"
              ref={inputRef}
              data-testid="new-project-name-input"
              name="name"
              placeholder="e.g. my-todo-app"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              disabled={submitting}
              required
              autoComplete="off"
              maxLength={120}
            />
          </div>
          {error && (
            <p
              role="alert"
              data-testid="new-project-error"
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
            onClick={closeNewProjectDialog}
            disabled={submitting}
            data-testid="new-project-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting || name.trim().length === 0}
            data-testid="new-project-submit"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Creating…
              </>
            ) : (
              "Create project"
            )}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
