"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * "Start new conversation" CTA shown above the kanban board when no active
 * bootstrapper session is in progress. Covers Feature #61:
 *
 *   After the prior bootstrapper session was closed, the user can open a
 *   fresh chat on the same project. Clicking creates a brand-new
 *   agent_sessions row (different id, status='in_progress') and refreshes
 *   the page so BootstrapperPanel mounts with an empty transcript.
 *
 * The server-rendered project page passes `projectId` — the button handles
 * the POST itself so the page stays a pure RSC.
 */
export function StartConversationButton({
  projectId,
  variant = "outline",
}: {
  projectId: number;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleClick() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/bootstrapper-session`,
        { method: "POST" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        session?: { id: number };
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Failed (${res.status})`);
      }
      // Refresh the server-rendered page so it picks up the new active
      // bootstrapper session and swaps kanban → chat panel.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start chat");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="start-conversation-wrapper"
    >
      <Button
        type="button"
        variant={variant}
        size="sm"
        onClick={handleClick}
        disabled={creating}
        data-testid="start-new-conversation"
        className="gap-1.5"
      >
        {creating ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        )}
        {creating ? "Starting…" : "Start new conversation"}
      </Button>
      {error && (
        <span
          role="alert"
          data-testid="start-new-conversation-error"
          className="text-xs text-destructive"
        >
          {error}
        </span>
      )}
    </div>
  );
}
