import "server-only";

/**
 * Provider abstraction for local-model backends (LM Studio, Ollama).
 *
 * Each provider exposes the same tiny contract: a stable id, a default base
 * URL, a human-readable label, and a `listModels()` probe. The registry in
 * `./index.ts` turns a provider id into the concrete client. Everything else
 * in the app — settings validation, health endpoints, .pi/models.json
 * generation, orchestrator argv — reads through this layer so adding a third
 * provider is "drop a new file and add it to the registry".
 */

export const PROVIDER_IDS = ["lm_studio", "ollama"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return (
    typeof value === "string" &&
    (PROVIDER_IDS as readonly string[]).includes(value)
  );
}

/**
 * Coarse classification of why a provider probe failed. Drives the UI's
 * "what should I do about this?" guidance — most users hit `not_running`
 * (server installed but not started), so distinguishing it from a real
 * misconfig is high-value.
 */
export type ProviderFailureKind =
  | "not_running"   // ECONNREFUSED — server installed but not started
  | "timeout"       // request hung past the abort timer
  | "dns"           // hostname couldn't be resolved
  | "http_error"    // server reachable but returned 4xx/5xx
  | "wrong_shape"   // server reachable but didn't return the expected JSON
  | "unknown";      // fallback when we can't classify

export class ProviderUnavailableError extends Error {
  constructor(
    public readonly providerId: ProviderId,
    public readonly kind: ProviderFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

/**
 * Walk a thrown error's `cause` chain looking for a Node-style error code
 * (e.g. ECONNREFUSED, ENOTFOUND). Modern Node fetch wraps the underlying
 * network failure as `cause`, sometimes nested twice — we surface the
 * first code we find at any depth.
 */
function findErrorCode(err: unknown, maxDepth = 4): string | null {
  let current: unknown = err;
  for (let i = 0; i < maxDepth; i++) {
    if (current && typeof current === "object") {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string") return code;
      const cause = (current as { cause?: unknown }).cause;
      if (cause === undefined) return null;
      current = cause;
    } else {
      return null;
    }
  }
  return null;
}

/** Map a thrown fetch/abort error to a coarse {@link ProviderFailureKind}. */
export function classifyFetchError(err: unknown): ProviderFailureKind {
  const code = findErrorCode(err);
  if (code) {
    if (code === "ECONNREFUSED") return "not_running";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
    if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") return "timeout";
    if (code === "ABORT_ERR") return "timeout";
  }
  // AbortController triggers an AbortError without a `code` on older runtimes
  if (err instanceof Error && err.name === "AbortError") return "timeout";
  return "unknown";
}

export interface LocalModelProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly defaultBaseUrl: string;
  /** Used in the UI's "not detected — install at …" hint. */
  readonly installUrl: string;
  /**
   * Probe the provider's model-listing endpoint and return the list of model
   * ids. Must throw {@link ProviderUnavailableError} when the server can't be
   * reached so callers can render a helpful message without catching raw
   * fetch failures.
   */
  listModels(baseUrl: string, timeoutMs?: number): Promise<string[]>;
}
