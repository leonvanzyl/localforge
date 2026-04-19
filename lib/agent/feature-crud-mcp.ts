import "server-only";
import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import {
  addDependency,
  createFeature,
  deleteFeature,
  FeatureValidationError,
  getFeature,
  listFeaturesForProject,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  removeDependency,
  setDependencies,
  updateFeature,
} from "@/lib/features";

/**
 * In-process MCP server that exposes feature CRUD to a Claude Agent SDK
 * session. Every tool is bound to a single projectId captured in the
 * closure, so one generation run cannot touch features that belong to a
 * different project even if the model hallucinates an id.
 *
 * Wiring:
 *   const server = buildFeatureCrudMcpServer(project.id);
 *   await query({
 *     prompt,
 *     options: {
 *       mcpServers: { "feature-crud": server },
 *       allowedTools: [...FEATURE_CRUD_TOOL_NAMES],
 *       // ...
 *     },
 *   });
 *
 * Tool names on the wire are `mcp__feature-crud__<tool>` — the SDK adds
 * the `mcp__<server>__` prefix automatically.
 */

const TEXT = (text: string) => ({
  content: [{ type: "text" as const, text }],
});
const JSON_BLOCK = (value: unknown) =>
  TEXT(JSON.stringify(value, null, 2));
const ERROR = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true,
});

/**
 * Run a tool handler, converting FeatureValidationError + unexpected
 * errors into `isError` content so the agent sees the message and can
 * self-correct rather than the whole query tearing down.
 */
async function guard<T>(
  fn: () => Promise<T> | T,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const out = await fn();
    if (out && typeof out === "object" && "content" in out) {
      return out as { content: Array<{ type: "text"; text: string }> };
    }
    return JSON_BLOCK(out);
  } catch (err) {
    if (err instanceof FeatureValidationError) return ERROR(err.message);
    const msg = err instanceof Error ? err.message : String(err);
    return ERROR(`Unexpected error: ${msg}`);
  }
}

export function buildFeatureCrudMcpServer(
  projectId: number,
): McpSdkServerConfigWithInstance {
  const assertSameProject = (featureId: number): void => {
    const row = getFeature(featureId);
    if (!row) {
      throw new FeatureValidationError(`Feature ${featureId} not found`);
    }
    if (row.projectId !== projectId) {
      throw new FeatureValidationError(
        `Feature ${featureId} belongs to a different project`,
      );
    }
  };

  return createSdkMcpServer({
    name: "feature-crud",
    version: "1.0.0",
    tools: [
      tool(
        "list_features",
        "List every feature already in this project's backlog. Call this FIRST so you know which features already exist, what ids they have (for declaring dependencies), and so you do not create duplicates.",
        {},
        async () =>
          guard(() => {
            const rows = listFeaturesForProject(projectId);
            return JSON_BLOCK(
              rows.map((r) => ({
                id: r.id,
                title: r.title,
                description: r.description,
                category: r.category,
                status: r.status,
                priority: r.priority,
              })),
            );
          }),
      ),
      tool(
        "create_feature",
        "Create a new feature in this project's backlog. Returns the created feature with its assigned numeric id; reuse that id with add_dependency / set_dependencies to wire up prerequisites.",
        {
          title: z
            .string()
            .min(1)
            .max(MAX_TITLE_LENGTH)
            .describe(
              "Short imperative title (<=200 chars). Example: 'Users can create a todo item'.",
            ),
          description: z
            .string()
            .max(MAX_DESCRIPTION_LENGTH)
            .optional()
            .describe(
              "One paragraph describing what 'done' looks like for this feature.",
            ),
          category: z
            .enum(["functional", "style"])
            .optional()
            .describe(
              "functional = behaviour/logic; style = purely visual polish. Defaults to functional.",
            ),
          depends_on: z
            .array(z.number().int().positive())
            .optional()
            .describe(
              "Optional: ids of earlier features (returned by list_features or create_feature) that must be completed before this one.",
            ),
        },
        async (args) =>
          guard(() => {
            const created = createFeature({
              projectId,
              title: args.title,
              description: args.description ?? null,
              category: args.category,
            });
            const linked: number[] = [];
            const skipped: Array<{ id: number; reason: string }> = [];
            for (const depId of args.depends_on ?? []) {
              try {
                assertSameProject(depId);
                addDependency(created.id, depId);
                linked.push(depId);
              } catch (err) {
                const reason =
                  err instanceof Error ? err.message : String(err);
                skipped.push({ id: depId, reason });
              }
            }
            return JSON_BLOCK({
              id: created.id,
              title: created.title,
              description: created.description,
              category: created.category,
              priority: created.priority,
              linked_dependencies: linked,
              skipped_dependencies: skipped,
            });
          }),
      ),
      tool(
        "update_feature",
        "Edit an existing feature in this project. Only the fields you pass are changed.",
        {
          id: z.number().int().positive(),
          title: z.string().min(1).max(MAX_TITLE_LENGTH).optional(),
          description: z
            .string()
            .max(MAX_DESCRIPTION_LENGTH)
            .nullable()
            .optional(),
          category: z.enum(["functional", "style"]).optional(),
          priority: z
            .number()
            .int()
            .optional()
            .describe(
              "Lower = higher up in the backlog. 0 is the top. Use to reorder.",
            ),
        },
        async (args) =>
          guard(() => {
            assertSameProject(args.id);
            const updated = updateFeature(args.id, {
              title: args.title,
              description: args.description,
              category: args.category,
              priority: args.priority,
            });
            if (!updated) return TEXT(`Feature ${args.id} not found.`);
            return JSON_BLOCK({
              id: updated.id,
              title: updated.title,
              description: updated.description,
              category: updated.category,
              priority: updated.priority,
            });
          }),
      ),
      tool(
        "delete_feature",
        "Remove a feature from this project's backlog by id.",
        {
          id: z.number().int().positive(),
        },
        async (args) =>
          guard(() => {
            assertSameProject(args.id);
            const ok = deleteFeature(args.id);
            return TEXT(
              ok
                ? `Deleted feature ${args.id}.`
                : `Feature ${args.id} not found.`,
            );
          }),
      ),
      tool(
        "add_dependency",
        "Declare that one feature depends on another. Both features must belong to this project. Rejected if it would create a cycle.",
        {
          feature_id: z
            .number()
            .int()
            .positive()
            .describe("The feature that depends on another."),
          depends_on_feature_id: z
            .number()
            .int()
            .positive()
            .describe("The prerequisite feature that must be done first."),
        },
        async (args) =>
          guard(() => {
            assertSameProject(args.feature_id);
            assertSameProject(args.depends_on_feature_id);
            addDependency(args.feature_id, args.depends_on_feature_id);
            return TEXT(
              `Feature ${args.feature_id} now depends on ${args.depends_on_feature_id}.`,
            );
          }),
      ),
      tool(
        "remove_dependency",
        "Remove a dependency link between two features in this project.",
        {
          feature_id: z.number().int().positive(),
          depends_on_feature_id: z.number().int().positive(),
        },
        async (args) =>
          guard(() => {
            assertSameProject(args.feature_id);
            const ok = removeDependency(
              args.feature_id,
              args.depends_on_feature_id,
            );
            return TEXT(
              ok
                ? `Removed dependency ${args.feature_id} -> ${args.depends_on_feature_id}.`
                : "No such dependency.",
            );
          }),
      ),
      tool(
        "set_dependencies",
        "Replace the full dependency list for a feature in a single call. Pass depends_on=[] to clear all dependencies.",
        {
          feature_id: z.number().int().positive(),
          depends_on: z.array(z.number().int().positive()),
        },
        async (args) =>
          guard(() => {
            assertSameProject(args.feature_id);
            for (const d of args.depends_on) assertSameProject(d);
            const deps = setDependencies(
              args.feature_id,
              args.depends_on,
            );
            return JSON_BLOCK(
              deps.map((d) => ({ id: d.id, title: d.title })),
            );
          }),
      ),
    ],
  });
}

/** Fully-qualified MCP tool names, ready for `allowedTools`. */
export const FEATURE_CRUD_TOOL_NAMES = [
  "mcp__feature-crud__list_features",
  "mcp__feature-crud__create_feature",
  "mcp__feature-crud__update_feature",
  "mcp__feature-crud__delete_feature",
  "mcp__feature-crud__add_dependency",
  "mcp__feature-crud__remove_dependency",
  "mcp__feature-crud__set_dependencies",
] as const;
