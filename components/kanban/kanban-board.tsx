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
import {
  FeatureCard,
  FeatureNumbersProvider,
  type FeatureCardData,
} from "./feature-card";
import { SortableFeatureCard } from "./sortable-feature-card";
import { AddFeatureDialog } from "./add-feature-dialog";
import { FeatureDetailDialog } from "./feature-detail-dialog";
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

  // Ref mirror of `state` so synchronous drag handlers can read the current
  // feature list without depending on React's setState updater scheduling
  // (React 19 may defer updater functions, breaking closure-based reads).
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);
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

  // Custom collision strategy that's robust for kanban with empty columns
  // AND within-column reordering. The decision tree:
  //   1. If pointerWithin finds any card-id (number) target, prefer that -
  //      this lets within-column drag-to-reorder work because the over.id
  //      identifies the card we're inserting before.
  //   2. Otherwise, if pointerWithin found a column-id (string) target,
  //      use that - this handles the empty-column drop case.
  //   3. Fall back to rectIntersection / closestCorners for the rare case
  //      the pointer is outside all droppables (e.g. fast drags).
  const collisionStrategy = React.useCallback<CollisionDetection>((args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) {
      const cardHit = pointer.find((c) => typeof c.id === "number");
      if (cardHit) return [cardHit];
      return pointer;
    }
    const intersect = rectIntersection(args);
    if (intersect.length > 0) {
      const cardHit = intersect.find((c) => typeof c.id === "number");
      if (cardHit) return [cardHit];
      return intersect;
    }
    return closestCorners(args);
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
  // mid-drag. We do NOT persist here - that happens in dragEnd. We compute
  // the next state synchronously from `stateRef` (rather than via a
  // setState updater) because React 19 may schedule updater functions to
  // run later, which would break our visual feedback.
  const handleDragOver = React.useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeIdLocal = typeof active.id === "number" ? active.id : null;
    if (activeIdLocal == null) return;

    const prev = stateRef.current;
    if (prev.kind !== "ready") return;
    const cards = prev.features;
    const activeCard = cards.find((c) => c.id === activeIdLocal);
    if (!activeCard) return;
    const overColumn = resolveColumnFromOver(over.id, cards);
    if (!overColumn) return;

    // Only mutate state when crossing columns - within-column reordering
    // is handled in dragEnd to avoid jitter.
    if (activeCard.status === overColumn) return;

    const moved: FeatureCardData = { ...activeCard, status: overColumn };
    const without = cards.filter((c) => c.id !== activeIdLocal);
    // Insert at end of destination column for now; final position is
    // resolved in dragEnd if the drop was on a specific card.
    setState({ kind: "ready", features: [...without, moved] });
  }, []);

  const handleDragEnd = React.useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      if (!over) return;
      const activeIdLocal =
        typeof active.id === "number" ? active.id : null;
      if (activeIdLocal == null) return;

      // We need to know the current feature list synchronously to:
      //   (a) decide what the new ordering should be
      //   (b) snapshot a revert state
      //   (c) issue PATCH requests
      //
      // React 19 may schedule functional `setState` updaters asynchronously,
      // so we cannot rely on a closure variable assigned inside an updater
      // being populated by the time we run our PATCH logic. Instead we read
      // the current state via a ref and compute the new ordering up-front.
      const prev = stateRef.current;
      if (prev.kind !== "ready") return;
      const cards = prev.features;
      const activeCard = cards.find((c) => c.id === activeIdLocal);
      if (!activeCard) return;
      const targetColumn = resolveColumnFromOver(over.id, cards);
      if (!targetColumn) return;

      // Compose the new column ordering. Start from the current grouping,
      // remove the dragged card from its (possibly old) column, then insert
      // it into the destination column at the correct index.
      const grouped = groupByStatus(cards);
      const destCards = grouped[targetColumn].filter(
        (c) => c.id !== activeIdLocal,
      );
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
      // Reassign sequential priorities 0..n-1 within the destination column
      // so the dropped position sticks across reload (Features #47 + #48).
      const newOrderInColumn = reordered.map((card, i) => ({
        ...card,
        priority: i,
      }));

      // Snapshot revert state and apply optimistic update.
      const revertSnapshot = cards;
      const otherColumns = cards.filter(
        (c) => c.id !== activeIdLocal && c.status !== targetColumn,
      );
      const nextFeatures = [...otherColumns, ...newOrderInColumn];
      setState({ kind: "ready", features: nextFeatures });

      // Persist: PATCH the dragged card (status + priority) and any other
      // cards in the destination column whose priority changed.
      try {
        const patches: Promise<Response>[] = [];
        for (const card of newOrderInColumn) {
          const body: Record<string, unknown> = {};
          if (card.id === activeIdLocal) {
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
        setState({ kind: "ready", features: revertSnapshot });
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

  // Build a per-project 1-based number map so cards/dialogs display a stable
  // "feature N" instead of the shared-autoincrement DB id. Sorted by id asc
  // so numbers track creation order within the project.
  const featureNumbers = new Map<number, number>();
  [...state.features]
    .sort((a, b) => a.id - b.id)
    .forEach((f, i) => featureNumbers.set(f.id, i + 1));

  return (
    <FeatureNumbersProvider value={featureNumbers}>
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
    </FeatureNumbersProvider>
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

