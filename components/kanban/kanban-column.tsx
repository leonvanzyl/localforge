"use client";

import type { ReactNode } from "react";
import { Inbox, Loader2, CheckCircle2 } from "lucide-react";

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
  children,
}: KanbanColumnProps) {
  const Icon = ICONS[id];
  const isEmpty =
    children == null ||
    (Array.isArray(children) && children.filter(Boolean).length === 0);

  return (
    <section
      data-testid={`kanban-column-${id}`}
      data-column-id={id}
      aria-label={title}
      className={cn(
        "flex min-w-[280px] flex-1 flex-col rounded-lg border border-border bg-card/40",
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
      </header>
      <div
        data-testid={`kanban-column-body-${id}`}
        className="flex min-h-[200px] flex-1 flex-col gap-2 overflow-y-auto p-3"
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
