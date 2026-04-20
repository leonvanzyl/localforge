import "server-only";

/**
 * Provider abstraction for local-model backends (LM Studio, Ollama).
 *
 * Each provider exposes the same tiny contract: a stable id, a default base
 * URL, a human-readable label, and a `listModels()` probe. The registry in
 * `./index.ts` turns a provider id into the concrete client. Everything else
 * in the app — settings validation, health endpoints, .claude/settings.json
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

export class ProviderUnavailableError extends Error {
  constructor(
    public readonly providerId: ProviderId,
    message: string,
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
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
