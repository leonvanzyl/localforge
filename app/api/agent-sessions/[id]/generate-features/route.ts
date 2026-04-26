import { NextRequest, NextResponse } from "next/server";
import {
  createAgentSession,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import {
  closeAgentSession,
  getAgentSession,
  listChatMessages,
} from "@/lib/agent-sessions";
import {
  buildFeatureCrudTools,
} from "@/lib/agent/feature-crud-tools";
import {
  createPiModelRuntime,
  createPiResourceLoader,
} from "@/lib/agent/pi-runtime";
import { listFeaturesForProject } from "@/lib/features";
import { getProject } from "@/lib/projects";
import { getEffectiveProviderConfig } from "@/lib/settings";

export const runtime = "nodejs";
// Feature generation against a local model can take minutes; extend
// Next.js's per-request timeout so the agent has room to finish.
export const maxDuration = 600;

type RouteContext = { params: Promise<{ id: string }> };

function parseId(idStr: string): number | null {
  const n = Number.parseInt(idStr, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const FEATURE_GEN_SYSTEM_PROMPT = `You are LocalForge's feature-generation agent.

You are given a user/assistant chat describing an app the user wants to build.
Your job is to turn that conversation into a complete backlog of 6-15 features
by calling the provided LocalForge feature tools. You have
NO access to files, bash, or the user. Every change must go through a tool.

Workflow:
1. Call list_features to see what (if anything) is already in the backlog.
2. Plan the build in dependency order: foundational work first (SQLite
   schema / migrations, basic app shell, core data model), then behaviour,
   then polish.
3. Call create_feature for each item, in order. Pass depends_on with the
   ids of earlier features that must complete first (from step 1 or from
   earlier create_feature responses). Depends_on must ONLY reference
   features that already exist.
4. Make sure the backlog contains at least one feature for the kanban /
   board UI and at least one feature for SQLite persistence — the build
   pipeline relies on both.
5. When you are done creating features, STOP calling tools and reply with
   a single short sentence summarising how many features you created.

Rules for each feature:
- Title: short imperative sentence under 100 characters.
- Description: one paragraph describing what "done" looks like, in plain
  English.
- Category: "functional" for behaviour/logic, "style" for purely visual
  polish. Default to "functional" when unsure.

Do NOT output code, markdown fences, JSON blobs, or long bullet lists in
your assistant text. All structured output goes through the tools.`;

/**
 * POST /api/agent-sessions/:id/generate-features
 *
 * Feature #59 — AI generates the feature list and populates the kanban.
 *
 * Invokes a Pi AgentSession with custom feature CRUD tools scoped to this
 * session's project. Built-in filesystem and shell tools are disabled for
 * this task, so every mutation goes through the validated feature APIs.
 *
 * When the agent finishes, we check the DB for newly-created features,
 * close the bootstrapper session, and return the count so the UI can
 * swap chat → kanban.
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

  const project = getProject(session.projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const effective = getEffectiveProviderConfig(project.id);
  const existingBefore = listFeaturesForProject(project.id).length;

  const transcript = history
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const toolCalls: Array<{ name: string; input: unknown }> = [];
  let finalAssistantText = "";
  let turns = 0;

  try {
    const piRuntime = createPiModelRuntime(effective);
    const resourceLoader = await createPiResourceLoader({
      cwd: project.folderPath,
      systemPrompt: FEATURE_GEN_SYSTEM_PROMPT,
      noContextFiles: true,
    });
    const { session: piSession } = await createAgentSession({
      cwd: project.folderPath,
      authStorage: piRuntime.authStorage,
      modelRegistry: piRuntime.modelRegistry,
      model: piRuntime.model,
      thinkingLevel: "off",
      sessionManager: SessionManager.inMemory(project.folderPath),
      resourceLoader,
      noTools: "builtin",
      customTools: buildFeatureCrudTools(project.id),
    });

    const unsubscribe = piSession.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        toolCalls.push({ name: event.toolName, input: event.args });
        console.log(
          `[generate-features] tool_use ${event.toolName}`,
          JSON.stringify(event.args).slice(0, 300),
        );
      } else if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        finalAssistantText += event.assistantMessageEvent.delta;
      } else if (event.type === "turn_end") {
        turns++;
        if (turns >= 40) {
          void piSession.abort();
        }
      }
    });

    abort.signal.addEventListener("abort", () => void piSession.abort(), {
      once: true,
    });

    try {
      await piSession.prompt(
        `The bootstrapper chat transcript follows. Generate the backlog now.\n\n${transcript}`,
        {
          expandPromptTemplates: false,
          source: "extension",
        },
      );
    } finally {
      unsubscribe();
      piSession.dispose();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[generate-features] agent failed:", msg);
    return NextResponse.json(
      { error: `Agent failed: ${msg}` },
      { status: 502 },
    );
  }

  const features = listFeaturesForProject(project.id);
  const createdCount = features.length - existingBefore;

  if (createdCount <= 0) {
    return NextResponse.json(
      {
        error:
          "The agent finished without creating any features. Try again with a clearer description.",
        toolCalls: toolCalls.length,
        turns,
        summary: finalAssistantText.slice(0, 500),
      },
      { status: 502 },
    );
  }

  closeAgentSession(sessionId, "completed");

  return NextResponse.json({
    count: createdCount,
    total: features.length,
    projectId: project.id,
    toolCalls: toolCalls.length,
    summary: finalAssistantText.slice(0, 500),
  });
}
