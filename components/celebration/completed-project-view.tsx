"use client";

import * as React from "react";

import { CelebrationScreen } from "./celebration-screen";
import { KanbanBoard } from "@/components/kanban/kanban-board";

/**
 * Client wrapper around the celebration screen + kanban for a project whose
 * status is `completed`. Defaults to showing the celebration; the user can
 * click "View kanban" to hide the celebration locally and inspect the board.
 *
 * We keep this state entirely client-side — the database record stays
 * `status = "completed"` so refreshing the page brings the celebration back
 * (the user is meant to marvel at their finished work, not make it vanish
 * forever).
 */
export function CompletedProjectView({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const [showKanban, setShowKanban] = React.useState(false);

  if (showKanban) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div
          data-testid="completed-banner"
          className="flex items-center justify-between gap-3 border-b border-border bg-primary/10 px-6 py-2 text-xs text-foreground"
        >
          <span>
            Project marked <strong className="font-semibold">complete</strong> —
            every feature is done.
          </span>
          <button
            data-testid="show-celebration-button"
            type="button"
            className="rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
            onClick={() => setShowKanban(false)}
          >
            Show celebration
          </button>
        </div>
        <KanbanBoard projectId={projectId} />
      </div>
    );
  }

  return (
    <CelebrationScreen
      projectId={projectId}
      projectName={projectName}
      onDismiss={() => setShowKanban(true)}
    />
  );
}
