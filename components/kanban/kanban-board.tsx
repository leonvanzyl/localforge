"use client";

import * as React from "react";
import { Loader2, AlertTriangle } from "lucide-react";

import { KanbanColumn } from "./kanban-column";
import { FeatureCard, type FeatureCardData } from "./feature-card";
import { AddFeatureDialog } from "./add-feature-dialog";
import { FeatureDetailDialog } from "./feature-detail-dialog";

/**
 * Three-column kanban board for a single project.
 *
 * Loads features from /api/projects/:projectId/features on mount, splits
 * them by `status`, and renders a {@link FeatureCard} per feature inside
 * the matching {@link KanbanColumn}.
 *
 * Verified by:
 *   - Feature #37  three-column layout
 *   - Feature #38  card displays title and priority
 *   - Feature #39  card displays dependency-count indicator
 *   - Feature #53  empty-column placeholder text
 */
type ColumnDef = {
  id: "backlog" | "in_progress" | "completed";
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

export function KanbanBoard({ projectId }: { projectId: number }) {
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [addDialogStatus, setAddDialogStatus] = React.useState<
    ColumnDef["id"] | null
  >(null);
  const [detailFeatureId, setDetailFeatureId] = React.useState<number | null>(
    null,
  );

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

  const grouped: Record<ColumnDef["id"], FeatureCardData[]> = {
    backlog: [],
    in_progress: [],
    completed: [],
  };
  for (const f of state.features) {
    if (grouped[f.status]) grouped[f.status].push(f);
  }

  return (
    <>
      <div
        data-testid="kanban-board"
        data-project-id={projectId}
        data-feature-count={state.features.length}
        // Mobile + tablet + small desktop: horizontal scrolling flex row so
        // each 280px column stays usable even when the sidebar eats most of
        // the viewport. From xl (1280px) up: grid with three equal columns
        // side-by-side - at that width the main area is ~992px which is the
        // first breakpoint that fits 3 * 280px + gaps without overlap.
        className="flex h-full gap-4 overflow-x-auto px-6 py-4 xl:grid xl:grid-cols-3 xl:overflow-visible"
      >
        {COLUMNS.map((col) => {
          const items = grouped[col.id];
          return (
            <KanbanColumn
              key={col.id}
              id={col.id}
              title={col.title}
              emptyHint={col.emptyHint}
              count={items.length}
              onAdd={() => setAddDialogStatus(col.id)}
            >
              {items.map((f) => (
                <FeatureCard
                  key={f.id}
                  feature={f}
                  onOpen={(id) => setDetailFeatureId(id)}
                />
              ))}
            </KanbanColumn>
          );
        })}
      </div>

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
      />
    </>
  );
}
