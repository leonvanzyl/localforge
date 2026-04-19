"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Lightweight SSE listener that watches for a project_completed event on the
 * global orchestrator stream. When the event arrives for our project we call
 * `router.refresh()` so the server component re-runs, sees the newly-flipped
 * project status, and swaps the kanban for the celebration screen.
 *
 * Mounted on every project page (even ones that are already completed) —
 * cheap because EventSource is idle when no events flow, and this way a user
 * who leaves the tab open while the agent finishes the last feature gets an
 * instant update without a manual reload.
 */
export function CelebrationListener({ projectId }: { projectId: number }) {
  const router = useRouter();

  React.useEffect(() => {
    const es = new EventSource("/api/agent/events");

    const onCompleted = (raw: MessageEvent) => {
      try {
        const data = JSON.parse(raw.data) as {
          type?: string;
          projectId?: number;
        };
        if (data.type === "project_completed" && data.projectId === projectId) {
          router.refresh();
        }
      } catch {
        /* malformed events ignored */
      }
    };
    es.addEventListener("project_completed", onCompleted as EventListener);

    return () => {
      es.removeEventListener(
        "project_completed",
        onCompleted as EventListener,
      );
      es.close();
    };
  }, [projectId, router]);

  return null;
}
