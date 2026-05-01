import { NextRequest, NextResponse } from "next/server";

import { getProject, writeProjectPiSettings } from "@/lib/projects";
import {
  getGlobalSettings,
  getProjectEffectiveSettings,
  getProjectOverrides,
  updateProjectSettings,
  type UpdateProjectSettingsInput,
} from "@/lib/settings";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * GET /api/projects/:id/settings
 *
 * Returns three pieces the UI needs to render the per-project settings
 * dialog:
 *   - overrides: the raw project-level overrides (null when not overridden)
 *   - effective: the values that actually apply (override or global fallback)
 *   - defaults:  the current global settings, used for placeholder text
 *
 * A single round-trip covers the "what's the current override?" and
 * "what does the form show as the default?" concerns together.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const projectId = parseId(id);
  if (projectId == null) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const overrides = getProjectOverrides(projectId);
  const effective = getProjectEffectiveSettings(projectId);
  const globals = getGlobalSettings();

  return NextResponse.json({
    overrides,
    effective,
    defaults: {
      provider: globals.provider,
      lm_studio_url: globals.lm_studio_url,
      ollama_url: globals.ollama_url,
      model: globals.model,
      coder_prompt: globals.coder_prompt,
      dev_server_port: globals.dev_server_port,
      max_concurrent_agents: globals.max_concurrent_agents,
      playwright_enabled: globals.playwright_enabled,
      playwright_headed: globals.playwright_headed,
    },
  });
}

/**
 * PUT /api/projects/:id/settings
 *
 * Body (JSON): Partial<{
 *   provider: "lm_studio" | "ollama" | null,
 *   lm_studio_url: string | null,
 *   ollama_url: string | null,
 *   model: string | null,
 * }>
 *   - Non-empty string sets the override for that key.
 *   - Empty string or explicit null clears the override (falls back to global).
 *   - Omitting the key leaves the existing override unchanged.
 *
 * After persisting overrides to SQLite, the project's on-disk `.pi/models.json`
 * is regenerated so Pi can use the new values on its next run.
 */
export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const projectId = parseId(id);
  if (projectId == null) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const overrides = updateProjectSettings(
      projectId,
      (body ?? {}) as UpdateProjectSettingsInput,
    );
    // Keep the on-disk .pi/models.json in sync with the DB so the agent
    // session sees the most recent config on its next spawn.
    writeProjectPiSettings(project);

    const effective = getProjectEffectiveSettings(projectId);
    return NextResponse.json({ overrides, effective });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
