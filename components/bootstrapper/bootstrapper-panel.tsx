"use client";

import * as React from "react";
import { Send, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Chat panel rendered on a project page when an active bootstrapper session
 * exists (Feature #55 "Start AI bootstrapper conversation creates session").
 *
 * The panel renders inside the project page's main content area and is
 * responsible for:
 *   - showing the running chat history for the session
 *   - accepting a new user message
 *   - posting messages to the server (future work: wire Claude Agent SDK)
 *
 * For Feature #55 we verify that the chat interface simply renders; the
 * end-to-end AI plumbing is a later feature. This component fetches any
 * existing chat history from the API and renders a greeting from the
 * assistant when the conversation is empty so the UI is immediately useful.
 */

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

type BootstrapperPanelProps = {
  sessionId: number;
  projectId: number;
  projectName: string;
};

export function BootstrapperPanel({
  sessionId,
  projectId,
  projectName,
}: BootstrapperPanelProps) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const transcriptRef = React.useRef<HTMLDivElement>(null);

  // Load any prior chat history for this session.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/agent-sessions/${sessionId}/messages`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: ChatMessage[] };
        if (cancelled) return;
        setMessages(data.messages ?? []);
      } catch {
        // Keep the panel usable even if history fetch fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Auto-scroll the transcript to bottom when new messages arrive.
  React.useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function handleSend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);
    // Optimistically push the user message so typing feels instant.
    const optimisticUser: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: trimmed,
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setInput("");

    try {
      const res = await fetch(
        `/api/agent-sessions/${sessionId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: trimmed, role: "user" }),
        },
      );
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
      const data = (await res.json()) as {
        user?: ChatMessage;
        assistant?: ChatMessage;
      };
      // Replace the optimistic user message with the server record and append
      // the assistant reply (placeholder — wired to Claude Agent SDK later).
      setMessages((prev) => {
        const withoutOptimistic = prev.filter(
          (m) => m.id !== optimisticUser.id,
        );
        const next = [...withoutOptimistic];
        if (data.user) next.push(data.user);
        if (data.assistant) next.push(data.assistant);
        return next;
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send message",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid="bootstrapper-panel"
      data-session-id={sessionId}
      data-project-id={projectId}
      className="flex flex-1 flex-col"
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-6 py-3">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        <div className="flex flex-col">
          <p className="text-sm font-medium text-foreground">
            AI Bootstrapper
          </p>
          <p className="text-xs text-muted-foreground">
            Describe <span className="font-medium">{projectName}</span> and
            I&apos;ll turn it into features.
          </p>
        </div>
      </div>

      <div
        ref={transcriptRef}
        data-testid="bootstrapper-transcript"
        className="flex-1 space-y-3 overflow-y-auto px-6 py-4"
      >
        {messages.length === 0 && (
          <div
            data-testid="bootstrapper-greeting"
            className="rounded-md border border-border bg-card px-4 py-3 text-sm text-foreground"
          >
            <p className="mb-1 font-medium">Hi! I&apos;m your bootstrapper.</p>
            <p className="text-muted-foreground">
              Describe what you want to build and I&apos;ll ask follow-up
              questions to generate a feature list. You can always edit the
              kanban afterwards.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            data-testid={`chat-message-${m.role}`}
            className={
              m.role === "user"
                ? "ml-auto max-w-[80%] rounded-md bg-primary/10 px-3 py-2 text-sm text-foreground"
                : "mr-auto max-w-[80%] rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
            }
          >
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {m.role}
            </p>
            <p className="whitespace-pre-wrap">{m.content}</p>
          </div>
        ))}
        {error && (
          <p
            role="alert"
            data-testid="bootstrapper-error"
            className="text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </div>

      <form
        onSubmit={handleSend}
        data-testid="bootstrapper-form"
        className="flex items-end gap-2 border-t border-border px-6 py-4"
      >
        <textarea
          data-testid="bootstrapper-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={2}
          disabled={submitting}
          placeholder="e.g. A todo list app with tags, due dates, and dark mode"
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="submit"
          disabled={submitting || input.trim().length === 0}
          data-testid="bootstrapper-send"
          size="sm"
          className="gap-1"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Send
        </Button>
      </form>
    </div>
  );
}
