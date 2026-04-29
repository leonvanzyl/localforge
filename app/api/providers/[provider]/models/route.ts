import { NextRequest, NextResponse } from "next/server";

import {
  getProvider,
  isProviderId,
  ProviderUnavailableError,
} from "@/lib/agent/providers";
import { baseUrlKeyForProvider, getGlobalSettings } from "@/lib/settings";

type RouteContext = { params: Promise<{ provider: string }> };

/**
 * GET /api/providers/:provider/models[?url=<override>]
 *
 * Returns the list of models reported by the given local-model backend.
 * Drives the dynamic model dropdown in the settings UI — the client calls
 * this on mount, when the user switches provider, and whenever the URL
 * input changes (debounced).
 *
 * Uses the provided `?url=` override when present so the UI can probe a
 * URL the user is currently typing without having to save settings first.
 * Falls back to the globally-configured URL for that provider otherwise.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { provider: raw } = await ctx.params;
  if (!isProviderId(raw)) {
    return NextResponse.json(
      { ok: false, error: `Unknown provider: ${raw}` },
      { status: 404 },
    );
  }
  const provider = getProvider(raw);
  const overrideUrl = req.nextUrl.searchParams.get("url");
  const url = (overrideUrl ?? getGlobalSettings()[baseUrlKeyForProvider(raw)])
    .trim();

  try {
    const models = await provider.listModels(url);
    return NextResponse.json({ ok: true, url, models });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown provider error";
    const status = err instanceof ProviderUnavailableError ? 502 : 500;
    const kind =
      err instanceof ProviderUnavailableError ? err.kind : "unknown";
    return NextResponse.json(
      {
        ok: false,
        url,
        error: message,
        kind,
        models: [] as string[],
      },
      { status },
    );
  }
}
