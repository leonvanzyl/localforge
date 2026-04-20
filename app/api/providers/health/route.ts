import { NextRequest, NextResponse } from "next/server";

import {
  PROVIDERS,
  ProviderUnavailableError,
} from "@/lib/agent/providers";
import { getGlobalSettings, baseUrlKeyForProvider } from "@/lib/settings";

/**
 * GET /api/providers/health
 *
 * Probes every registered local-model provider in parallel using the URL
 * currently stored in global settings for that provider. Returns a uniform
 * `{ providers: [...] }` payload the settings UI uses to decide which
 * options should render an "install me" hint.
 *
 * This endpoint never 5xxs on a single provider failure — each probe's
 * outcome is reported individually inside the array. That matches the UX:
 * the page should still load even if neither provider is running.
 */
export async function GET(_req: NextRequest) {
  const globals = getGlobalSettings();

  const results = await Promise.all(
    PROVIDERS.map(async (provider) => {
      const url = globals[baseUrlKeyForProvider(provider.id)];
      try {
        const models = await provider.listModels(url);
        return {
          id: provider.id,
          label: provider.label,
          installUrl: provider.installUrl,
          url,
          ok: true,
          models,
          error: null as string | null,
        };
      } catch (err) {
        const message =
          err instanceof ProviderUnavailableError || err instanceof Error
            ? err.message
            : "Unknown provider error";
        return {
          id: provider.id,
          label: provider.label,
          installUrl: provider.installUrl,
          url,
          ok: false,
          models: [] as string[],
          error: message,
        };
      }
    }),
  );

  return NextResponse.json({
    activeProvider: globals.provider,
    providers: results,
  });
}
