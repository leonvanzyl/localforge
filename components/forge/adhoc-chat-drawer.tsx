"use client";

import React from "react";
import { XIcon } from "@/components/forge/icons";
import { ChatMarkdown } from "@/components/forge/chat-markdown";

const ADHOC_MAX_IMAGES = 6;
const ADHOC_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

type ChatMsg = {
  id: number;
  role: string;
  content: string;
  createdAt: string;
  attachments?: string | null;
};

type PendingImage = {
  id: string;
  mimeType: string;
  data: string;
  previewUrl: string;
};

function parseStoredAttachments(
  raw: string | null | undefined,
): { mimeType: string; data: string }[] {
  if (!raw?.trim()) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (x): x is { mimeType: string; data: string } =>
        !!x &&
        typeof x === "object" &&
        typeof (x as { mimeType?: string }).mimeType === "string" &&
        typeof (x as { data?: string }).data === "string",
    );
  } catch {
    return [];
  }
}

function readFileAsImagePart(
  file: File,
): Promise<{ mimeType: string; data: string } | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve(null);
      return;
    }
    let mime = file.type.toLowerCase().split(";")[0].trim();
    if (mime === "image/jpg") mime = "image/jpeg";
    if (!ALLOWED_IMAGE_MIME.has(mime)) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const m = /^data:([^;]+);base64,(.+)$/s.exec(url);
      if (!m) {
        resolve(null);
        return;
      }
      const data = m[2].replace(/\s/g, "");
      const approxBytes = Math.floor((data.length * 3) / 4);
      if (approxBytes > ADHOC_MAX_IMAGE_BYTES || approxBytes === 0) {
        resolve(null);
        return;
      }
      resolve({ mimeType: mime, data });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

type LogLine = {
  id: string;
  message: string;
  messageType: string;
  createdAt: string;
};

export type AdhocChatDrawerProps = {
  open: boolean;
  onClose: () => void;
  projectId: number | null;
};

export function AdhocChatDrawer({
  open,
  onClose,
  projectId,
}: AdhocChatDrawerProps) {
  const [sessionId, setSessionId] = React.useState<number | null>(null);
  const [messages, setMessages] = React.useState<ChatMsg[]>([]);
  const [logs, setLogs] = React.useState<LogLine[]>([]);
  const [input, setInput] = React.useState("");
  const [intent, setIntent] = React.useState<"ask" | "edit">("ask");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** Increment to tear down SSE + open a fresh ad-hoc session after closing the old one. */
  const [sessionEpoch, setSessionEpoch] = React.useState(0);
  const [pendingImages, setPendingImages] = React.useState<PendingImage[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const addImagesFromFiles = React.useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    const additions: PendingImage[] = [];
    let skipped = false;
    for (const file of list) {
      const part = await readFileAsImagePart(file);
      if (!part) {
        skipped = true;
        continue;
      }
      additions.push({
        id: `p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        mimeType: part.mimeType,
        data: part.data,
        previewUrl: `data:${part.mimeType};base64,${part.data}`,
      });
    }
    if (additions.length === 0) {
      if (skipped) {
        setError("Could not add image (unsupported type or larger than 4MB).");
      }
      return;
    }
    setPendingImages((prev) => {
      const room = ADHOC_MAX_IMAGES - prev.length;
      if (room <= 0) {
        skipped = true;
        return prev;
      }
      const next = [...prev, ...additions.slice(0, room)];
      if (additions.length > room) skipped = true;
      return next;
    });
    if (skipped) {
      setError(
        "Some images were not added (max 6 images, 4MB each; PNG, JPEG, WebP, GIF).",
      );
    } else {
      setError(null);
    }
  }, []);

  const removePendingImage = React.useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((p) => p.id !== id));
  }, []);

  React.useEffect(() => {
    setSessionId(null);
    setMessages([]);
    setLogs([]);
    setInput("");
    setError(null);
    setBusy(false);
    setSessionEpoch(0);
    setPendingImages([]);
    if (!projectId) {
      return;
    }
  }, [projectId]);

  React.useEffect(() => {
    if (!open || !projectId) return;
    const ac = new AbortController();
    setError(null);
    setLogs([]);
    fetch(`/api/projects/${projectId}/adhoc-session`, {
      method: "POST",
      signal: ac.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: { session?: { id: number } }) => {
        if (!j.session?.id) throw new Error("No session");
        setSessionId(j.session.id);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError("Could not start agent chat for this project.");
      });
    return () => ac.abort();
  }, [open, projectId, sessionEpoch]);

  const loadMessages = React.useCallback(async (sid: number) => {
    const r = await fetch(`/api/agent-sessions/${sid}/messages`);
    if (!r.ok) return;
    const j = (await r.json()) as { messages?: ChatMsg[] };
    setMessages(j.messages ?? []);
  }, []);

  React.useEffect(() => {
    if (!open || !sessionId) return;
    void loadMessages(sessionId);
  }, [open, sessionId, loadMessages]);

  React.useEffect(() => {
    if (!open || !sessionId) return;
    const es = new EventSource(`/api/agent/stream/${sessionId}`);
    const onLog = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as {
          message?: string;
          messageType?: string;
          createdAt?: string;
        };
        const msg = typeof data.message === "string" ? data.message : "";
        if (!msg) return;
        setLogs((prev) =>
          [
            ...prev,
            {
              id: `l-${Date.now()}-${prev.length}`,
              message: msg,
              messageType: data.messageType ?? "info",
              createdAt: data.createdAt ?? new Date().toISOString(),
            },
          ].slice(-300),
        );
        if (
          msg.includes("Ad-hoc turn completed") ||
          msg.includes("Ad-hoc turn failed") ||
          msg.startsWith("Ad-hoc turn stopped")
        ) {
          setBusy(false);
          void loadMessages(sessionId);
        }
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("log", onLog);
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [open, sessionId, loadMessages]);

  React.useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pendingImages, open]);

  React.useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const send = async () => {
    if (!sessionId || busy) return;
    const text = input.trim();
    if (!text && pendingImages.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const imagesPayload = pendingImages.map((p) => ({
        mimeType: p.mimeType,
        data: p.data,
      }));
      const r = await fetch(`/api/agent-sessions/${sessionId}/adhoc-turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          intent,
          images: imagesPayload.length ? imagesPayload : undefined,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setBusy(false);
        setError(j.error ?? `Request failed (${r.status})`);
        return;
      }
      setInput("");
      setPendingImages([]);
      await loadMessages(sessionId);
    } catch {
      setBusy(false);
      setError("Network error");
    }
  };

  const closeChat = async () => {
    if (sessionId) {
      try {
        await fetch(`/api/agent-sessions/${sessionId}/close`, {
          method: "POST",
        });
      } catch {
        /* ignore */
      }
    }
    setSessionId(null);
    onClose();
  };

  const startNewChat = async () => {
    if (!projectId || busy) return;
    if (
      !window.confirm(
        "Start a new chat? The current session will be closed and the agent will not see earlier messages.",
      )
    ) {
      return;
    }
    setError(null);
    if (sessionId) {
      try {
        const r = await fetch(`/api/agent-sessions/${sessionId}/close`, {
          method: "POST",
        });
        if (r.status === 409) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? "Wait for the current turn to finish, then try again.");
          return;
        }
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? "Could not end the previous session.");
          return;
        }
      } catch {
        setError("Network error");
        return;
      }
    }
    setMessages([]);
    setLogs([]);
    setInput("");
    setBusy(false);
    setSessionId(null);
    setSessionEpoch((n) => n + 1);
    setPendingImages([]);
  };

  if (!open) return null;

  return (
    <aside className={"drawer drawer--left adhoc-chat-drawer " + (open ? "open" : "")}>
      <div className="drawer-head">
        <span className="t">Agent chat</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn text-xs px-2 py-1"
            disabled={busy || !sessionId}
            onClick={() => void startNewChat()}
            title="Close this session and start a fresh one (clears context for the agent)"
          >
            New chat
          </button>
          <button
            type="button"
            className="btn text-xs px-2 py-1"
            onClick={() => void closeChat()}
            title="End chat session"
          >
            End chat
          </button>
          <button
            type="button"
            className="btn icon-btn ghost"
            onClick={() => onClose()}
            aria-label="Hide drawer"
          >
            <XIcon size={16} />
          </button>
        </div>
      </div>

      <div className="drawer-body adhoc-chat-body" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        {!projectId ? (
          <p className="text-sm text-muted-foreground p-2">Select a project first.</p>
        ) : error ? (
          <p className="text-sm text-destructive p-2">{error}</p>
        ) : !sessionId ? (
          <p className="text-sm text-muted-foreground p-2">Connecting…</p>
        ) : (
          <>
            <div className="adhoc-chat-split" style={{ flex: 1, minHeight: 0 }}>
              <div className="adhoc-chat-col">
                <h3>Transcript</h3>
                <div ref={scrollRef} className="adhoc-chat-messages">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={
                        "adhoc-chat-bubble " +
                        (m.role === "user" ? "user" : "assistant")
                      }
                    >
                      {m.role === "user" ? (
                        <>
                          {parseStoredAttachments(m.attachments).map((im, i) => (
                            <img
                              key={`${m.id}-img-${i}`}
                              src={`data:${im.mimeType};base64,${im.data}`}
                              alt=""
                              className="adhoc-chat-attached-img"
                            />
                          ))}
                          {m.content ? (
                            <span className="adhoc-chat-user-text">{m.content}</span>
                          ) : null}
                        </>
                      ) : (
                        <ChatMarkdown content={m.content} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="adhoc-chat-col">
                <h3>Activity</h3>
                <div className="adhoc-chat-logs">
                  {logs.length === 0 ? (
                    <div className="text-muted-foreground opacity-70">
                      Tool output appears here while the agent runs.
                    </div>
                  ) : (
                    logs.map((l) => (
                      <div
                        key={l.id}
                        className={
                          "logline " +
                          (l.messageType === "action"
                            ? "action"
                            : l.messageType === "error"
                              ? "error"
                              : "")
                        }
                      >
                        {l.message}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="adhoc-chat-foot">
              <div className="flex gap-2 items-center">
                <span className="text-xs text-muted-foreground">Mode:</span>
                <button
                  type="button"
                  className={
                    "btn text-xs px-2 py-1 " + (intent === "ask" ? "primary" : "")
                  }
                  onClick={() => setIntent("ask")}
                >
                  Ask
                </button>
                <button
                  type="button"
                  className={
                    "btn text-xs px-2 py-1 " + (intent === "edit" ? "primary" : "")
                  }
                  onClick={() => setIntent("edit")}
                >
                  Edit
                </button>
                {busy ? (
                  <span className="text-xs text-muted-foreground ml-2">Running…</span>
                ) : null}
              </div>
                {pendingImages.length > 0 ? (
                <div className="adhoc-chat-pending-images">
                  {pendingImages.map((p) => (
                    <div key={p.id} className="adhoc-chat-pending-tile">
                      <img src={p.previewUrl} alt="" className="adhoc-chat-pending-thumb" />
                      <button
                        type="button"
                        className="adhoc-chat-pending-remove"
                        onClick={() => removePendingImage(p.id)}
                        aria-label="Remove image"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <textarea
                className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Ask about the code, paste a screenshot (Ctrl+V), or attach images…"
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
                onPaste={(e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  const imageFiles: File[] = [];
                  for (let i = 0; i < items.length; i++) {
                    const it = items[i];
                    if (it?.kind === "file" && it.type.startsWith("image/")) {
                      const f = it.getAsFile();
                      if (f) imageFiles.push(f);
                    }
                  }
                  if (imageFiles.length > 0) {
                    e.preventDefault();
                    void addImagesFromFiles(imageFiles);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="sr-only"
                  aria-hidden
                  tabIndex={-1}
                  onChange={(e) => {
                    const fl = e.target.files;
                    e.target.value = "";
                    if (fl && fl.length > 0) void addImagesFromFiles(fl);
                  }}
                />
                <button
                  type="button"
                  className="btn text-xs px-2 py-1"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Attach images
                </button>
              </div>
              {error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : null}
              <button
                type="button"
                className="btn primary"
                disabled={busy || (!input.trim() && pendingImages.length === 0)}
                onClick={() => void send()}
              >
                Send
              </button>
              <p className="text-[11px] text-muted-foreground">
                Ctrl+Enter to send. Paste screenshots into the box. Vision-capable models (e.g. multimodal
                in LM Studio) can use images; others may ignore them. Same Pi tools as Run queue.
              </p>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
