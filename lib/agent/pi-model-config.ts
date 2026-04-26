import type { ProviderId } from "./providers/types";

export type PiLocalModel = {
  id: string;
  name: string;
  api: "openai-completions";
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: ["text"];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  compat: {
    supportsDeveloperRole: boolean;
    supportsReasoningEffort: boolean;
    supportsUsageInStreaming: boolean;
    supportsStrictMode: boolean;
    maxTokensField: "max_tokens";
  };
};

function ensureOpenAiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function piProviderName(provider: ProviderId): string {
  return provider === "ollama" ? "ollama" : "lm_studio";
}

export function createPiLocalModel(config: {
  provider: ProviderId;
  baseUrl: string;
  model: string;
}): PiLocalModel {
  const provider = piProviderName(config.provider);
  return {
    id: config.model,
    name: config.model,
    api: "openai-completions",
    provider,
    baseUrl: ensureOpenAiBaseUrl(config.baseUrl),
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128000,
    maxTokens: 16384,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      supportsStrictMode: false,
      maxTokensField: "max_tokens",
    },
  };
}
