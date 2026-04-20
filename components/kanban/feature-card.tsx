"use client";

import * as React from "react";
import { CheckCircle2, Link2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shape of the "latest Playwright run" summary surfaced on the kanban card by
 * Feature #96. The server fills this in from the most recent `test_result`
 * log row tagged to the feature — null when the agent hasn't run a spec yet.
 */
export type FeatureTestResultBadge = {
  passed: number;
  failed: number;
  total: number;
  ok: boolean;
  durationMs: number | null;
  rawMessage: string;
  createdAt: string;
};

/**
 * Per-project 1-based feature numbering. The DB id is global across every
 * project (shared autoincrement sequence), so a brand-new project's first
 * feature can land on #165 or higher. We expose a stable per-project index
 * for display via context so the kanban and detail dialog never surface the
 * raw DB id.
 */
const FeatureNumbersContext = React.createContext<Map<number, number> | null>(
  null,
);

export const FeatureNumbersProvider = FeatureNumbersContext.Provider;

export function useFeatureNumber(featureId: number): number | null {
  const map = React.useContext(FeatureNumbersContext);
  return map?.get(featureId) ?? null;
}

/**
 * Small id chip shown on every kanban card. Renders the per-project number
 * when a {@link FeatureNumbersProvider} is in scope; otherwise falls back to
 * the raw DB id so the DragOverlay (which renders outside the provider) and
 * any ad-hoc usages keep working.
 */
function FeatureNumberChip({ feature }: { feature: { id: number } }) {
  const displayNumber = useFeatureNumber(feature.id);
  return (
    <span
      data-testid={`feature-card-id-${feature.id}`}
      className="rounded-full border border-border px-1.5 py-0.5"
    >
      #{displayNumber ?? feature.id}
    </span>
  );
}

export type FeatureCardData = {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  status: "backlog" | "in_progress" | "completed";
  priority: number;
  category: string;
  createdAt: string;
  updatedAt: string;
  dependencyCount: number;
  /**
   * IDs of prerequisite features (the features this one depends on).
   * Used by the kanban-board (Feature #52) to draw SVG connector lines
   * between this card and each of its prerequisites.
   */
  dependsOn?: number[];
  /**
   * Latest Playwright run summary for this feature, or null if the agent
   * hasn't produced a test_result log yet. Feature #96.
   */
  testResult?: FeatureTestResultBadge | null;
};

/**
 * Single feature card rendered inside a kanban column.
 *
 * Clicking the card opens the detail modal (wired up by the parent via
 * the optional `onOpen` callback - when omitted the card renders as a
 * static <article> for test scenarios that don't need interaction).
 *
 * The card always shows:
 *   - the feature title (line-clamped to keep cards uniform)
 *   - a priority badge (numeric, colour-coded by category) - Feature #38
 *   - a dependency-count indicator when dependencies exist - Feature #39
 */
export function FeatureCard({
  feature,
  onOpen,
}: {
  feature: FeatureCardData;
  onOpen?: (id: number) => void;
}) {
  const priorityLabel = `Priority ${feature.priority}`;
  const depCount = feature.dependencyCount;
  const depLabel = `${depCount} dependenc${depCount === 1 ? "y" : "ies"}`;

  // Feature #96: render the latest Playwright run summary as a small pass/
  // fail badge in the card footer. `testResult` is null when no spec has run
  // for this feature yet, in which case we omit the badge entirely rather
  // than show a misleading "0 passed / 0 failed".
  const tr = feature.testResult ?? null;
  const testBadgeLabel = tr
    ? `Tests: ${tr.passed} passed${tr.failed > 0 ? `, ${tr.failed} failed` : ""}`
    : null;

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3
          data-testid={`feature-card-title-${feature.id}`}
          className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug text-foreground"
        >
          {feature.title}
        </h3>
        <span
          data-testid={`feature-card-priority-${feature.id}`}
          data-priority={feature.priority}
          title={priorityLabel}
          aria-label={priorityLabel}
          className={cn(
            "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums",
            feature.category === "style"
              ? "border-sky-500/40 bg-sky-500/10 text-sky-400"
              : "border-primary/40 bg-primary/10 text-primary",
          )}
        >
          P{feature.priority}
        </span>
      </div>
      {feature.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {feature.description}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between gap-1.5 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <FeatureNumberChip feature={feature} />
          <span
            data-testid={`feature-card-category-${feature.id}`}
            className="rounded-full border border-border px-1.5 py-0.5"
          >
            {feature.category}
          </span>
          {tr && testBadgeLabel && (
            <span
              data-testid={`feature-card-test-result-${feature.id}`}
              data-test-ok={tr.ok ? "true" : "false"}
              data-tests-passed={tr.passed}
              data-tests-failed={tr.failed}
              title={testBadgeLabel}
              aria-label={testBadgeLabel}
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                tr.ok
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                  : "border-destructive/40 bg-destructive/10 text-destructive",
              )}
            >
              {tr.ok ? (
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              ) : (
                <XCircle className="h-3 w-3" aria-hidden="true" />
              )}
              {tr.passed}/{tr.total}
            </span>
          )}
        </div>
        {depCount > 0 && (
          <span
            data-testid={`feature-card-deps-${feature.id}`}
            data-dependency-count={depCount}
            title={depLabel}
            aria-label={depLabel}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500"
          >
            <Link2 className="h-3 w-3" aria-hidden="true" />
            {depCount}
          </span>
        )}
      </div>
    </>
  );

  const commonClass = cn(
    "group block w-full rounded-md border border-border bg-background/60 px-3 py-2.5 text-left text-sm shadow-sm transition-colors",
    "hover:border-primary/50 hover:bg-accent/40",
  );

  if (onOpen) {
    return (
      <button
        type="button"
        data-testid={`feature-card-${feature.id}`}
        data-feature-id={feature.id}
        data-status={feature.status}
        data-priority={feature.priority}
        onClick={() => onOpen(feature.id)}
        className={cn(
          commonClass,
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {inner}
      </button>
    );
  }

  return (
    <article
      data-testid={`feature-card-${feature.id}`}
      data-feature-id={feature.id}
      data-status={feature.status}
      data-priority={feature.priority}
      className={commonClass}
    >
      {inner}
    </article>
  );
}
