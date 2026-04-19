"use client";

import * as React from "react";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
          <span
            data-testid={`feature-card-id-${feature.id}`}
            className="rounded-full border border-border px-1.5 py-0.5"
          >
            #{feature.id}
          </span>
          <span
            data-testid={`feature-card-category-${feature.id}`}
            className="rounded-full border border-border px-1.5 py-0.5"
          >
            {feature.category}
          </span>
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
