import "server-only";

import {
  type LocalModelProvider,
  ProviderUnavailableError,
} from "./types";

/**
 * Ollama provider.
 *
 * Ollama exposes a native JSON model-listing endpoint at `GET /api/tags`
 * which returns `{ models: [{ name, ... }, ...] }`. We use the native path
 * rather than the OpenAI-compat `/v1/models` because `/api/tags` is the
 * documented first-class API and carries richer metadata Ollama users
 * recognise (tags include the quantisation suffix, e.g. `llama3.2:3b`).
 *
 * For outbound chat completions the OpenAI-compat endpoint at
 * `<base>/v1/chat/completions` is what the bootstrapper / agent-runner hit
 * — that path is shared with LM Studio, which is why we keep the chat
 * client provider-agnostic in `lib/agent/lm-studio.ts` and only branch on
 * provider for model listing + URL resolution.
 */

function buildTagsUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/api/tags`;
}

export const ollamaProvider: LocalModelProvider = {
  id: "ollama",
  label: "Ollama",
  defaultBaseUrl: "http://127.0.0.1:11434",
  installUrl: "https://ollama.com",
  async listModels(baseUrl, timeoutMs = 5_000) {
    const url = buildTagsUrl(baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // eslint-disable-next-line no-console
    console.log(`[ollama] -> GET ${url}`);

    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderUnavailableError(
        "ollama",
        `Could not reach Ollama at ${baseUrl}: ${msg}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ProviderUnavailableError(
        "ollama",
        `Ollama /api/tags returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      );
    }

    const payload = (await res.json().catch(() => ({}))) as {
      models?: Array<{ name?: unknown; model?: unknown }>;
    };
    const names: string[] = [];
    for (const row of payload.models ?? []) {
      const candidate =
        typeof row?.name === "string"
          ? row.name
          : typeof row?.model === "string"
            ? row.model
            : null;
      if (candidate) names.push(candidate);
    }

    // eslint-disable-next-line no-console
    console.log(`[ollama] <- 200 models=${names.length}`);
    return names;
  },
};
