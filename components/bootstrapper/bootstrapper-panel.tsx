"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Send, Sparkles, Loader2, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Chat panel rendered on a project page when an active bootstrapper session
 * exists.
 *
 * Responsibilities:
 *   - show the running chat history (Feature #56)
 *   - post the user's message and render it instantly (Feature #57)
 *   - stream the assistant's reply via SSE from LM Studio (Feature #58)
 *   - kick off feature generation at the end of the conversation (Feature #59)
 *
 * Messages are fetched once on mount; new messages come in via the POST
 * response's SSE stream rather than re-polling.
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
  const router = useRouter();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = React.useState<string | null>(null);
  const [input, setInput] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [genResult, setGenResult] = React.useState<string | null>(null);
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

  // Auto-scroll the transcript to bottom when new content arrives.
  React.useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  async function handleSend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);
    setGenResult(null);
    setStreaming("");
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
          body: JSON.stringify({ content: trimmed }),
        },
      );
      if (!res.ok || !res.body) {
        throw new Error(`Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let deltaText = "";
      let sawError = false;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events separated by blank line.
        let blankIdx: number;
        while ((blankIdx = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, blankIdx);
          buffer = buffer.slice(blankIdx + 2);
          const dataLine = rawEvent
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload) continue;
          let evt: {
            type: string;
            content?: string;
            message?: ChatMessage | string;
          };
          try {
            evt = JSON.parse(payload);
          } catch {
            continue;
          }

          if (evt.type === "user" && evt.message && typeof evt.message === "object") {
            const userMsg = evt.message as ChatMessage;
            setMessages((prev) => {
              const withoutOptimistic = prev.filter(
                (m) => m.id !== optimisticUser.id,
              );
              return [...withoutOptimistic, userMsg];
            });
          } else if (evt.type === "delta" && typeof evt.content === "string") {
            deltaText += evt.content;
            setStreaming(deltaText);
          } else if (
            evt.type === "assistant" &&
            evt.message &&
            typeof evt.message === "object"
          ) {
            const assistantMsg = evt.message as ChatMessage;
            setMessages((prev) => [...prev, assistantMsg]);
            setStreaming(null);
          } else if (evt.type === "error" && typeof evt.message === "string") {
            sawError = true;
            setError(evt.message);
            setStreaming(null);
          } else if (evt.type === "done") {
            setStreaming(null);
          }
        }
      }

      if (!sawError && deltaText && streaming !== null) {
        // Defensive fallback: if the server closed without an assistant event
        // but we captured deltas, flush them into the transcript so the UI
        // doesn't lose the reply.
        setStreaming(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      setStreaming(null);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Kick off AI feature generation. The server will read the whole chat
   * history, ask the LLM to emit a JSON feature list, persist the features,
   * mark the bootstrapper session completed, and return the count. We then
   * navigate the user to the kanban (which now has features) by refreshing
   * the router.
   */
  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setGenResult(null);
    try {
      const res = await fetch(
        `/api/agent-sessions/${sessionId}/generate-features`,
        { method: "POST" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        count?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setGenResult(
        `Generated ${data.count ?? 0} features. Opening your kanban…`,
      );
      // Give the user a beat to read the confirmation, then refresh so the
      // project page swaps from chat → kanban.
      setTimeout(() => router.refresh(), 700);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate features",
      );
    } finally {
      setGenerating(false);
    }
  }

  const hasConversation = messages.length >= 2; // at least one user + assistant exchange
  const canGenerate = hasConversation && !submitting && !generating;

  return (
    <div
      data-testid="bootstrapper-panel"
      data-session-id={sessionId}
      data-project-id={projectId}
      className="flex flex-1 flex-col"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-6 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          <div className="flex flex-col">
            <p className="text-sm font-medium text-foreground">
              AI Bootstrapper
            </p>
            <p className="text-xs text-muted-foreground">
              {`Describe ${projectName} and I'll turn it into features.`}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleGenerate}
          disabled={!canGenerate}
          data-testid="bootstrapper-generate"
          className="gap-1"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Wand2 className="h-4 w-4" aria-hidden="true" />
          )}
          {generating ? "Generating…" : "Generate feature list"}
        </Button>
      </div>

      <div
        ref={transcriptRef}
        data-testid="bootstrapper-transcript"
        className="flex-1 space-y-3 overflow-y-auto px-6 py-4"
      >
        {messages.length === 0 && !streaming && (
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
        {streaming !== null && (
          <div
            data-testid="chat-message-assistant-streaming"
            className="mr-auto flex max-w-[80%] gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
          >
            <div className="flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                assistant
              </p>
              <p className="whitespace-pre-wrap">
                {streaming || "\u200b"}
                <span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-foreground align-middle" />
              </p>
            </div>
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        )}
        {genResult && (
          <p
            role="status"
            data-testid="bootstrapper-gen-result"
            className="text-sm text-emerald-500"
          >
            {genResult}
          </p>
        )}
        {error && (
          <p
            role="alert"
            data-testid="bootstrapper-error"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
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
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
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
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          Send
        </Button>
      </form>
    </div>
  );
}
