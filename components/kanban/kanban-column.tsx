"use client";

import * as React from "react";
import type { ReactNode } from "react";
import { Inbox, Loader2, CheckCircle2, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

const ICONS = {
  backlog: Inbox,
  in_progress: Loader2,
  completed: CheckCircle2,
} as const;

type KanbanColumnProps = {
  id: "backlog" | "in_progress" | "completed";
  title: string;
  emptyHint: string;
  /** Card count - shown as a small badge in the column header. */
  count?: number;
  /**
   * If provided, a "+ Add feature" button is rendered in the column header
   * and triggers this callback when clicked. Feature #40 requires the
   * Backlog column to show this affordance.
   */
  onAdd?: () => void;
  /**
   * If provided, a destructive "Clear" button is rendered in the column
   * header. Intended for the Completed column to make it cheap to reset a
   * project's done pile (ENH-004). The button is only visible when the
   * column has at least one card. The parent owns the confirmation prompt
   * and the actual delete logic — this component just renders the trigger.
   */
  onClearCompleted?: () => void;
  /**
   * Optional ref attached to the column's scrollable body. The kanban-board
   * uses this to register the body as a `useDroppable` target so drag-and-
   * drop (Feature #47) can detect drops onto empty column space.
   */
  bodyRef?: React.Ref<HTMLDivElement>;
  /**
   * Optional className appended to the body div - used by the drag layer
   * to add a hover ring when a card is being dragged over this column.
   */
  bodyClassName?: string;
  children?: ReactNode;
};

/**
 * Single column of the kanban board. Shows a header with title + count
 * badge and a scrollable card container underneath. The three columns are
 * styled consistently but tinted subtly by status (primary / warning /
 * success) to match the design system.
 */
export function KanbanColumn({
  id,
  title,
  emptyHint,
  count,
  onAdd,
  onClearCompleted,
  bodyRef,
  bodyClassName,
  children,
}: KanbanColumnProps) {
  const Icon = ICONS[id];
  const childArray = Array.isArray(children)
    ? children.filter(Boolean)
    : children == null
      ? []
      : [children];
  const isEmpty = childArray.length === 0;
  const displayCount = typeof count === "number" ? count : childArray.length;

  return (
    <section
      data-testid={`kanban-column-${id}`}
      data-column-id={id}
      data-count={displayCount}
      aria-label={title}
      className={cn(
        "flex min-h-0 min-w-[280px] flex-1 flex-col rounded-lg border border-border bg-card/40",
      )}
    >
      <header
        data-testid={`kanban-column-header-${id}`}
        className="flex items-center justify-between border-b border-border px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              "h-4 w-4",
              id === "backlog" && "text-muted-foreground",
              id === "in_progress" && "text-amber-500",
              id === "completed" && "text-emerald-500",
            )}
            aria-hidden="true"
          />
          <h2
            data-testid={`kanban-column-title-${id}`}
            className="text-sm font-semibold tracking-tight text-foreground"
          >
            {title}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid={`kanban-column-count-${id}`}
            aria-label={`${displayCount} ${
              displayCount === 1 ? "feature" : "features"
            }`}
            className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground"
          >
            {displayCount}
          </span>
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              data-testid={`kanban-column-add-${id}`}
              aria-label={`Add feature to ${title}`}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              Add Feature
            </button>
          )}
          {onClearCompleted && id === "completed" && displayCount > 0 && (
            <button
              type="button"
              onClick={onClearCompleted}
              data-testid={`kanban-column-clear-${id}`}
              aria-label={`Delete all ${displayCount} completed ${
                displayCount === 1 ? "feature" : "features"
              }`}
              title="Delete every card in this column"
              className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-background px-2 py-0.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>
      </header>
      <div
        ref={bodyRef}
        data-testid={`kanban-column-body-${id}`}
        className={cn(
          "flex min-h-[200px] flex-1 flex-col gap-2 overflow-y-auto p-3",
          bodyClassName,
        )}
      >
        {isEmpty ? (
          <p
            data-testid={`kanban-column-empty-${id}`}
            className="m-auto max-w-[220px] text-center text-xs text-muted-foreground"
          >
            {emptyHint}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
