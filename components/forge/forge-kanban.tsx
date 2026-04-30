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

import { Trash2 } from "lucide-react";

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
  selectMode,
  selected,
}: {
  feature: FeatureCardData;
  isDragging?: boolean;
  isRunning?: boolean;
  featureNumber?: number | null;
  onClick?: () => void;
  /** ENH-004 broader: when true, render a checkbox overlay and treat
   *  clicks as selection toggles rather than detail-open events. */
  selectMode?: boolean;
  selected?: boolean;
}) {
  const tr = feature.testResult ?? null;

  return (
    <div
      className={
        "card" +
        (isRunning ? " running" : "") +
        (isDragging ? " dragging" : "") +
        (selectMode && selected ? " selected" : "")
      }
      data-testid={`feature-card-${feature.id}`}
      data-feature-id={feature.id}
      data-status={feature.status}
      data-priority={feature.priority}
      data-selected={selectMode && selected ? "true" : undefined}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={
        onClick
          ? selectMode
            ? `${selected ? "Deselect" : "Select"} feature: ${feature.title}`
            : `Open feature: ${feature.title}`
          : undefined
      }
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
      {selectMode && (
        <span
          className="card-checkbox"
          data-testid={`feature-card-checkbox-${feature.id}`}
          aria-hidden="true"
        >
          {selected ? "☑" : "☐"}
        </span>
      )}
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
  selectMode,
  selected,
  onToggleSelect,
}: {
  feature: FeatureCardData;
  featureNumber?: number | null;
  onOpen?: (id: number) => void;
  /** ENH-004 broader: when true, swap the card's click target from
   *  detail-open to selection-toggle, and disable drag so dnd-kit
   *  doesn't intercept clicks on the checkbox. */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
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
    disabled: selectMode,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // In select mode, route the card click to the selection toggle
  // instead of opening the detail dialog. Outside select mode we keep
  // the original detail-open behaviour.
  const clickHandler = selectMode
    ? onToggleSelect
      ? () => onToggleSelect(feature.id)
      : undefined
    : onOpen
      ? () => onOpen(feature.id)
      : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`sortable-feature-card-${feature.id}`}
      data-dragging={isDragging ? "true" : "false"}
      data-feature-card-anchor={feature.id}
      className="touch-none"
      {...(selectMode ? {} : attributes)}
      {...(selectMode ? {} : listeners)}
    >
      <ForgeCard
        feature={feature}
        isDragging={isDragging}
        isRunning={feature.status === "in_progress"}
        featureNumber={featureNumber}
        onClick={clickHandler}
        selectMode={selectMode}
        selected={selected}
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
  onClearCompleted,
  selectMode,
  selectedIds,
  onToggleSelect,
}: {
  col: ColumnDef;
  items: FeatureCardData[];
  featureNumbers: Map<number, number>;
  filter: string;
  onAdd: () => void;
  onOpen: (id: number) => void;
  /**
   * Render a destructive "Clear" button in the column header (ENH-004).
   * Only honoured for the Completed column and only when the column has
   * at least one card. The parent owns the confirmation prompt and the
   * delete logic.
   */
  onClearCompleted?: () => void;
  /** ENH-004 broader: forwarded to each card so they can render their
   *  selection state and toggle on click while bulk-select mode is on. */
  selectMode?: boolean;
  selectedIds?: ReadonlySet<number>;
  onToggleSelect?: (id: number) => void;
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
        {col.id === "completed" && onClearCompleted && items.length > 0 && (
          <button
            type="button"
            onClick={onClearCompleted}
            data-testid={`kanban-column-clear-${col.id}`}
            aria-label={`Delete all ${items.length} completed ${
              items.length === 1 ? "feature" : "features"
            }`}
            title="Delete every card in this column"
            className="col-clear"
          >
            <Trash2 size={11} aria-hidden="true" />
            Clear
          </button>
        )}
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
                selectMode={selectMode}
                selected={selectedIds?.has(f.id) ?? false}
                onToggleSelect={onToggleSelect}
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
  // Guard against concurrent runs of `handleClearCompleted` if the user
  // clicks the "Clear" button repeatedly before the first batch of DELETEs
  // resolves. Without this, each click fires a fresh batch against the
  // same ids and surfaces misleading 404 errors from the second wave.
  const clearCompletedInFlightRef = React.useRef(false);

  // ENH-004 broader: bulk-select mode. When `selectMode` is true cards
  // gain a checkbox overlay and clicking toggles selection instead of
  // opening the detail dialog; drag is disabled so the user can tap
  // checkboxes freely without dnd-kit intercepting the click. Confirming
  // the sticky action bar fires N parallel DELETE /api/features/:id
  // requests through the existing single-feature endpoint — same shape
  // as `handleClearCompleted`, no new server endpoint needed.
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(
    () => new Set<number>(),
  );
  const bulkDeleteInFlightRef = React.useRef(false);

  const toggleSelectMode = React.useCallback(() => {
    setSelectMode((on) => {
      if (on) {
        // Leaving select mode — drop any pending selection so reopening
        // doesn't resurrect a stale set.
        setSelectedIds(new Set<number>());
      }
      return !on;
    });
  }, []);

  const toggleSelectedId = React.useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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

  /**
   * ENH-004 — bulk-delete every card in the Completed column. Cheap reset
   * for users who want to redo a project (especially during testing or
   * iteration). Confirms via window.confirm to avoid an accidental wipe,
   * then fires N parallel single-feature DELETEs through the existing API
   * so we don't need a new bulk endpoint. On success we re-fetch the
   * feature list; on partial failure we surface the first error and still
   * re-fetch so the UI reflects whatever did get deleted.
   */
  const handleClearCompleted = React.useCallback(async () => {
    if (state.kind !== "ready") return;
    if (clearCompletedInFlightRef.current) return;
    const completedIds = state.features
      .filter((f) => f.status === "completed")
      .map((f) => f.id);
    if (completedIds.length === 0) return;
    const confirmed = window.confirm(
      `Delete all ${completedIds.length} completed ${
        completedIds.length === 1 ? "feature" : "features"
      }? This cannot be undone.`,
    );
    if (!confirmed) return;
    clearCompletedInFlightRef.current = true;
    setDragError(null);
    try {
      const results = await Promise.allSettled(
        completedIds.map((id) =>
          fetch(`/api/features/${id}`, { method: "DELETE" }).then(
            async (res) => {
              if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                  error?: string;
                };
                throw new Error(data.error || `Delete failed (${res.status})`);
              }
            },
          ),
        ),
      );
      const firstFailure = results.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (firstFailure) {
        setDragError(
          firstFailure.reason instanceof Error
            ? firstFailure.reason.message
            : "Failed to clear some completed features",
        );
      }
      await load();
    } finally {
      clearCompletedInFlightRef.current = false;
    }
  }, [state, load]);

  /**
   * ENH-004 broader: delete every currently-selected card. Same delete-
   * then-refresh shape as `handleClearCompleted` — re-entrancy guarded,
   * confirm naming the count, parallel DELETEs via Promise.allSettled,
   * first failure surfaced through `dragError`. Also exits select mode
   * after a successful run so the user is back in the regular drag
   * flow.
   */
  const handleBulkDelete = React.useCallback(async () => {
    if (state.kind !== "ready") return;
    if (bulkDeleteInFlightRef.current) return;
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const confirmed = window.confirm(
      `Delete ${ids.length} selected ${
        ids.length === 1 ? "feature" : "features"
      }? This cannot be undone.`,
    );
    if (!confirmed) return;
    bulkDeleteInFlightRef.current = true;
    setDragError(null);
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/features/${id}`, { method: "DELETE" }).then(
            async (res) => {
              if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                  error?: string;
                };
                throw new Error(data.error || `Delete failed (${res.status})`);
              }
            },
          ),
        ),
      );
      const firstFailure = results.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (firstFailure) {
        setDragError(
          firstFailure.reason instanceof Error
            ? firstFailure.reason.message
            : "Failed to delete some selected features",
        );
      }
      setSelectedIds(new Set<number>());
      setSelectMode(false);
      await load();
    } finally {
      bulkDeleteInFlightRef.current = false;
    }
  }, [state, selectedIds, load]);

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
            {/* ENH-004 broader: bulk-select toggle. Off → cards open the
                detail dialog on click and drag normally. On → cards show
                a checkbox, clicking toggles selection, drag is disabled,
                and the sticky bar at the bottom of the section appears
                once at least one card is selected. */}
            <button
              type="button"
              className={"btn sm" + (selectMode ? " primary" : "")}
              onClick={toggleSelectMode}
              data-testid="forge-kanban-select-toggle"
              data-select-mode={selectMode ? "true" : "false"}
              aria-pressed={selectMode ? "true" : "false"}
            >
              {selectMode ? "Done" : "Select"}
            </button>
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
                onClearCompleted={
                  col.id === "completed" ? handleClearCompleted : undefined
                }
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelectedId}
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

        {/* ENH-004 broader: sticky action bar. Visible only while
            select mode is on AND at least one card has been selected.
            Sits inside the `.board-section` so it stays anchored to the
            kanban view and doesn't follow the user when they scroll into
            the agent pods area above. */}
        {selectMode && selectedIds.size > 0 && (
          <div
            className="fkb-select-bar"
            data-testid="forge-kanban-bulk-bar"
            role="region"
            aria-label="Bulk selection actions"
          >
            <span className="fkb-select-count">
              {selectedIds.size} selected
            </span>
            <div className="fkb-select-bar-actions">
              <button
                type="button"
                className="btn sm"
                onClick={toggleSelectMode}
                data-testid="forge-kanban-bulk-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn sm danger"
                onClick={handleBulkDelete}
                data-testid="forge-kanban-bulk-delete"
                aria-label={`Delete ${selectedIds.size} selected ${
                  selectedIds.size === 1 ? "feature" : "features"
                }`}
              >
                Delete {selectedIds.size} selected
              </button>
            </div>
          </div>
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
