import "server-only";

/**
 * Minimal LM Studio client for the AI bootstrapper.
 *
 * LM Studio exposes an OpenAI-compatible HTTP API at
 * `<base>/v1/chat/completions`. We use streaming mode (`stream: true`) so the
 * bootstrapper can render partial assistant text as it arrives, giving users
 * the typing-in-real-time feel they expect from a chat UI.
 *
 * This module only knows how to talk to LM Studio. It does not touch the
 * database, Next.js, or the Pi agent runtime. The SSE bridge that pushes
 * deltas to the browser lives in `app/api/agent-sessions/[id]/messages`.
 */

export type LMStudioChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LMStudioChatOptions = {
  baseUrl: string;
  model: string;
  messages: LMStudioChatMessage[];
  /** Abort signal bubbled through to fetch (used by the SSE route). */
  signal?: AbortSignal;
  /** Temperature. Defaults to 0.7 for chat. */
  temperature?: number;
};

/** Event types emitted by {@link streamChatCompletion}. */
export type LMStudioStreamEvent =
  | { type: "delta"; content: string }
  | { type: "done"; fullText: string }
  | { type: "error"; message: string };

export class LMStudioUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LMStudioUnavailableError";
  }
}

/**
 * Non-streaming chat completion. Returns the final assistant text. Used by
 * the feature-generation step which needs the full JSON payload at once
 * (streaming partial JSON would force complex reparsing).
 */
export async function chatCompletion(
  opts: Omit<LMStudioChatOptions, "signal"> & { signal?: AbortSignal },
): Promise<string> {
  const url = buildUrl(opts.baseUrl);
  // eslint-disable-next-line no-console
  console.log(
    `[lm-studio] -> POST ${url} model=${opts.model} messages=${opts.messages.length} stream=false`,
  );
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: opts.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.7,
        stream: false,
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new LMStudioUnavailableError(
      `Could not reach LM Studio at ${opts.baseUrl}: ${msg}`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LMStudioUnavailableError(
      `LM Studio returned ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Streaming chat completion. Yields delta chunks as they arrive from LM
 * Studio, then a final `done` event with the accumulated text. If LM Studio
 * is unreachable or returns an error, yields a single `error` event - the
 * caller can surface that in the UI.
 *
 * Consumes the OpenAI-style SSE format:
 *   data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n
 *   data: [DONE]\n\n
 */
export async function* streamChatCompletion(
  opts: LMStudioChatOptions,
): AsyncGenerator<LMStudioStreamEvent, void, void> {
  const url = buildUrl(opts.baseUrl);

  // Breadcrumb for the E2E reachability tests (Features #87 / #91): a single
  // grep for `[lm-studio] -> POST` in dev-server.log proves an outbound chat
  // completion was attempted against the configured local server.
  // eslint-disable-next-line no-console
  console.log(
    `[lm-studio] -> POST ${url} model=${opts.model} messages=${opts.messages.length} stream=true`,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: opts.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.7,
        stream: true,
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    yield {
      type: "error",
      message: `Could not reach LM Studio at ${opts.baseUrl}. Is it running? (${msg})`,
    };
    return;
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    yield {
      type: "error",
      message: `LM Studio returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by blank lines. We might get multiple events
      // per chunk (or partial events split across chunks); drain complete ones.
      let nlIndex: number;
      while ((nlIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nlIndex).trim();
        buffer = buffer.slice(nlIndex + 1);
        if (!line) continue;
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          yield { type: "done", fullText: full };
          return;
        }
        try {
          const obj = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const content = obj.choices?.[0]?.delta?.content ?? "";
          if (content) {
            full += content;
            yield { type: "delta", content };
          }
        } catch {
          // Ignore malformed SSE line — LM Studio occasionally pads with
          // keep-alive comments or partial JSON.
        }
      }
    }
    // Flush: if we never saw [DONE] but the stream ended cleanly, treat what
    // we have as the final response.
    yield { type: "done", fullText: full };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { type: "error", message: `Stream aborted: ${msg}` };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* no-op */
    }
  }
}

function buildUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/v1/chat/completions`;
}

function buildModelsUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/v1/models`;
}

/**
 * Lightweight reachability probe: pings GET /v1/models on the LM Studio URL
 * and returns the list of model ids if successful. Used by the
 * `/api/lm-studio/health` endpoint to back Feature #87 ("LM Studio server is
 * reachable") — the health endpoint hits this real HTTP path, so a green
 * response proves the configured URL is alive and the configured model is
 * loaded.
 */
export async function listModels(
  baseUrl: string,
  timeoutMs = 5_000,
): Promise<string[]> {
  const url = buildModelsUrl(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // eslint-disable-next-line no-console
  console.log(`[lm-studio] -> GET ${url}`);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    throw new LMStudioUnavailableError(
      `Could not reach LM Studio at ${baseUrl}: ${msg}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LMStudioUnavailableError(
      `LM Studio /v1/models returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }

  const payload = (await res.json().catch(() => ({}))) as {
    data?: Array<{ id?: unknown }>;
  };
  const ids: string[] = [];
  for (const row of payload.data ?? []) {
    if (typeof row?.id === "string") ids.push(row.id);
  }

  // eslint-disable-next-line no-console
  console.log(`[lm-studio] <- 200 models=${ids.length}`);
  return ids;
}
