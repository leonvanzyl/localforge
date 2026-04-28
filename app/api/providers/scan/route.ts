import { NextResponse } from "next/server";

import {
  PROVIDERS,
  type ProviderDescriptor,
  listProviderDescriptors,
} from "@/lib/agent/providers";
import { getProvider } from "@/lib/agent/providers";

export const dynamic = "force-dynamic";

type ProviderHit = {
  providerId: ProviderDescriptor["id"];
  label: string;
  url: string;
  modelCount: number;
};

/**
 * GET /api/providers/scan
 *
 * Probes every known provider at its default URL with a short timeout.
 * Used by the settings page to surface "we found <provider> at <url>"
 * when the user's currently-configured provider isn't responding —
 * covers the common case of having installed both LM Studio and Ollama
 * and configured the wrong one (or having one running on a non-default
 * port and the other on the default).
 *
 * Returns `{ hits: [...] }` where each hit is a provider that responded
 * successfully. Always 200 — failed probes are simply absent from the list.
 */
export async function GET() {
  const descriptors = listProviderDescriptors();

  const results = await Promise.all(
    PROVIDERS.map(async (provider): Promise<ProviderHit | null> => {
      const descriptor = descriptors.find((d) => d.id === provider.id);
      if (!descriptor) return null;
      try {
        // Short timeout (1.5s) so a stalled probe doesn't block the response.
        const models = await getProvider(provider.id).listModels(
          descriptor.defaultBaseUrl,
          1500,
        );
        return {
          providerId: provider.id,
          label: descriptor.label,
          url: descriptor.defaultBaseUrl,
          modelCount: models.length,
        };
      } catch {
        return null;
      }
    }),
  );

  const hits = results.filter((r): r is ProviderHit => r !== null);
  return NextResponse.json({ hits });
}
