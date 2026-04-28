import "server-only";

import {
  listModels as listLmStudioModels,
  LMStudioUnavailableError,
} from "../lm-studio";
import {
  classifyFetchError,
  type LocalModelProvider,
  ProviderUnavailableError,
} from "./types";

/**
 * LM Studio provider. Delegates to the existing `lib/agent/lm-studio.ts`
 * client so the streaming chat path (used by the bootstrapper) and the
 * `/v1/models` probe share the same breadcrumb logging and timeout rules
 * that Feature #87's E2E test depends on.
 */
export const lmStudioProvider: LocalModelProvider = {
  id: "lm_studio",
  label: "LM Studio",
  defaultBaseUrl: "http://127.0.0.1:1234",
  installUrl: "https://lmstudio.ai",
  async listModels(baseUrl, timeoutMs) {
    try {
      return await listLmStudioModels(baseUrl, timeoutMs);
    } catch (err) {
      if (err instanceof LMStudioUnavailableError) {
        // The client tags response-side failures (HTTP error, wrong JSON
        // shape) with a kind directly. Network failures leave kind unset
        // and we fall back to classifyFetchError which walks `cause` to
        // pull the Node-style code out (ECONNREFUSED, ENOTFOUND, etc.).
        const kind = err.kind ?? classifyFetchError(err);
        throw new ProviderUnavailableError("lm_studio", kind, err.message);
      }
      throw err;
    }
  },
};
