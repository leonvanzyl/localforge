"use client";

import * as React from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  closestCorners,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { SearchIcon } from "@/components/forge/icons";
import {
  FeatureNumbersProvider,
  type FeatureCardData,
} from "@/components/kanban/feature-card";
import { AddFeatureDialog } from "@/components/kanban/add-feature-dialog";
import { FeatureDetailDialog } from "@/components/kanban/feature-detail-dialog";

/* ------------------------------------------------------------------ */
/*  Types & constants                                                  */
/* ------------------------------------------------------------------ */

type ColumnId = "backlog" | "in_progress" | "completed";

type ColumnDef = {
  id: ColumnId;
  title: string;
  emptyHint: string;
};

const COLUMNS: ColumnDef[] = [
  { id: "backlog", title: "Backlog", emptyHint: "No features in backlog" },
  { id: "in_progress", title: "In Progress", emptyHint: "No features in progress" },
  { id: "completed", title: "Completed", emptyHint: "No completed features yet" },
];

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; features: FeatureCardData[] };

/* ------------------------------------------------------------------ */
/*  Helpers (same logic as kanban-board.tsx)                            */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  ForgeCard - a single card styled with the warm workshop classes     */
/* ------------------------------------------------------------------ */

function ForgeCard({
  feature,
  isDragging,
  isRunning,
  featureNumber,
  onClick,
}: {
  feature: FeatureCardData;
  isDragging?: boolean;
  isRunning?: boolean;
  featureNumber?: number | null;
  onClick?: () => void;
}) {
  const tr = feature.testResult ?? null;

  return (
    <div
      className={
        "card" +
        (isRunning ? " running" : "") +
        (isDragging ? " dragging" : "")
      }
      data-testid={`feature-card-${feature.id}`}
      data-feature-id={feature.id}
      data-status={feature.status}
      data-priority={feature.priority}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="card-title">{feature.title}</div>
      <div className="card-meta">
        <span className="tag">
          #{featureNumber ?? feature.id}
        </span>
        <span className="tag">{feature.category}</span>
        {tr && (
          <span
            data-testid={`feature-card-test-result-${feature.id}`}
            data-test-ok={tr.ok ? "true" : "false"}
            data-tests-passed={tr.passed}
            data-tests-failed={tr.failed}
            style={{ color: tr.ok ? "var(--good)" : "var(--bad)" }}
          >
            {tr.ok ? "✓" : "✗"} {tr.passed}/{tr.total}
          </span>
        )}
        {feature.dependencyCount > 0 && (
          <span
            data-testid={`feature-card-deps-${feature.id}`}
            data-dependency-count={feature.dependencyCount}
            style={{ color: "var(--warn)" }}
          >
            ⛓ {feature.dependencyCount}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SortableForgeCard - wraps ForgeCard with dnd-kit sortable          */
/* ------------------------------------------------------------------ */

function SortableForgeCard({
  feature,
  featureNumber,
  onOpen,
}: {
  feature: FeatureCardData;
  featureNumber?: number | null;
  onOpen?: (id: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: feature.id,
    data: { feature },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`sortable-feature-card-${feature.id}`}
      data-dragging={isDragging ? "true" : "false"}
      data-feature-card-anchor={feature.id}
      className="touch-none"
      {...attributes}
      {...listeners}
    >
      <ForgeCard
        feature={feature}
        isDragging={isDragging}
        isRunning={feature.status === "in_progress"}
        featureNumber={featureNumber}
        onClick={onOpen ? () => onOpen(feature.id) : undefined}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DroppableForgeColumn - column with the warm workshop classes        */
/* ------------------------------------------------------------------ */

function DroppableForgeColumn({
  col,
  items,
  featureNumbers,
  filter,
  onAdd,
  onOpen,
}: {
  col: ColumnDef;
  items: FeatureCardData[];
  featureNumbers: Map<number, number>;
  filter: string;
  onAdd: () => void;
  onOpen: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });

  const filtered = React.useMemo(() => {
    if (!filter) return items;
    const q = filter.toLowerCase();
    return items.filter(
      (f) =>
        f.title.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q),
    );
  }, [items, filter]);

  const itemIds = React.useMemo(() => filtered.map((i) => i.id), [filtered]);

  return (
    <div
      className={"col" + (isOver ? " drag-over" : "")}
      data-col={col.id}
      data-testid={`kanban-column-${col.id}`}
      data-column-id={col.id}
      data-count={items.length}
    >
      <div className="col-head">
        <div className="col-title">
          <span className="t">{col.title}</span>
          <span className="c">{items.length}</span>
        </div>
      </div>
      <div className="col-body" ref={setNodeRef}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {filtered.length === 0 ? (
            <p
              data-testid={`kanban-column-empty-${col.id}`}
              style={{
                textAlign: "center",
                color: "var(--ink-3)",
                fontFamily: "'Caveat', cursive",
                fontSize: "15px",
                padding: "24px 8px",
              }}
            >
              {filter ? "No matching cards" : col.emptyHint}
            </p>
          ) : (
            filtered.map((f) => (
              <SortableForgeCard
                key={f.id}
                feature={f}
                featureNumber={featureNumbers.get(f.id) ?? null}
                onOpen={onOpen}
              />
            ))
          )}
        </SortableContext>
        {col.id === "backlog" && (
          <div
            className="add-card"
            onClick={onAdd}
            data-testid={`kanban-column-add-${col.id}`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onAdd();
              }
            }}
          >
            + add feature
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ForgeKanban - the main board component                             */
/* ------------------------------------------------------------------ */

export function ForgeKanban({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName?: string;
}) {
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [filter, setFilter] = React.useState("");
  const [addDialogStatus, setAddDialogStatus] = React.useState<ColumnId | null>(
    null,
  );
  const [detailFeatureId, setDetailFeatureId] = React.useState<number | null>(
    null,
  );
  const [activeId, setActiveId] = React.useState<number | null>(null);
  const [dragError, setDragError] = React.useState<string | null>(null);

  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

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

  /* --- Data loading --- */

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

  /* --- Drag handlers --- */

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

    if (activeCard.status === overColumn) return;

    const moved: FeatureCardData = { ...activeCard, status: overColumn };
    const without = cards.filter((c) => c.id !== activeIdLocal);
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

      const prev = stateRef.current;
      if (prev.kind !== "ready") return;
      const cards = prev.features;
      const activeCard = cards.find((c) => c.id === activeIdLocal);
      if (!activeCard) return;
      const targetColumn = resolveColumnFromOver(over.id, cards);
      if (!targetColumn) return;

      const grouped = groupByStatus(cards);
      const destCards = grouped[targetColumn].filter(
        (c) => c.id !== activeIdLocal,
      );
      const movedCard: FeatureCardData = {
        ...activeCard,
        status: targetColumn,
      };
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
      const newOrderInColumn = reordered.map((card, i) => ({
        ...card,
        priority: i,
      }));

      const revertSnapshot = cards;
      const otherColumns = cards.filter(
        (c) => c.id !== activeIdLocal && c.status !== targetColumn,
      );
      const nextFeatures = [...otherColumns, ...newOrderInColumn];
      setState({ kind: "ready", features: nextFeatures });

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
        await load();
      } catch (err) {
        setDragError(
          err instanceof Error ? err.message : "Failed to save changes",
        );
        setState({ kind: "ready", features: revertSnapshot });
      }
    },
    [load],
  );

  const handleDragCancel = React.useCallback(() => {
    setActiveId(null);
    void load();
  }, [load]);

  /* --- Render --- */

  if (state.kind === "loading") {
    return (
      <section className="board-section" data-testid="kanban-board-loading">
        <div className="board-head">
          <h2 className="board-title">
            {projectName ?? "Project"} &middot; <em>kanban</em>
          </h2>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            color: "var(--ink-3)",
            fontFamily: "'Caveat', cursive",
            fontSize: "18px",
          }}
        >
          Loading features...
        </div>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="board-section" data-testid="kanban-board-error">
        <div className="board-head">
          <h2 className="board-title">
            {projectName ?? "Project"} &middot; <em>kanban</em>
          </h2>
        </div>
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            color: "var(--bad)",
            fontFamily: "'Inter', sans-serif",
            fontSize: "14px",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <div>
            <p style={{ fontWeight: 600 }}>Could not load features</p>
            <p style={{ fontSize: "12px", opacity: 0.85, marginTop: "4px" }}>
              {state.message}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const grouped = groupByStatus(state.features);
  const activeCard = activeId
    ? state.features.find((c) => c.id === activeId) ?? null
    : null;

  const featureNumbers = new Map<number, number>();
  [...state.features]
    .sort((a, b) => a.id - b.id)
    .forEach((f, i) => featureNumbers.set(f.id, i + 1));

  return (
    <FeatureNumbersProvider value={featureNumbers}>
      <section className="board-section" data-testid="forge-kanban">
        <div className="board-head">
          <h2 className="board-title">
            {projectName ?? "Project"} &middot; <em>kanban</em>
          </h2>
          <div className="board-actions">
            <div className="search-box">
              <SearchIcon size={13} />
              <input
                placeholder="filter cards"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                data-testid="forge-kanban-filter"
              />
            </div>
          </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={collisionStrategy}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div
            className="board"
            data-testid="kanban-board"
            data-project-id={projectId}
            data-feature-count={state.features.length}
          >
            {COLUMNS.map((col) => (
              <DroppableForgeColumn
                key={col.id}
                col={col}
                items={grouped[col.id]}
                featureNumbers={featureNumbers}
                filter={filter}
                onAdd={() => setAddDialogStatus(col.id)}
                onOpen={(id) => setDetailFeatureId(id)}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeCard ? (
              <div data-testid="kanban-drag-overlay">
                <ForgeCard
                  feature={activeCard}
                  featureNumber={featureNumbers.get(activeCard.id) ?? null}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {dragError && (
          <p
            role="alert"
            data-testid="kanban-drag-error"
            style={{
              color: "var(--bad)",
              fontSize: "13px",
              marginTop: "8px",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {dragError}
          </p>
        )}
      </section>

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
          void load();
        }}
      />
    </FeatureNumbersProvider>
  );
}

export default ForgeKanban;
