"use client";

import { KanbanColumn } from "./kanban-column";

/**
 * Three-column kanban board for a single project.
 *
 * Verified by Feature #37. Future features will populate each column with
 * feature cards loaded from /api/projects/:id/features and wire up
 * drag-and-drop via @dnd-kit. For now the columns render their headers,
 * an empty state per column, and consistent containers for cards.
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
    emptyHint: "Add features or let the AI bootstrapper generate them.",
  },
  {
    id: "in_progress",
    title: "In Progress",
    emptyHint: "Start the orchestrator to begin work.",
  },
  {
    id: "completed",
    title: "Completed",
    emptyHint: "Finished features will appear here.",
  },
];

export function KanbanBoard({ projectId }: { projectId: number }) {
  return (
    <div
      data-testid="kanban-board"
      data-project-id={projectId}
      // On mobile: horizontal scrolling flex row. From md up: grid with
      // three equal columns side-by-side (desktop kanban layout).
      className="flex h-full gap-4 overflow-x-auto px-6 py-4 md:grid md:grid-cols-3 md:overflow-visible"
    >
      {COLUMNS.map((col) => (
        <KanbanColumn
          key={col.id}
          id={col.id}
          title={col.title}
          emptyHint={col.emptyHint}
        />
      ))}
    </div>
  );
}
