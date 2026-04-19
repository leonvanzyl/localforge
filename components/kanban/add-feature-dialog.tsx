"use client";

import * as React from "react";
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

const TITLE_MAX = 200;
const DESC_MAX = 5000;

/**
 * Modal for creating a new feature inside a project's backlog.
 *
 * Validates:
 *   - title required (non-empty after trim)
 *   - title length <= 200 (also enforced by Input.maxLength so the user
 *     cannot type past the limit, but we keep a server-side check too)
 *   - description optional, length <= 5000
 *   - priority optional (form picker defaults to backlog)
 *   - category optional (functional by default)
 *
 * On submit calls POST /api/projects/:projectId/features. The parent
 * handles refetching features after a successful create.
 */
export function AddFeatureDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
  initialStatus = "backlog",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  onCreated?: () => void;
  initialStatus?: "backlog" | "in_progress" | "completed";
}) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = React.useState("");
  const [priority, setPriority] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [titleTouched, setTitleTouched] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reset state when dialog opens.
  React.useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setAcceptanceCriteria("");
      setPriority("");
      setError(null);
      setFieldError(null);
      setTitleTouched(false);
      setSubmitting(false);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  function validate(): string | null {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      return "Title is required";
    }
    if (trimmedTitle.length > TITLE_MAX) {
      return `Title must be ${TITLE_MAX} characters or fewer`;
    }
    if (description.length > DESC_MAX) {
      return `Description must be ${DESC_MAX} characters or fewer`;
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setFieldError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    setFieldError(null);

    const body: Record<string, unknown> = {
      title: title.trim(),
      status: initialStatus,
    };
    if (description.trim()) body.description = description.trim();
    if (acceptanceCriteria.trim()) {
      body.acceptanceCriteria = acceptanceCriteria.trim();
    }
    const parsedPriority = priority.trim() ? Number.parseInt(priority, 10) : NaN;
    if (!Number.isNaN(parsedPriority)) {
      body.priority = parsedPriority;
    }

    try {
      const res = await fetch(`/api/projects/${projectId}/features`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        feature?: { id: number };
        error?: string;
      };
      if (!res.ok || !data.feature) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      onOpenChange(false);
      if (onCreated) onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create feature");
    } finally {
      setSubmitting(false);
    }
  }

  const trimmedTitle = title.trim();
  const submitDisabled = submitting || trimmedTitle.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !submitting) onOpenChange(false);
      }}
      labelledBy="add-feature-title"
    >
      <DialogCloseButton onClick={() => onOpenChange(false)} />
      <form onSubmit={handleSubmit} data-testid="add-feature-form" noValidate>
        <DialogHeader>
          <DialogTitle id="add-feature-title">Add feature</DialogTitle>
          <DialogDescription>
            Features appear in the Backlog column. Add a title and optional
            details — you can edit anything later.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="add-feature-title-input"
              className="text-sm font-medium text-foreground"
            >
              Title <span className="text-destructive">*</span>
            </label>
            <Input
              id="add-feature-title-input"
              ref={inputRef}
              data-testid="add-feature-title-input"
              name="title"
              placeholder="e.g. User can reset their password"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (fieldError) setFieldError(null);
                if (error) setError(null);
              }}
              onBlur={() => setTitleTouched(true)}
              disabled={submitting}
              autoComplete="off"
              maxLength={TITLE_MAX}
              aria-invalid={
                fieldError || (titleTouched && title.trim().length === 0)
                  ? "true"
                  : "false"
              }
              aria-describedby={
                fieldError || (titleTouched && title.trim().length === 0)
                  ? "add-feature-field-error"
                  : undefined
              }
            />
            {(fieldError || (titleTouched && title.trim().length === 0)) && (
              <p
                id="add-feature-field-error"
                role="alert"
                data-testid="add-feature-field-error"
                className="text-xs text-destructive"
              >
                {fieldError ?? "Title is required"}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="add-feature-description"
              className="text-sm font-medium text-foreground"
            >
              Description
            </label>
            <textarea
              id="add-feature-description"
              data-testid="add-feature-description"
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
              placeholder="What is this feature? Why does it matter?"
              maxLength={DESC_MAX}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="add-feature-acceptance"
              className="text-sm font-medium text-foreground"
            >
              Acceptance criteria
            </label>
            <textarea
              id="add-feature-acceptance"
              data-testid="add-feature-acceptance"
              name="acceptanceCriteria"
              value={acceptanceCriteria}
              onChange={(e) => setAcceptanceCriteria(e.target.value)}
              disabled={submitting}
              placeholder="How do we know this is done?"
              maxLength={DESC_MAX}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="add-feature-priority"
              className="text-sm font-medium text-foreground"
            >
              Priority (optional)
            </label>
            <Input
              id="add-feature-priority"
              data-testid="add-feature-priority"
              name="priority"
              type="number"
              inputMode="numeric"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              disabled={submitting}
              placeholder="Leave blank to append to end"
              min={0}
            />
          </div>

          {error && (
            <p
              role="alert"
              data-testid="add-feature-error"
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
            data-testid="add-feature-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitDisabled}
            data-testid="add-feature-submit"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Creating…
              </>
            ) : (
              "Create feature"
            )}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
