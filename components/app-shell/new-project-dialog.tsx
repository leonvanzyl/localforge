"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, FolderPlus } from "lucide-react";

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
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";

/**
 * Modal for creating a new project.
 *
 * Wired to POST /api/projects, which creates the SQLite row AND the
 * project folder on disk with a generated .claude/settings.json.
 *
 * Users pick one of two creation modes:
 *   - "Start blank"           → the kanban board opens empty.
 *   - "Describe your project" → after creation we POST
 *                               /api/projects/:id/bootstrapper-session
 *                               to create an agent_session row
 *                               (session_type='bootstrapper',
 *                               status='in_progress'). The project page
 *                               detects the active session and mounts the
 *                               bootstrapper chat panel (Feature #55).
 */

type CreateMode = "blank" | "ai";

export function NewProjectDialog() {
  const { isNewProjectDialogOpen, closeNewProjectDialog, refreshProjects } =
    useShell();
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [mode, setMode] = React.useState<CreateMode>("blank");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reset state whenever the dialog is reopened.
  React.useEffect(() => {
    if (isNewProjectDialogOpen) {
      setName("");
      setMode("blank");
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

      // When the user chose the AI bootstrapper, kick off a session so the
      // project page can render the chat interface immediately on load.
      if (mode === "ai") {
        try {
          const sessRes = await fetch(
            `/api/projects/${data.project.id}/bootstrapper-session`,
            { method: "POST" },
          );
          if (!sessRes.ok) {
            // Non-fatal: still navigate to the project so the user isn't
            // stuck. The project page can offer a retry if needed.
            // eslint-disable-next-line no-console
            console.error(
              "[localforge] failed to start bootstrapper session:",
              sessRes.status,
            );
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[localforge] bootstrapper session error:", err);
        }
      }

      await refreshProjects();
      closeNewProjectDialog();
      router.push(`/projects/${data.project.id}`);
      router.refresh();
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

          <fieldset
            className="space-y-2"
            data-testid="new-project-mode-fieldset"
          >
            <legend className="text-sm font-medium text-foreground">
              How do you want to start?
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ModeCard
                value="blank"
                selected={mode === "blank"}
                onSelect={setMode}
                disabled={submitting}
                icon={<FolderPlus className="h-4 w-4" aria-hidden="true" />}
                title="Start blank"
                description="Open an empty kanban board and add features manually."
                testId="new-project-mode-blank"
              />
              <ModeCard
                value="ai"
                selected={mode === "ai"}
                onSelect={setMode}
                disabled={submitting}
                icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
                title="Describe your project to AI"
                description="Chat with the bootstrapper to generate features."
                testId="new-project-mode-ai"
              />
            </div>
          </fieldset>

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
            ) : mode === "ai" ? (
              "Create & chat with AI"
            ) : (
              "Create project"
            )}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function ModeCard({
  value,
  selected,
  onSelect,
  disabled,
  icon,
  title,
  description,
  testId,
}: {
  value: CreateMode;
  selected: boolean;
  onSelect: (v: CreateMode) => void;
  disabled: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={testId}
      data-selected={selected ? "true" : "false"}
      onClick={() => onSelect(value)}
      disabled={disabled}
      className={cn(
        "flex h-full flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary bg-primary/10 text-foreground"
          : "border-input bg-background text-foreground hover:bg-accent",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}
