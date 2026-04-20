"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Images,
  Loader2,
  Link2,
  TerminalSquare,
  Trash2,
  X as XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FeatureCardData } from "./feature-card";

const TITLE_MAX = 200;
const DESC_MAX = 5000;

type DetailFeature = FeatureCardData;

type AgentLogEntry = {
  id: number;
  sessionId: number;
  featureId: number | null;
  message: string;
  messageType: "info" | "action" | "error" | "screenshot" | "test_result";
  screenshotPath: string | null;
  createdAt: string;
};

function logBadgeClass(mt: AgentLogEntry["messageType"]) {
  switch (mt) {
    case "action":
      return "border border-blue-500/40 bg-blue-500/10 text-blue-400";
    case "error":
      return "border border-destructive/40 bg-destructive/10 text-destructive";
    case "screenshot":
      return "border border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-400";
    case "test_result":
      return "border border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
    case "info":
    default:
      return "border border-border bg-muted text-muted-foreground";
  }
}

/**
 * Turn a stored `screenshotPath` log value into the URL our `/api/screenshots`
 * route serves. The runner emits paths like `screenshots/feature-48-foo.png`
 * (relative to the harness repo root) so we strip the leading `screenshots/`
 * before joining — otherwise we'd hit `/api/screenshots/screenshots/...` and
 * the route handler would look for the file at `<repo>/screenshots/screenshots/*`.
 */
function resolveScreenshotUrl(raw: string): string {
  const trimmed = raw.replace(/^\/+/, "");
  const stripped = trimmed.replace(/^screenshots\//, "");
  return `/api/screenshots/${stripped}`;
}

function formatLogTime(iso: string): string {
  // Logs come back as either ISO or SQLite `YYYY-MM-DD HH:MM:SS`. Normalize
  // the SQLite variant by swapping the space for a T so Date.parse works
  // cross-browser, then render local time.
  const normalized = /^\d{4}-\d{2}-\d{2} /.test(iso)
    ? `${iso.replace(" ", "T")}Z`
    : iso;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Modal for viewing and editing a single feature.
 *
 * Supported edits:
 *   - title
 *   - description
 *   - acceptance criteria
 *   - status (backlog | in_progress | completed)
 *   - dependencies (multi-select from other features in the same project)
 *
 * When Save is clicked we PATCH /api/features/:id with changed fields and
 * (separately) POST /api/features/:id/dependencies with the full new set.
 * On success the parent re-fetches the feature list so the kanban updates.
 */
export function FeatureDetailDialog({
  open,
  featureId,
  projectId,
  onOpenChange,
  onSaved,
  onDeleted,
  allFeatures,
}: {
  open: boolean;
  featureId: number | null;
  projectId: number;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  /**
   * Called when the feature is successfully deleted via the destructive
   * "Delete feature" action (Feature #46). Lets the parent re-fetch the
   * kanban so the deleted card disappears from the column.
   */
  onDeleted?: (featureId: number) => void;
  allFeatures: DetailFeature[];
}) {
  const [feature, setFeature] = React.useState<DetailFeature | null>(null);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = React.useState("");
  const [status, setStatus] = React.useState<
    "backlog" | "in_progress" | "completed"
  >("backlog");
  // Priority is an integer; lower numbers sort first within a column. We keep
  // it as a string in local state so the user can clear/retype the field
  // without React fighting them, then parse on save (Feature #45).
  const [priorityInput, setPriorityInput] = React.useState<string>("");
  const [deps, setDeps] = React.useState<number[]>([]);
  const [initialDeps, setInitialDeps] = React.useState<number[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [depPick, setDepPick] = React.useState<string>("");

  const [logs, setLogs] = React.useState<AgentLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = React.useState(false);
  const [logsError, setLogsError] = React.useState<string | null>(null);

  /**
   * Feature #79: screenshot-gallery lightbox.
   *
   * We derive the gallery's image list from the same `logs` state (any row
   * with messageType=="screenshot" AND a non-null `screenshotPath`), so the
   * gallery reflects whatever the agent has captured so far without a
   * separate fetch. The lightbox is driven by an index into that derived
   * list (`null` means the lightbox is closed). Using an index — not the log
   * id — lets us compute prev/next in O(1) and keeps keyboard nav trivial.
   */
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);

  /**
   * Delete confirmation state (Feature #46).
   *
   * The first click of the "Delete feature" button toggles
   * `confirmingDelete=true` which swaps the footer to a confirmation prompt
   * with explicit "Cancel" and "Yes, delete" buttons. This is the
   * "double-action" requirement from feature #46 - the user has to confirm
   * before the DELETE request is sent.
   */
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || featureId == null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFieldError(null);
    setLogs([]);
    setLogsError(null);
    setLogsLoading(true);
    // Always start with the destructive flow collapsed. If the user previously
    // armed delete-confirmation and then closed the dialog, reopening should
    // not still be armed.
    setConfirmingDelete(false);
    setDeleteError(null);
    setDeleting(false);
    // Feature #79: reset the gallery lightbox so reopening the dialog always
    // starts with the lightbox closed (users expect a fresh view).
    setLightboxIndex(null);

    async function load(id: number) {
      try {
        const [fRes, dRes] = await Promise.all([
          fetch(`/api/features/${id}`, { cache: "no-store" }),
          fetch(`/api/features/${id}/dependencies`, { cache: "no-store" }),
        ]);
        if (!fRes.ok) {
          throw new Error(`Failed to load feature (${fRes.status})`);
        }
        const fData = (await fRes.json()) as {
          feature: DetailFeature;
        };
        const dData = dRes.ok
          ? ((await dRes.json()) as { dependencies: DetailFeature[] })
          : { dependencies: [] as DetailFeature[] };
        if (cancelled) return;
        setFeature(fData.feature);
        setTitle(fData.feature.title);
        setDescription(fData.feature.description ?? "");
        setAcceptanceCriteria(fData.feature.acceptanceCriteria ?? "");
        setStatus(fData.feature.status);
        setPriorityInput(String(fData.feature.priority ?? 0));
        const depIds = dData.dependencies.map((d) => d.id);
        setDeps(depIds);
        setInitialDeps(depIds);
        setDepPick("");
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load feature",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    async function loadLogs(id: number) {
      try {
        const res = await fetch(`/api/features/${id}/logs`, {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`Failed to load logs (${res.status})`);
        }
        const data = (await res.json()) as { logs: AgentLogEntry[] };
        if (cancelled) return;
        setLogs(data.logs ?? []);
      } catch (err) {
        if (!cancelled) {
          setLogsError(
            err instanceof Error ? err.message : "Failed to load logs",
          );
        }
      } finally {
        if (!cancelled) setLogsLoading(false);
      }
    }

    load(featureId);
    loadLogs(featureId);
    return () => {
      cancelled = true;
    };
  }, [open, featureId]);

  const candidateDeps = React.useMemo(() => {
    if (!feature) return [] as DetailFeature[];
    return allFeatures.filter(
      (f) => f.id !== feature.id && !deps.includes(f.id),
    );
  }, [allFeatures, feature, deps]);

  const depDetails = React.useMemo(() => {
    return deps
      .map((id) => allFeatures.find((f) => f.id === id))
      .filter((f): f is DetailFeature => Boolean(f));
  }, [deps, allFeatures]);

  /**
   * Feature #79: derive the ordered screenshot list from the log stream.
   * We keep the log order (chronological) and deduplicate on `screenshotPath`
   * so that if the agent re-emits the same screenshot we don't render the
   * same thumbnail twice in the grid.
   */
  const screenshots = React.useMemo(() => {
    const seen = new Set<string>();
    const out: { logId: number; path: string; url: string; createdAt: string }[] =
      [];
    for (const log of logs) {
      if (log.messageType !== "screenshot") continue;
      if (!log.screenshotPath) continue;
      if (seen.has(log.screenshotPath)) continue;
      seen.add(log.screenshotPath);
      out.push({
        logId: log.id,
        path: log.screenshotPath,
        url: resolveScreenshotUrl(log.screenshotPath),
        createdAt: log.createdAt,
      });
    }
    return out;
  }, [logs]);

  const activeScreenshot =
    lightboxIndex != null && lightboxIndex >= 0 && lightboxIndex < screenshots.length
      ? screenshots[lightboxIndex]
      : null;

  const showPrev = React.useCallback(() => {
    setLightboxIndex((cur) => {
      if (cur == null || screenshots.length === 0) return cur;
      return (cur - 1 + screenshots.length) % screenshots.length;
    });
  }, [screenshots.length]);

  const showNext = React.useCallback(() => {
    setLightboxIndex((cur) => {
      if (cur == null || screenshots.length === 0) return cur;
      return (cur + 1) % screenshots.length;
    });
  }, [screenshots.length]);

  const closeLightbox = React.useCallback(() => {
    setLightboxIndex(null);
  }, []);

  // Feature #79: keyboard navigation inside the lightbox.
  //   Esc        — close the lightbox (NOT the parent dialog)
  //   ←          — previous screenshot
  //   →          — next screenshot
  //
  // We bind in the *capture* phase and call `stopImmediatePropagation` on
  // Escape so the parent Dialog's own document-level Escape handler doesn't
  // also fire and close the whole feature-detail modal. Only the innermost
  // overlay (the lightbox) should react to Escape while it's open.
  // Arrow keys don't need the same treatment because the Dialog doesn't
  // bind them.
  React.useEffect(() => {
    if (lightboxIndex == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeLightbox();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        showPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        showNext();
      }
    }
    document.addEventListener("keydown", onKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKey, { capture: true });
  }, [lightboxIndex, closeLightbox, showPrev, showNext]);

  function addDep(raw: string) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    setDeps((cur) => (cur.includes(n) ? cur : [...cur, n]));
    setDepPick("");
  }

  function removeDep(id: number) {
    setDeps((cur) => cur.filter((d) => d !== id));
  }

  function validate(): string | null {
    const trimmed = title.trim();
    if (trimmed.length === 0) return "Title is required";
    if (trimmed.length > TITLE_MAX) {
      return `Title must be ${TITLE_MAX} characters or fewer`;
    }
    if (description.length > DESC_MAX) {
      return `Description must be ${DESC_MAX} characters or fewer`;
    }
    // Feature #45: priority must parse to a finite integer. Empty / NaN /
    // floats / negatives are rejected so the backend never receives garbage.
    const trimmedPriority = priorityInput.trim();
    if (trimmedPriority.length === 0) return "Priority is required";
    const parsedPriority = Number(trimmedPriority);
    if (
      !Number.isFinite(parsedPriority) ||
      !Number.isInteger(parsedPriority) ||
      parsedPriority < 0
    ) {
      return "Priority must be a non-negative integer";
    }
    return null;
  }

  async function handleDelete() {
    if (!feature) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/features/${feature.id}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Delete failed (${res.status})`);
      }
      // Notify parent so it re-fetches the feature list and the deleted card
      // disappears from the kanban. Then close the dialog.
      onDeleted?.(feature.id);
      onOpenChange(false);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete feature",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!feature) return;
    const validationError = validate();
    if (validationError) {
      setFieldError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    setFieldError(null);

    // Build a PATCH body with only changed fields so the backend doesn't
    // accidentally clobber things we didn't touch.
    const patch: Record<string, unknown> = {};
    const nextTitle = title.trim();
    if (nextTitle !== feature.title) patch.title = nextTitle;
    if ((description || null) !== feature.description) {
      patch.description = description.length === 0 ? null : description;
    }
    if ((acceptanceCriteria || null) !== feature.acceptanceCriteria) {
      patch.acceptanceCriteria =
        acceptanceCriteria.length === 0 ? null : acceptanceCriteria;
    }
    if (status !== feature.status) patch.status = status;
    // Feature #45: only send priority if it actually changed so we don't
    // bump updatedAt unnecessarily and so we play nice with optimistic locks.
    const nextPriority = Number.parseInt(priorityInput.trim(), 10);
    if (
      Number.isFinite(nextPriority) &&
      nextPriority !== feature.priority
    ) {
      patch.priority = nextPriority;
    }

    try {
      if (Object.keys(patch).length > 0) {
        const res = await fetch(`/api/features/${feature.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || `Update failed (${res.status})`);
        }
      }

      // If the dependency set changed, push the full new list.
      const depsChanged =
        deps.length !== initialDeps.length ||
        deps.some((d) => !initialDeps.includes(d));
      if (depsChanged) {
        const res = await fetch(
          `/api/features/${feature.id}/dependencies`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dependsOn: deps }),
          },
        );
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(
            data.error || `Dependency update failed (${res.status})`,
          );
        }
      }

      if (onSaved) onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !saving) onOpenChange(false);
      }}
      labelledBy="feature-detail-title"
    >
      <DialogCloseButton onClick={() => onOpenChange(false)} />
      <div className="max-h-[85vh] overflow-y-auto">
        <form
          onSubmit={handleSubmit}
          data-testid="feature-detail-form"
          noValidate
        >
          <DialogHeader>
            <DialogTitle id="feature-detail-title">
              {feature
                ? `Feature ${
                    [...allFeatures]
                      .sort((a, b) => a.id - b.id)
                      .findIndex((f) => f.id === feature.id) + 1
                  } of ${allFeatures.length}`
                : "Feature details"}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {loading && (
              <p
                data-testid="feature-detail-loading"
                className="text-sm text-muted-foreground"
              >
                Loading…
              </p>
            )}

            {!loading && feature && (
              <>
                <div className="space-y-1.5">
                  <label
                    htmlFor="feature-detail-title-input"
                    className="text-sm font-medium text-foreground"
                  >
                    Title <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="feature-detail-title-input"
                    data-testid="feature-detail-title-input"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      if (fieldError) setFieldError(null);
                      if (error) setError(null);
                    }}
                    disabled={saving}
                    maxLength={TITLE_MAX}
                    aria-invalid={fieldError ? "true" : "false"}
                  />
                  {fieldError && (
                    <p
                      role="alert"
                      data-testid="feature-detail-field-error"
                      className="text-xs text-destructive"
                    >
                      {fieldError}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="feature-detail-description"
                    className="text-sm font-medium text-foreground"
                  >
                    Description
                  </label>
                  <textarea
                    id="feature-detail-description"
                    data-testid="feature-detail-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={saving}
                    rows={4}
                    maxLength={DESC_MAX}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="feature-detail-acceptance"
                    className="text-sm font-medium text-foreground"
                  >
                    Acceptance criteria
                  </label>
                  <textarea
                    id="feature-detail-acceptance"
                    data-testid="feature-detail-acceptance"
                    value={acceptanceCriteria}
                    onChange={(e) => setAcceptanceCriteria(e.target.value)}
                    disabled={saving}
                    rows={3}
                    maxLength={DESC_MAX}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="feature-detail-status"
                    className="text-sm font-medium text-foreground"
                  >
                    Status
                  </label>
                  <select
                    id="feature-detail-status"
                    data-testid="feature-detail-status"
                    value={status}
                    onChange={(e) =>
                      setStatus(
                        e.target.value as
                          | "backlog"
                          | "in_progress"
                          | "completed",
                      )
                    }
                    disabled={saving}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="backlog">Backlog</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="feature-detail-priority"
                    className="text-sm font-medium text-foreground"
                  >
                    Priority
                  </label>
                  <Input
                    id="feature-detail-priority"
                    data-testid="feature-detail-priority-input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={priorityInput}
                    onChange={(e) => {
                      setPriorityInput(e.target.value);
                      if (fieldError) setFieldError(null);
                      if (error) setError(null);
                    }}
                    disabled={saving}
                    aria-describedby="feature-detail-priority-help"
                  />
                  <p
                    id="feature-detail-priority-help"
                    className="text-xs text-muted-foreground"
                  >
                    Lower numbers sort first within a column. Use 0 to pin a
                    feature to the top.
                  </p>
                </div>

                <div
                  className="space-y-2"
                  data-testid="feature-detail-deps-section"
                >
                  <label className="flex items-center gap-1 text-sm font-medium text-foreground">
                    <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Dependencies
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Features this one depends on. It will only be "ready"
                    after all dependencies are completed.
                  </p>
                  {depDetails.length > 0 ? (
                    <ul
                      data-testid="feature-detail-deps-list"
                      className="flex flex-wrap gap-1.5"
                    >
                      {depDetails.map((d) => (
                        <li key={d.id}>
                          <span
                            data-testid={`feature-detail-dep-${d.id}`}
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
                          >
                            <span className="truncate max-w-[200px]">
                              #{d.id} {d.title}
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove dependency #${d.id}`}
                              data-testid={`feature-detail-dep-remove-${d.id}`}
                              onClick={() => removeDep(d.id)}
                              className="rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive"
                              disabled={saving}
                            >
                              <XIcon className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p
                      data-testid="feature-detail-deps-empty"
                      className="text-xs text-muted-foreground"
                    >
                      No dependencies yet.
                    </p>
                  )}
                  {candidateDeps.length > 0 && (
                    <div className="flex items-center gap-2">
                      <select
                        data-testid="feature-detail-dep-picker"
                        value={depPick}
                        onChange={(e) => setDepPick(e.target.value)}
                        disabled={saving}
                        className="flex h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">Pick a feature…</option>
                        {candidateDeps.map((c) => (
                          <option key={c.id} value={c.id}>
                            #{c.id} {c.title}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="feature-detail-dep-add"
                        disabled={saving || depPick === ""}
                        onClick={() => addDep(depPick)}
                      >
                        Add
                      </Button>
                    </div>
                  )}
                </div>

                {/* Feature #79: screenshot gallery. Renders a thumbnail grid
                    of every screenshot captured during agent runs. Clicking a
                    thumbnail opens a lightbox with prev/next navigation and
                    Esc-to-close keyboard support. When there are no
                    screenshots yet we still render the section header with a
                    muted empty state so users know where the gallery will
                    appear once tests run. */}
                <div
                  className="space-y-2"
                  data-testid="feature-detail-screenshots-section"
                >
                  <label className="flex items-center gap-1 text-sm font-medium text-foreground">
                    <Images className="h-3.5 w-3.5" aria-hidden="true" />
                    Screenshots
                    {screenshots.length > 0 && (
                      <span
                        data-testid="feature-detail-screenshots-count"
                        className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground"
                      >
                        {screenshots.length}
                      </span>
                    )}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Verification screenshots captured by Playwright during
                    agent runs. Click any thumbnail to view it full-size.
                  </p>

                  {screenshots.length === 0 ? (
                    <p
                      data-testid="feature-detail-screenshots-empty"
                      className="text-xs text-muted-foreground"
                    >
                      {logsLoading
                        ? "Loading screenshots…"
                        : "No screenshots captured yet."}
                    </p>
                  ) : (
                    <ul
                      data-testid="feature-detail-screenshots-grid"
                      className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
                    >
                      {screenshots.map((shot, idx) => (
                        <li key={shot.logId}>
                          <button
                            type="button"
                            data-testid={`feature-detail-screenshot-thumb-${shot.logId}`}
                            data-screenshot-index={idx}
                            onClick={() => setLightboxIndex(idx)}
                            className="group block w-full overflow-hidden rounded-md border border-border bg-background/40 transition-colors hover:border-fuchsia-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <img
                              src={shot.url}
                              alt={`Screenshot ${idx + 1} of ${screenshots.length}`}
                              className="block h-24 w-full object-cover"
                              loading="lazy"
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div
                  className="space-y-2"
                  data-testid="feature-detail-logs-section"
                >
                  <label className="flex items-center gap-1 text-sm font-medium text-foreground">
                    <TerminalSquare
                      className="h-3.5 w-3.5"
                      aria-hidden="true"
                    />
                    Agent activity
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Messages captured during coding-agent sessions that worked
                    on this feature. Logs persist across sessions and server
                    restarts.
                  </p>

                  {logsLoading && (
                    <p
                      data-testid="feature-detail-logs-loading"
                      className="text-xs text-muted-foreground"
                    >
                      Loading logs…
                    </p>
                  )}

                  {logsError && (
                    <p
                      role="alert"
                      data-testid="feature-detail-logs-error"
                      className="text-xs text-destructive"
                    >
                      {logsError}
                    </p>
                  )}

                  {!logsLoading && !logsError && logs.length === 0 && (
                    <p
                      data-testid="feature-detail-logs-empty"
                      className="text-xs text-muted-foreground"
                    >
                      No agent activity recorded yet.
                    </p>
                  )}

                  {!logsLoading && !logsError && logs.length > 0 && (
                    <div
                      data-testid="feature-detail-logs-list"
                      className="max-h-80 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed"
                    >
                      <ul className="space-y-1">
                        {logs.map((log) => (
                          <li
                            key={log.id}
                            data-testid={`feature-detail-log-${log.id}`}
                            data-message-type={log.messageType}
                            className="flex flex-col gap-1"
                          >
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 text-muted-foreground">
                                {formatLogTime(log.createdAt)}
                              </span>
                              <span
                                className={`shrink-0 rounded px-1.5 py-0 text-[10px] uppercase ${logBadgeClass(
                                  log.messageType,
                                )}`}
                              >
                                {log.messageType}
                              </span>
                              <span className="break-words text-foreground">
                                {log.message}
                              </span>
                            </div>
                            {log.screenshotPath && (
                              /* Feature #96/#79: inline thumbnail of the
                                 screenshot captured by the Playwright run.
                                 Uses the same resolver as the gallery so the
                                 two views share one code path for stripping
                                 the leading `screenshots/` segment before
                                 hitting the /api/screenshots route. */
                              <a
                                href={resolveScreenshotUrl(log.screenshotPath)}
                                target="_blank"
                                rel="noopener noreferrer"
                                data-testid={`feature-detail-log-screenshot-${log.id}`}
                                className="ml-16 block w-fit overflow-hidden rounded border border-border bg-background/40 p-1 hover:border-fuchsia-500/60"
                              >
                                <img
                                  src={resolveScreenshotUrl(log.screenshotPath)}
                                  alt={`Screenshot for log ${log.id}`}
                                  className="max-h-48 w-auto max-w-full"
                                  loading="lazy"
                                />
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </>
            )}

            {error && (
              <p
                role="alert"
                data-testid="feature-detail-error"
                className="text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </DialogBody>
          <DialogFooter className="sm:justify-between">
            {/* Left side: destructive delete affordance (Feature #46).
                When the user clicks "Delete feature" the first time we swap
                this region to a confirmation prompt instead of deleting
                immediately, satisfying the "double-action" requirement. */}
            {feature && !confirmingDelete && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setDeleteError(null);
                  setConfirmingDelete(true);
                }}
                disabled={saving || deleting || loading}
                data-testid="feature-detail-delete"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete feature
              </Button>
            )}
            {feature && confirmingDelete && (
              <div
                data-testid="feature-detail-delete-confirm"
                className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <p
                  data-testid="feature-detail-delete-warning"
                  className="text-sm text-destructive"
                >
                  Delete this feature? This also removes its dependency
                  links and cannot be undone.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setConfirmingDelete(false);
                      setDeleteError(null);
                    }}
                    disabled={deleting}
                    data-testid="feature-detail-delete-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={deleting}
                    data-testid="feature-detail-delete-confirm-button"
                  >
                    {deleting ? (
                      <>
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                        Deleting…
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Yes, delete
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
            {!confirmingDelete && (
              <div className="flex gap-2 sm:ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={saving || deleting}
                  data-testid="feature-detail-cancel"
                >
                  Close
                </Button>
                <Button
                  type="submit"
                  disabled={saving || loading || !feature || deleting}
                  data-testid="feature-detail-save"
                >
                  {saving ? (
                    <>
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                      Saving…
                    </>
                  ) : (
                    "Save changes"
                  )}
                </Button>
              </div>
            )}
          </DialogFooter>
          {deleteError && (
            <div className="border-t border-border px-6 py-2">
              <p
                role="alert"
                data-testid="feature-detail-delete-error"
                className="text-sm text-destructive"
              >
                {deleteError}
              </p>
            </div>
          )}
        </form>
      </div>
      {/* Feature #79: screenshot-gallery lightbox. Rendered OUTSIDE the
          scrollable `max-h-[85vh]` container so it floats over the dialog at
          the viewport level. Clicking the backdrop closes; clicking the
          image itself does not (so users can zoom/copy without dismissing).
          The prev/next buttons wrap, matching the keyboard behaviour. */}
      {activeScreenshot && lightboxIndex != null && (
        <div
          data-testid="feature-detail-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Screenshot ${lightboxIndex + 1} of ${screenshots.length}`}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={closeLightbox}
        >
          <button
            type="button"
            data-testid="feature-detail-lightbox-close"
            aria-label="Close screenshot viewer"
            onClick={(e) => {
              e.stopPropagation();
              closeLightbox();
            }}
            className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white/90 transition-colors hover:bg-black/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="h-5 w-5" aria-hidden="true" />
          </button>
          {screenshots.length > 1 && (
            <>
              <button
                type="button"
                data-testid="feature-detail-lightbox-prev"
                aria-label="Previous screenshot"
                onClick={(e) => {
                  e.stopPropagation();
                  showPrev();
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white/90 transition-colors hover:bg-black/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft className="h-6 w-6" aria-hidden="true" />
              </button>
              <button
                type="button"
                data-testid="feature-detail-lightbox-next"
                aria-label="Next screenshot"
                onClick={(e) => {
                  e.stopPropagation();
                  showNext();
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white/90 transition-colors hover:bg-black/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight className="h-6 w-6" aria-hidden="true" />
              </button>
            </>
          )}
          <div
            className="flex max-h-full max-w-full flex-col items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={activeScreenshot.url}
              alt={`Screenshot ${lightboxIndex + 1} of ${screenshots.length}`}
              data-testid="feature-detail-lightbox-image"
              className="max-h-[85vh] max-w-full rounded-md border border-border object-contain"
            />
            <p
              data-testid="feature-detail-lightbox-caption"
              className="rounded-md bg-black/60 px-2 py-0.5 text-xs text-white/80"
            >
              {lightboxIndex + 1} / {screenshots.length} — {activeScreenshot.path}
            </p>
          </div>
        </div>
      )}
    </Dialog>
  );
}
