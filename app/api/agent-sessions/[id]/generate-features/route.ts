import { NextRequest, NextResponse } from "next/server";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  closeAgentSession,
  getAgentSession,
  listChatMessages,
} from "@/lib/agent-sessions";
import {
  buildFeatureCrudMcpServer,
  FEATURE_CRUD_TOOL_NAMES,
} from "@/lib/agent/feature-crud-mcp";
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
by calling the MCP tools exposed under the "feature-crud" server. You have
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
 * Invokes the Claude Agent SDK with an in-process "feature-crud" MCP
 * server that exposes CRUD + dependency tools scoped to this session's
 * project. The agent reads the bootstrapper chat transcript and calls
 * the tools to build the backlog. LM Studio is used by setting
 * ANTHROPIC_BASE_URL in the subprocess env — the SDK itself drives all
 * HTTP traffic; we never hit the OpenAI-compatible endpoint directly.
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

  const mcpServer = buildFeatureCrudMcpServer(project.id);

  const toolCalls: Array<{ name: string; input: unknown }> = [];
  let finalAssistantText = "";
  let resultSubtype: string | undefined;

  try {
    for await (const message of query({
      prompt: `The bootstrapper chat transcript follows. Generate the backlog now.\n\n${transcript}`,
      options: {
        systemPrompt: FEATURE_GEN_SYSTEM_PROMPT,
        mcpServers: { "feature-crud": mcpServer },
        allowedTools: [...FEATURE_CRUD_TOOL_NAMES],
        // Disable every built-in tool — the agent has no reason to touch
        // the filesystem or shell for this task.
        tools: [],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: effective.baseUrl,
        },
        model: effective.model,
        cwd: project.folderPath,
        maxTurns: 40,
        abortController: abort,
      },
    })) {
      if (message.type === "assistant") {
        const blocks = message.message.content as Array<{
          type: string;
          name?: string;
          input?: unknown;
          text?: string;
        }>;
        for (const block of blocks) {
          if (block.type === "tool_use" && typeof block.name === "string") {
            toolCalls.push({ name: block.name, input: block.input });
            console.log(
              `[generate-features] tool_use ${block.name}`,
              JSON.stringify(block.input).slice(0, 300),
            );
          } else if (block.type === "text" && typeof block.text === "string") {
            finalAssistantText = block.text;
          }
        }
      } else if (message.type === "result") {
        resultSubtype = message.subtype;
        console.log(
          `[generate-features] result subtype=${message.subtype} turns=${message.num_turns}`,
        );
      }
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
        resultSubtype,
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
