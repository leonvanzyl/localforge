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
        // Errors thrown from the response-status branch include "returned "
        // (e.g. "/v1/models returned 404"); everything else came from the
        // network branch, where the underlying fetch error is on `cause`
        // and classifyFetchError walks that chain to pick out the code.
        const kind = err.message.includes("returned ")
          ? "http_error"
          : classifyFetchError(err);
        throw new ProviderUnavailableError("lm_studio", kind, err.message);
      }
      throw err;
    }
  },
};
