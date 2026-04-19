"use client";

import * as React from "react";
import { toast, Toaster } from "sonner";

/**
 * Global orchestrator notification listener + Sonner <Toaster />
 * (Feature #80 "Toast on feature completion", Feature #81 "Toast on feature
 * failure").
 *
 * Mounted once at the app-shell layer. Opens a single EventSource against
 * `/api/agent/events` that receives orchestrator events for every running
 * session regardless of which project page the user is on. When a session
 * reaches a terminal `status` event we surface a green success toast for
 * `completed` and a red destructive toast for `failed` - each includes the
 * feature name so the user knows what just happened.
 *
 * UX:
 *   - 5s auto-dismiss (spec step 4)
 *   - dedicated close button (X) on each toast
 *   - clicking anywhere on the toast body also dismisses immediately
 *     (spec step 5 — implemented via a document-level delegated click
 *     handler that looks up the `[data-sonner-toast]` the click hit).
 */

type StatusEvent = {
  type: "status";
  sessionId: number;
  featureId: number | null;
  sessionStatus: "in_progress" | "completed" | "failed" | "terminated";
  featureName?: string;
};

export function AgentNotifications() {
  // Track which session status transitions we've already toasted so the SSE
  // reconnect (or replay) doesn't fire duplicates.
  const toastedRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    const es = new EventSource("/api/agent/events");

    es.addEventListener("status", (raw) => {
      try {
        const data = JSON.parse((raw as MessageEvent).data) as StatusEvent;
        const key = `${data.sessionId}:${data.sessionStatus}`;
        if (toastedRef.current.has(key)) return;
        if (
          data.sessionStatus !== "completed" &&
          data.sessionStatus !== "failed"
        ) {
          return;
        }
        toastedRef.current.add(key);
        const name = data.featureName
          ? `"${data.featureName}"`
          : `feature #${data.featureId ?? "?"}`;

        if (data.sessionStatus === "completed") {
          toast.success(`Completed: ${name}`, {
            id: `session-${data.sessionId}-completed`,
            duration: 5000,
            closeButton: true,
          });
        } else {
          toast.error(`Failed: ${name}`, {
            id: `session-${data.sessionId}-failed`,
            description:
              "The agent returned an error - feature demoted to backlog.",
            duration: 5000,
            closeButton: true,
          });
        }
      } catch {
        /* ignore malformed events */
      }
    });

    return () => {
      es.close();
    };
  }, []);

  // Click-to-dismiss: Sonner doesn't dismiss on body click by default. We
  // delegate from document and dismiss any toast whose surface was clicked
  // (excluding clicks on the built-in close button, which already dismiss).
  React.useEffect(() => {
    function onDocumentClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // If the user clicked the explicit close button, Sonner handles it.
      if (target.closest("[data-close-button]")) return;
      const toastEl = target.closest<HTMLElement>("[data-sonner-toast]");
      if (!toastEl) return;
      // Sonner writes data-id on each toast; dismiss by that id.
      const id = toastEl.dataset.id;
      if (id) toast.dismiss(id);
      else toast.dismiss();
    }
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  return (
    <Toaster
      position="top-right"
      theme="system"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "cursor-pointer",
        },
      }}
    />
  );
}
