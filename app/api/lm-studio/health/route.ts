import { NextRequest, NextResponse } from "next/server";
import { getGlobalSettings } from "@/lib/settings";
import { listModels, LMStudioUnavailableError } from "@/lib/agent/lm-studio";

/**
 * GET /api/lm-studio/health
 *
 * Probes the configured LM Studio URL by calling its OpenAI-compatible
 * `/v1/models` endpoint. Returns the configured URL, the list of models the
 * server reports, and whether the configured model is among them.
 *
 * This is the backbone of Feature #87 ("E2E LM Studio server is reachable"):
 * a real HTTP round-trip to the local LM Studio process, with the
 * configuration coming from the same SQLite settings table the rest of the
 * app reads. Mocking this would require mocking both the SQLite settings
 * table and the LM Studio process — i.e. it would have to be obvious.
 *
 * Optional `?url=` query overrides the configured URL (useful for one-off
 * probes from the settings page in a future feature).
 */
export async function GET(req: NextRequest) {
  const overrideUrl = req.nextUrl.searchParams.get("url");
  const globals = getGlobalSettings();
  const url = (overrideUrl ?? globals.lm_studio_url).trim();
  const expectedModel = globals.model;

  try {
    const models = await listModels(url);
    const modelLoaded = models.includes(expectedModel);
    return NextResponse.json({
      ok: true,
      url,
      configuredModel: expectedModel,
      modelLoaded,
      models,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown LM Studio error";
    const status = err instanceof LMStudioUnavailableError ? 502 : 500;
    return NextResponse.json(
      {
        ok: false,
        url,
        configuredModel: expectedModel,
        error: message,
      },
      { status },
    );
  }
}
