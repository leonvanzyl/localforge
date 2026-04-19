"use client";

import * as React from "react";

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

/**
 * Project-specific settings dialog (Feature #35).
 *
 * The `settings` table stores global rows with `project_id = NULL` and
 * per-project overrides with a non-null `project_id`. This dialog lets the
 * user override the LM Studio URL and/or model for a single project —
 * leaving a field blank falls back to the corresponding global value.
 *
 * The API call to PUT /api/projects/:id/settings accepts an empty string
 * as a signal to clear that override, so the "back to global default"
 * story is just "clear the field and save".
 */

type ProjectSettingsResponse = {
  overrides: { lm_studio_url: string | null; model: string | null };
  effective: { lm_studio_url: string; model: string };
  defaults: { lm_studio_url: string; model: string };
};

export type ProjectSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  projectName: string;
};

export function ProjectSettingsDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: ProjectSettingsDialogProps) {
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<ProjectSettingsResponse | null>(null);
  const [lmStudioUrl, setLmStudioUrl] = React.useState("");
  const [model, setModel] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Fetch current overrides + defaults whenever the dialog opens, so the
  // user always sees the latest state.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setSaved(false);
      try {
        const res = await fetch(`/api/projects/${projectId}/settings`, {
          cache: "no-store",
        });
        const payload = (await res.json()) as Partial<ProjectSettingsResponse> & {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(payload.error || `Load failed (${res.status})`);
        }
        if (cancelled) return;
        const complete = payload as ProjectSettingsResponse;
        setData(complete);
        setLmStudioUrl(complete.overrides.lm_studio_url ?? "");
        setModel(complete.overrides.model ?? "");
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load project settings",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Empty strings clear the override on the server side, falling
          // back to the global default. Anything else sets it.
          lm_studio_url: lmStudioUrl,
          model,
        }),
      });
      const payload = (await res.json()) as Partial<ProjectSettingsResponse> & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error || `Save failed (${res.status})`);
      }
      if (payload.overrides && payload.effective) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                overrides: payload.overrides!,
                effective: payload.effective!,
              }
            : prev,
        );
      }
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save project settings",
      );
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
      labelledBy="project-settings-title"
    >
      <DialogCloseButton onClick={() => onOpenChange(false)} />
      <DialogHeader>
        <DialogTitle id="project-settings-title">Project settings</DialogTitle>
        <DialogDescription>
          Override the LM Studio URL or model for{" "}
          <span className="font-medium text-foreground">{projectName}</span>.
          Leave a field blank to use the global default.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} data-testid="project-settings-form">
        <DialogBody className="space-y-4">
          {loading && (
            <p
              data-testid="project-settings-loading"
              className="text-sm text-muted-foreground"
            >
              Loading current settings…
            </p>
          )}
          {!loading && data && (
            <>
              <Field
                label="LM Studio URL"
                id="project-lm_studio_url"
                value={lmStudioUrl}
                onChange={setLmStudioUrl}
                placeholder={data.defaults.lm_studio_url}
                disabled={submitting}
                description={
                  data.overrides.lm_studio_url
                    ? "Project override is set. Clear to fall back to the global default."
                    : "Using the global default. Type a value to override."
                }
              />
              <Field
                label="Model"
                id="project-model"
                value={model}
                onChange={setModel}
                placeholder={data.defaults.model}
                disabled={submitting}
                description={
                  data.overrides.model
                    ? "Project override is set. Clear to fall back to the global default."
                    : "Using the global default. Type a value to override."
                }
              />
              <div
                data-testid="project-settings-effective"
                className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
              >
                <p className="font-medium text-foreground">
                  Currently effective
                </p>
                <p className="mt-1">
                  URL: <span>{data.effective.lm_studio_url}</span>
                </p>
                <p>
                  Model: <span>{data.effective.model}</span>
                </p>
              </div>
            </>
          )}
          {error && (
            <p
              role="alert"
              data-testid="project-settings-error"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {saved && (
            <p
              data-testid="project-settings-saved"
              className="text-sm text-green-500"
            >
              Saved.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            data-testid="project-settings-close"
          >
            Close
          </Button>
          <Button
            type="submit"
            disabled={loading || submitting}
            data-testid="project-settings-save"
          >
            {submitting ? "Saving…" : "Save settings"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function Field({
  label,
  id,
  value,
  onChange,
  placeholder,
  description,
  disabled,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        data-testid={`project-settings-${id}-input`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
