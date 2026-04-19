"use client";

import * as React from "react";
import confetti from "canvas-confetti";
import { CheckCircle2, Trophy, Rocket, Timer, FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Celebration screen shown when every feature in a project is completed
 * (Feature #101). The LocalForge orchestrator flips `project.status` to
 * `"completed"` via `markProjectCompletedIfAllDone` whenever the last feature
 * in a project transitions to completed; the project page picks that up on
 * render and mounts this component.
 *
 * Responsibilities:
 *   1. Fetch `/api/projects/:id/completion` for the summary stats
 *      (feature count, tests-passed count, wall-clock duration).
 *   2. Fire a brief confetti burst exactly once per mount using
 *      canvas-confetti. Confetti respects `prefers-reduced-motion` — we skip
 *      the animation when the media query matches so the component stays
 *      accessibility-friendly.
 *   3. Offer a "View kanban" escape hatch so the user can still inspect the
 *      completed board below. Toggling this is purely client-local state; the
 *      database record stays `status = "completed"`.
 *
 * The component is rendered INSIDE the project page's main content area. When
 * a new celebration is triggered while the user is actively viewing the page
 * (i.e. the last feature completes in real time), a sibling listener
 * component (below) calls `router.refresh()` so Next.js re-queries the server
 * component and swaps the kanban out for this screen automatically.
 */
export type CelebrationStats = {
  status: string;
  featureCount: number;
  passedCount: number;
  testsPassedCount: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; stats: CelebrationStats };

export function CelebrationScreen({
  projectId,
  projectName,
  onDismiss,
}: {
  projectId: number;
  projectName: string;
  onDismiss?: () => void;
}) {
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });

  // Fetch the stats on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/completion`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error || `Failed to load (${res.status})`);
        }
        const data = (await res.json()) as { completion: CelebrationStats };
        if (!cancelled) setState({ kind: "ready", stats: data.completion });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              err instanceof Error ? err.message : "Failed to load stats",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Fire confetti once per mount. Skip the animation when the user has
  // requested reduced motion.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) return;

    // Two bursts from the lower corners — left then right, slightly
    // overlapping so the screen fills with a sweep of confetti.
    const defaults = {
      spread: 80,
      ticks: 80,
      gravity: 0.9,
      decay: 0.93,
      startVelocity: 40,
      particleCount: 80,
    } as const;
    confetti({ ...defaults, origin: { x: 0.1, y: 0.8 } });
    window.setTimeout(() => {
      confetti({ ...defaults, origin: { x: 0.9, y: 0.8 } });
    }, 250);
    window.setTimeout(() => {
      confetti({
        ...defaults,
        particleCount: 120,
        spread: 120,
        origin: { x: 0.5, y: 0.7 },
      });
    }, 500);
  }, [projectId]);

  return (
    <div
      data-testid="celebration-screen"
      data-project-id={projectId}
      className="flex flex-1 flex-col items-center justify-center overflow-auto px-6 py-10"
    >
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card/70 p-8 text-center shadow-lg backdrop-blur">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Trophy className="h-8 w-8" aria-hidden="true" />
        </div>
        <h1
          data-testid="celebration-heading"
          className="mt-4 text-3xl font-semibold tracking-tight text-foreground"
        >
          Project Complete!
        </h1>
        <p
          data-testid="celebration-project-name"
          className="mt-1 text-sm text-muted-foreground"
        >
          Every feature in{" "}
          <span className="font-medium text-foreground">{projectName}</span>{" "}
          has been delivered.
        </p>

        {state.kind === "loading" && (
          <p
            data-testid="celebration-loading"
            className="mt-6 text-sm text-muted-foreground"
          >
            Loading summary…
          </p>
        )}

        {state.kind === "error" && (
          <p
            data-testid="celebration-error"
            role="alert"
            className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {state.message}
          </p>
        )}

        {state.kind === "ready" && <StatsGrid stats={state.stats} />}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button
            data-testid="celebration-view-kanban"
            variant="outline"
            onClick={onDismiss}
          >
            View kanban
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatsGrid({ stats }: { stats: CelebrationStats }) {
  return (
    <div
      data-testid="celebration-stats"
      className="mt-6 grid grid-cols-1 gap-3 text-left sm:grid-cols-3"
    >
      <StatCard
        label="Features shipped"
        value={`${stats.passedCount} / ${stats.featureCount}`}
        testId="celebration-stat-features"
        icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
      />
      <StatCard
        label="Tests passed"
        value={String(stats.testsPassedCount)}
        testId="celebration-stat-tests"
        icon={<FlaskConical className="h-4 w-4" aria-hidden="true" />}
      />
      <StatCard
        label="Total time"
        value={formatDuration(stats.durationMs)}
        testId="celebration-stat-duration"
        icon={<Timer className="h-4 w-4" aria-hidden="true" />}
      />
      {stats.completedAt && (
        <div
          data-testid="celebration-completed-at"
          className="col-span-full mt-1 flex items-center justify-center gap-2 text-xs text-muted-foreground"
        >
          <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Completed {formatDate(stats.completedAt)}</span>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  testId,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-border bg-background/80 p-4"
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

/**
 * Format a millisecond duration as a compact human string.
 * Examples: 45s, 3m 12s, 2h 07m, 1d 03h
 */
function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${String(hours % 24).padStart(2, "0")}h`;
}

function formatDate(raw: string): string {
  // Match the SQLite vs ISO timestamp normalisation done server-side so
  // clients render a valid Date even when the value comes from the default
  // CURRENT_TIMESTAMP (which lacks T/Z).
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
