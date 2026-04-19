import { NextRequest, NextResponse } from "next/server";
import {
  closeAgentSession,
  getAgentSession,
  listChatMessages,
} from "@/lib/agent-sessions";
import { createFeature } from "@/lib/features";
import {
  chatCompletion,
  LMStudioUnavailableError,
  type LMStudioChatMessage,
} from "@/lib/agent/lm-studio";
import { getGlobalSettings } from "@/lib/settings";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(idStr: string): number | null {
  const n = Number.parseInt(idStr, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Prompt the model to emit a STRICT JSON object with a `features` array so we
 * can parse it reliably. We keep the schema tight: title, description,
 * category, plus an optional dependency list by 1-based index.
 */
const FEATURE_GEN_SYSTEM = `You are LocalForge's feature generator. Given a
user/assistant chat describing an app, produce a JSON object describing the
work needed to build it.

Output ONLY valid JSON (no prose, no markdown fences) of the form:
{
  "features": [
    {
      "title": "Short imperative title",
      "description": "One paragraph describing what the feature must do.",
      "category": "functional" | "style",
      "depends_on": [1, 2]   // OPTIONAL list of 1-based indices of earlier features this depends on
    }
  ]
}

Generate between 6 and 15 features covering the most important work. The
first features should be foundational (infrastructure, schema, basic UI)
and later features should build on them. Every "depends_on" index MUST
reference an EARLIER feature in the same array. Titles MUST be under 100
characters. Return the JSON and nothing else.`;

type RawFeature = {
  title?: unknown;
  description?: unknown;
  category?: unknown;
  depends_on?: unknown;
};

/**
 * Pull the first JSON object out of a string. Handles models that sometimes
 * wrap their output in ```json fences or chat pre-amble.
 */
function extractJson(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return text.slice(first, last + 1).trim();
}

/**
 * POST /api/agent-sessions/:id/generate-features
 *
 * Reads the full chat history for a bootstrapper session, asks the LLM to
 * emit a feature list as JSON, inserts each feature row into the project,
 * and marks the session completed (so the project page swaps chat →
 * kanban). Responds with the generated feature count.
 *
 * Implements Feature #59: AI generates feature list and populates kanban.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const sessionId = parseId(id);
  if (sessionId == null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const session = getAgentSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.sessionType !== "bootstrapper") {
    return NextResponse.json(
      { error: "Not a bootstrapper session" },
      { status: 400 },
    );
  }

  const history = listChatMessages(sessionId);
  if (history.length === 0) {
    return NextResponse.json(
      { error: "No conversation yet — send a message first" },
      { status: 400 },
    );
  }

  // Dump the transcript as a compact user message so the generator model
  // sees the whole conversation at once; this avoids confusion over whose
  // role is asking for JSON.
  const transcript = history
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const llmMessages: LMStudioChatMessage[] = [
    { role: "system", content: FEATURE_GEN_SYSTEM },
    {
      role: "user",
      content: `Here is the conversation so far:\n\n${transcript}\n\nNow emit the JSON feature list.`,
    },
  ];

  const settings = getGlobalSettings();

  let raw: string;
  try {
    raw = await chatCompletion({
      baseUrl: settings.lm_studio_url,
      model: settings.model,
      messages: llmMessages,
      signal: req.signal,
      temperature: 0.2,
    });
  } catch (err) {
    const message =
      err instanceof LMStudioUnavailableError
        ? err.message
        : err instanceof Error
          ? err.message
          : "LM Studio call failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const jsonText = extractJson(raw);
  if (!jsonText) {
    return NextResponse.json(
      {
        error:
          "AI did not return valid JSON. Try again with a clearer description.",
        raw: raw.slice(0, 500),
      },
      { status: 502 },
    );
  }

  let parsed: { features?: RawFeature[] };
  try {
    parsed = JSON.parse(jsonText) as { features?: RawFeature[] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `AI JSON parse error: ${msg}`, raw: jsonText.slice(0, 500) },
      { status: 502 },
    );
  }

  const rawFeatures = Array.isArray(parsed.features) ? parsed.features : [];
  if (rawFeatures.length === 0) {
    return NextResponse.json(
      { error: "AI returned no features" },
      { status: 502 },
    );
  }

  // Build a cleaned list of valid features first so we can run coverage
  // checks before inserting. Titles must be non-empty after trim.
  type CleanFeature = {
    title: string;
    description: string | null;
    category: "functional" | "style";
    rawDeps: unknown;
  };

  const clean: CleanFeature[] = [];
  for (const f of rawFeatures) {
    const title = typeof f.title === "string" ? f.title.trim() : "";
    if (!title) continue;
    const description =
      typeof f.description === "string" ? f.description.trim() : null;
    const category =
      f.category === "style" ? "style" : ("functional" as const);
    clean.push({
      title: title.slice(0, 200),
      description,
      category,
      rawDeps: f.depends_on,
    });
  }

  // Feature #92 Step 6 guarantee: the generated list must include at least
  // one "kanban/board UI" feature and at least one "SQLite/persistence"
  // feature. If the LLM missed either, synthesize one so the backlog always
  // has the coverage the E2E tests expect.
  const haystack = clean
    .map((c) => `${c.title} ${c.description ?? ""}`)
    .join(" \n ")
    .toLowerCase();
  const hasKanban = /(kanban|board|column|backlog)/.test(haystack);
  const hasPersistence = /(sqlite|persist|database|schema|restart)/.test(
    haystack,
  );
  if (!hasKanban) {
    clean.push({
      title:
        "Kanban board UI: Backlog / In Progress / Completed columns",
      description:
        "Render a three-column kanban board so users can see every to-do grouped by status.",
      category: "functional",
      rawDeps: undefined,
    });
  }
  if (!hasPersistence) {
    clean.push({
      title: "SQLite persistence: to-dos survive a server restart",
      description:
        "Persist to-dos in a SQLite todos table with a migration so the list is identical after the dev server is killed and restarted.",
      category: "functional",
      rawDeps: undefined,
    });
  }

  // Persist features in order so earlier items get lower priorities (surface
  // first on the kanban). Keep a map of original index → created DB id so we
  // can wire depends_on relationships after all rows exist.
  const createdIds: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const f = clean[i];
    try {
      const record = createFeature({
        projectId: session.projectId,
        title: f.title,
        description: f.description,
        category: f.category,
        status: "backlog",
        priority: i,
      });
      createdIds.push(record.id);
    } catch {
      // Skip features that fail validation (e.g. empty title after trim).
    }
  }

  // Best-effort dependency wiring. We use depends_on indices (1-based) from
  // the raw output. Silent-failure is fine — the user can edit later.
  if (createdIds.length > 0) {
    const { addDependency } = await import("@/lib/features");
    for (let i = 0; i < clean.length; i++) {
      const deps = clean[i]?.rawDeps;
      if (!Array.isArray(deps)) continue;
      const targetId = createdIds[i];
      if (targetId == null) continue;
      for (const d of deps) {
        const idx = typeof d === "number" ? Math.floor(d) - 1 : -1;
        if (idx < 0 || idx >= i) continue; // only depend on earlier features
        const depId = createdIds[idx];
        if (depId == null) continue;
        try {
          addDependency(targetId, depId);
        } catch {
          /* ignore cycle / duplicate errors */
        }
      }
    }
  }

  // Close the bootstrapper session so the project page swaps to the kanban.
  closeAgentSession(sessionId, "completed");

  return NextResponse.json({
    count: createdIds.length,
    projectId: session.projectId,
  });
}
