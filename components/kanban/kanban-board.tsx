"use client";

import * as React from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { KanbanColumn } from "./kanban-column";
import { FeatureCard, type FeatureCardData } from "./feature-card";
import { SortableFeatureCard } from "./sortable-feature-card";
import { AddFeatureDialog } from "./add-feature-dialog";
import { FeatureDetailDialog } from "./feature-detail-dialog";
import { DependencyLines } from "./dependency-lines";
import { cn } from "@/lib/utils";

/**
 * Three-column kanban board for a single project.
 *
 * Loads features from /api/projects/:projectId/features on mount, splits
 * them by `status`, and renders a {@link FeatureCard} per feature inside
 * the matching {@link KanbanColumn}.
 *
 * Drag-and-drop (Features #47 + #48) is wired here. Each column hosts a
 * SortableContext + a useDroppable on the body so:
 *   - Dragging a card between columns updates its `status` (and persists
 *     sequential priorities in the destination column so the dropped
 *     position sticks).
 *   - Dragging within a column reorders cards and PATCHes their priority
 *     fields so the order persists across reloads / server restart.
 *
 * Verified by:
 *   - Feature #37  three-column layout
 *   - Feature #38  card displays title and priority
 *   - Feature #39  card displays dependency-count indicator
 *   - Feature #46  delete feature with confirmation
 *   - Feature #47  drag card between columns persists status
 *   - Feature #48  drag within column persists priority order
 *   - Feature #53  empty-column placeholder text
 */
type ColumnId = "backlog" | "in_progress" | "completed";

type ColumnDef = {
  id: ColumnId;
  title: string;
  emptyHint: string;
};

const COLUMNS: ColumnDef[] = [
  {
    id: "backlog",
    title: "Backlog",
    emptyHint: "No features in backlog",
  },
  {
    id: "in_progress",
    title: "In Progress",
    emptyHint: "No features in progress",
  },
  {
    id: "completed",
    title: "Completed",
    emptyHint: "No completed features yet",
  },
];

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; features: FeatureCardData[] };

/**
 * Stable sort that puts cards in the canonical "priority asc, id asc" order
 * the kanban / orchestrator both expect.
 */
function sortByPriority(features: FeatureCardData[]): FeatureCardData[] {
  return [...features].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id - b.id;
  });
}

function groupByStatus(
  features: FeatureCardData[],
): Record<ColumnId, FeatureCardData[]> {
  const grouped: Record<ColumnId, FeatureCardData[]> = {
    backlog: [],
    in_progress: [],
    completed: [],
  };
  for (const f of sortByPriority(features)) {
    if (grouped[f.status]) grouped[f.status].push(f);
  }
  return grouped;
}

/**
 * Determine which kanban column an `over` target belongs to. `over.id` is
 * either a feature id (number) when hovering another card, or the column id
 * string ("backlog" | "in_progress" | "completed") when hovering the empty
 * column body.
 */
function resolveColumnFromOver(
  overId: string | number,
  cards: FeatureCardData[],
): ColumnId | null {
  if (typeof overId === "string") {
    if (
      overId === "backlog" ||
      overId === "in_progress" ||
      overId === "completed"
    ) {
      return overId;
    }
    return null;
  }
  const found = cards.find((c) => c.id === overId);
  return found ? found.status : null;
}

export function KanbanBoard({ projectId }: { projectId: number }) {
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [addDialogStatus, setAddDialogStatus] = React.useState<
    ColumnDef["id"] | null
  >(null);
  const [detailFeatureId, setDetailFeatureId] = React.useState<number | null>(
    null,
  );
  const [activeId, setActiveId] = React.useState<number | null>(null);
  const [dragError, setDragError] = React.useState<string | null>(null);
  // Ref for the kanban grid container. Passed into <DependencyLines /> so
  // its SVG overlay can measure each card's position relative to the board
  // when drawing connector lines (Feature #52).
  const boardRef = React.useRef<HTMLDivElement>(null);

  // PointerSensor with an activation distance so a click on a card still
  // opens the detail modal - the drag only starts after the user moves the
  // pointer ≥6px while pressed.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  // Custom collision strategy that's robust for kanban with empty columns.
  // We rank candidates in this order:
  //   1. pointerWithin: if the pointer is over a droppable, use it
  //   2. rectIntersection: any droppable rect overlapping the dragged rect
  //   3. closestCorners: nearest droppable to the dragged corners
  // We also re-rank so column-id droppables (string ids) win over card-id
  // droppables (number ids) when the pointer is in an empty area of the
  // column - this lets a drag onto an empty column register correctly.
  const collisionStrategy = React.useCallback<CollisionDetection>((args) => {
    const pointer = pointerWithin(args);
    const candidates =
      pointer.length > 0 ? pointer : rectIntersection(args);
    if (candidates.length === 0) {
      return closestCorners(args);
    }
    // Prefer column droppables (string ids) over card droppables (number
    // ids) when both are present, so dropping on a column body always
    // resolves to that column even if a card happens to overlap.
    const columnHit = candidates.find((c) => typeof c.id === "string");
    if (columnHit) return [columnHit];
    return candidates;
  }, []);

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/projects/${projectId}/features`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || `Failed to load (${res.status})`);
      }
      const data = (await res.json()) as { features: FeatureCardData[] };
      setState({ kind: "ready", features: data.features ?? [] });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to load features",
      });
    }
  }, [projectId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Reload whenever the orchestrator (or another action) flips feature
  // status - e.g. start/stop buttons, agent completion events. Anyone can
  // dispatch `kanban:refresh` to ask this board to re-query the API.
  React.useEffect(() => {
    const onRefresh = () => {
      void load();
    };
    window.addEventListener("kanban:refresh", onRefresh);
    window.addEventListener("orchestrator:changed", onRefresh);
    return () => {
      window.removeEventListener("kanban:refresh", onRefresh);
      window.removeEventListener("orchestrator:changed", onRefresh);
    };
  }, [load]);

  // ----- Drag handlers -----

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const id =
      typeof event.active.id === "number"
        ? event.active.id
        : Number.parseInt(String(event.active.id), 10);
    if (Number.isFinite(id)) {
      setActiveId(id);
      setDragError(null);
    }
  }, []);

  // Update local state on dragOver so cards visually jump between columns
  // mid-drag. We do NOT persist here - that happens in dragEnd.
  const handleDragOver = React.useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = typeof active.id === "number" ? active.id : null;
    if (activeId == null) return;

    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      const cards = prev.features;
      const activeCard = cards.find((c) => c.id === activeId);
      if (!activeCard) return prev;
      const overColumn = resolveColumnFromOver(over.id, cards);
      if (!overColumn) return prev;

      // Only mutate state when crossing columns - within-column reordering
      // is handled in dragEnd to avoid jitter.
      if (activeCard.status === overColumn) return prev;

      const moved: FeatureCardData = { ...activeCard, status: overColumn };
      const without = cards.filter((c) => c.id !== activeId);
      // Insert at end of destination column for now; final position is
      // resolved in dragEnd if the drop was on a specific card.
      return { kind: "ready", features: [...without, moved] };
    });
  }, []);

  const handleDragEnd = React.useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      // eslint-disable-next-line no-console
      console.log("[kanban] dragEnd", {
        activeId: active.id,
        overId: over?.id,
        overData: over?.data?.current,
      });
      setActiveId(null);
      if (!over) return;
      const activeId = typeof active.id === "number" ? active.id : null;
      if (activeId == null) return;

      // Snapshot the pre-drop state so we can revert if the API call fails.
      let revertSnapshot: FeatureCardData[] | null = null;
      let columnAfter: ColumnId | null = null;
      let newOrderInColumn: FeatureCardData[] = [];

      setState((prev) => {
        if (prev.kind !== "ready") return prev;
        revertSnapshot = prev.features;
        const cards = prev.features;
        const activeCard = cards.find((c) => c.id === activeId);
        if (!activeCard) return prev;

        const targetColumn = resolveColumnFromOver(over.id, cards);
        if (!targetColumn) return prev;

        // Compose the new column ordering. Start from the current grouping
        // (which already reflects any cross-column move from dragOver), then
        // arrayMove within the destination column to honor the drop position.
        const grouped = groupByStatus(cards);
        const destCards = grouped[targetColumn].filter(
          (c) => c.id !== activeId,
        );
        // Make sure the active card is in the destination column.
        const movedCard: FeatureCardData = {
          ...activeCard,
          status: targetColumn,
        };

        // Where to insert? If `over.id` is a card id, insert at that card's
        // index; otherwise (column id) insert at end.
        let insertAt = destCards.length;
        if (typeof over.id === "number") {
          const idx = destCards.findIndex((c) => c.id === over.id);
          if (idx >= 0) insertAt = idx;
        }
        const reordered = [
          ...destCards.slice(0, insertAt),
          movedCard,
          ...destCards.slice(insertAt),
        ];

        // Reassign sequential priorities 0..n-1 within the destination
        // column so the new order persists. Use a base offset of 0 - other
        // columns' priorities are independent for display purposes.
        const repriorityed = reordered.map((card, i) => ({
          ...card,
          priority: i,
        }));
        newOrderInColumn = repriorityed;
        columnAfter = targetColumn;

        // Build new full feature list: cards from other columns unchanged,
        // destination column replaced with our reordered set.
        const otherColumns = cards.filter(
          (c) => c.id !== activeId && c.status !== targetColumn,
        );
        return {
          kind: "ready",
          features: [...otherColumns, ...repriorityed],
        };
      });

      // eslint-disable-next-line no-console
      console.log("[kanban] post-setState", {
        columnAfter,
        newOrderLen: newOrderInColumn.length,
        order: newOrderInColumn.map((c) => ({
          id: c.id,
          priority: c.priority,
          status: c.status,
        })),
      });

      // Persist via API. We need:
      //   - PATCH the dragged card's status (if it changed columns)
      //   - PATCH each card in the destination column with its new priority
      //
      // We always re-priority the destination column so within-column
      // reorders (Feature #48) persist as well.
      if (columnAfter == null) return;

      try {
        const movedCard = newOrderInColumn.find((c) => c.id === activeId);
        if (!movedCard) return;

        const patches: Promise<Response>[] = [];
        for (const card of newOrderInColumn) {
          const body: Record<string, unknown> = {};
          if (card.id === activeId) {
            // The dragged card may have a new status + new priority.
            body.priority = card.priority;
            body.status = card.status;
          } else {
            body.priority = card.priority;
          }
          patches.push(
            fetch(`/api/features/${card.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
          );
        }
        const results = await Promise.all(patches);
        const failed = results.find((r) => !r.ok);
        if (failed) {
          throw new Error(`Persist failed (${failed.status})`);
        }
        // Refresh from server so we pick up any orchestrator-side changes
        // and confirm the persisted ordering.
        await load();
      } catch (err) {
        setDragError(
          err instanceof Error ? err.message : "Failed to save changes",
        );
        // Revert optimistic state.
        if (revertSnapshot) {
          setState({ kind: "ready", features: revertSnapshot });
        }
      }
    },
    [load],
  );

  const handleDragCancel = React.useCallback(() => {
    setActiveId(null);
    // Re-fetch to undo any optimistic dragOver state.
    void load();
  }, [load]);

  // ----- Render -----

  if (state.kind === "loading") {
    return (
      <div
        data-testid="kanban-board-loading"
        className="flex h-full items-center justify-center px-6 py-4 text-sm text-muted-foreground"
      >
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading features…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div
        data-testid="kanban-board-error"
        role="alert"
        className="m-6 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden="true" />
        <div>
          <p className="font-medium">Could not load features</p>
          <p className="text-xs opacity-90">{state.message}</p>
        </div>
      </div>
    );
  }

  const grouped = groupByStatus(state.features);
  const activeCard = activeId
    ? state.features.find((c) => c.id === activeId) ?? null
    : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionStrategy}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          ref={boardRef}
          data-testid="kanban-board"
          data-project-id={projectId}
          data-feature-count={state.features.length}
          // Mobile + tablet + small desktop: horizontal scrolling flex row so
          // each 280px column stays usable even when the sidebar eats most of
          // the viewport. From xl (1280px) up: grid with three equal columns
          // side-by-side - at that width the main area is ~992px which is the
          // first breakpoint that fits 3 * 280px + gaps without overlap.
          //
          // `relative` establishes a positioning context for the SVG overlay
          // that draws dependency connector lines between cards (Feature #52).
          className="relative flex h-full gap-4 overflow-x-auto px-6 py-4 xl:grid xl:grid-cols-3 xl:overflow-visible"
        >
          {COLUMNS.map((col) => {
            const items = grouped[col.id];
            return (
              <DroppableColumn
                key={col.id}
                col={col}
                items={items}
                onAdd={() => setAddDialogStatus(col.id)}
                onOpen={(id) => setDetailFeatureId(id)}
              />
            );
          })}
          {/*
            Feature #52: overlay SVG that draws connector lines between
            features with dependencies. Rendered last so it sits on top of
            the columns; `pointer-events: none` is applied inside the
            component so it never blocks card clicks or drags.
          */}
          <DependencyLines
            containerRef={boardRef}
            features={state.features}
            draggingId={activeId}
          />
        </div>

        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <div data-testid="kanban-drag-overlay">
              <FeatureCard feature={activeCard} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {dragError && (
        <p
          role="alert"
          data-testid="kanban-drag-error"
          className="mx-6 mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {dragError}
        </p>
      )}

      <AddFeatureDialog
        open={addDialogStatus !== null}
        onOpenChange={(o) => {
          if (!o) setAddDialogStatus(null);
        }}
        projectId={projectId}
        initialStatus={addDialogStatus ?? "backlog"}
        onCreated={() => {
          setAddDialogStatus(null);
          void load();
        }}
      />

      <FeatureDetailDialog
        open={detailFeatureId !== null}
        featureId={detailFeatureId}
        projectId={projectId}
        allFeatures={state.features}
        onOpenChange={(o) => {
          if (!o) setDetailFeatureId(null);
        }}
        onSaved={() => {
          void load();
        }}
        onDeleted={() => {
          // Re-fetch the feature list after delete (Feature #46) so the
          // deleted card immediately disappears from its column. Closing
          // the modal is handled inside the detail dialog itself.
          void load();
        }}
      />
    </>
  );
}

/**
 * Single column rendered with both a SortableContext (so cards inside it
 * are sortable) and a useDroppable on the column body (so drops on the
 * empty column area are detected). Lives inline in this file because it
 * binds tightly to the kanban-board's DnD plumbing.
 */
function DroppableColumn({
  col,
  items,
  onAdd,
  onOpen,
}: {
  col: ColumnDef;
  items: FeatureCardData[];
  onAdd: () => void;
  onOpen: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const itemIds = React.useMemo(() => items.map((i) => i.id), [items]);

  return (
    <KanbanColumn
      id={col.id}
      title={col.title}
      emptyHint={col.emptyHint}
      count={items.length}
      onAdd={onAdd}
      bodyRef={setNodeRef}
      bodyClassName={cn(
        // Highlight column body while a card is being dragged over it so
        // the drop target is obvious.
        isOver && "bg-primary/5 ring-1 ring-primary/30",
      )}
    >
      <SortableContext
        items={itemIds}
        strategy={verticalListSortingStrategy}
      >
        {items.map((f) => (
          <SortableFeatureCard key={f.id} feature={f} onOpen={onOpen} />
        ))}
      </SortableContext>
    </KanbanColumn>
  );
}

