import "server-only";

import { lmStudioProvider } from "./lm-studio";
import { ollamaProvider } from "./ollama";
import {
  type LocalModelProvider,
  type ProviderId,
  PROVIDER_IDS,
} from "./types";

export type { LocalModelProvider, ProviderId } from "./types";
export { PROVIDER_IDS, isProviderId, ProviderUnavailableError } from "./types";

/**
 * Ordered list of local-model providers the app knows about. The UI renders
 * them in this order; LM Studio is first because it was the original (and
 * remains the default) backend.
 */
export const PROVIDERS: readonly LocalModelProvider[] = [
  lmStudioProvider,
  ollamaProvider,
];

const BY_ID: Record<ProviderId, LocalModelProvider> = {
  lm_studio: lmStudioProvider,
  ollama: ollamaProvider,
};

export function getProvider(id: ProviderId): LocalModelProvider {
  return BY_ID[id];
}

/** Public metadata used by the settings UI to render each provider option. */
export type ProviderDescriptor = {
  id: ProviderId;
  label: string;
  defaultBaseUrl: string;
  installUrl: string;
};

export function listProviderDescriptors(): ProviderDescriptor[] {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    defaultBaseUrl: p.defaultBaseUrl,
    installUrl: p.installUrl,
  }));
}

/** Default URL for each provider — used when extending settings defaults. */
export function getProviderDefaultUrl(id: ProviderId): string {
  return BY_ID[id].defaultBaseUrl;
}

// Re-export for callers that want to iterate in stable order.
export const PROVIDER_IDS_ORDERED: readonly ProviderId[] = PROVIDER_IDS;
