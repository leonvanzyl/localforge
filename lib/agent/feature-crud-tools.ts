import "server-only";

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
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

type PiToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
};

const TEXT = (text: string, details: unknown = null): PiToolResult => ({
  content: [{ type: "text" as const, text }],
  details,
});

const JSON_BLOCK = (value: unknown) => TEXT(JSON.stringify(value, null, 2), value);

async function guard<T>(fn: () => Promise<T> | T): Promise<PiToolResult> {
  try {
    const out = await fn();
    if (out && typeof out === "object" && "content" in out) {
      const result = out as Partial<PiToolResult>;
      return {
        content: result.content ?? [],
        details: result.details ?? null,
      };
    }
    return JSON_BLOCK(out);
  } catch (err) {
    const message =
      err instanceof FeatureValidationError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return TEXT(`Error: ${message}`, { error: true, message });
  }
}

const CategorySchema = Type.Optional(
  Type.Union([Type.Literal("functional"), Type.Literal("style")]),
);

/**
 * Pi-native feature tools scoped to one project while preserving the same
 * validated database API boundary.
 */
export function buildFeatureCrudTools(projectId: number) {
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

  return [
    defineTool({
      name: "list_features",
      label: "List Features",
      description:
        "List every feature already in this project's backlog. Call this FIRST so you know which features already exist, what ids they have, and so you do not create duplicates.",
      promptSnippet: "List existing LocalForge backlog features for this project.",
      parameters: Type.Object({}),
      execute: async () =>
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
    }),
    defineTool({
      name: "create_feature",
      label: "Create Feature",
      description:
        "Create a new feature in this project's backlog. Returns the created feature with its assigned numeric id; reuse that id with add_dependency or set_dependencies to wire up prerequisites.",
      promptSnippet: "Create a LocalForge backlog feature for this project.",
      parameters: Type.Object({
        title: Type.String({
          minLength: 1,
          maxLength: MAX_TITLE_LENGTH,
          description:
            "Short imperative title. Example: 'Users can create a todo item'.",
        }),
        description: Type.Optional(
          Type.String({
            maxLength: MAX_DESCRIPTION_LENGTH,
            description:
              "One paragraph describing what done looks like for this feature.",
          }),
        ),
        category: CategorySchema,
        depends_on: Type.Optional(
          Type.Array(Type.Number({ minimum: 1 }), {
            description:
              "Optional ids of earlier features that must be completed before this one.",
          }),
        ),
      }),
      execute: async (_toolCallId, args) =>
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
              const reason = err instanceof Error ? err.message : String(err);
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
    }),
    defineTool({
      name: "update_feature",
      label: "Update Feature",
      description: "Edit an existing feature in this project. Only passed fields are changed.",
      parameters: Type.Object({
        id: Type.Number({ minimum: 1 }),
        title: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_TITLE_LENGTH })),
        description: Type.Optional(
          Type.Union([
            Type.String({ maxLength: MAX_DESCRIPTION_LENGTH }),
            Type.Null(),
          ]),
        ),
        category: CategorySchema,
        priority: Type.Optional(
          Type.Number({
            description: "Lower means higher up in the backlog. 0 is the top.",
          }),
        ),
      }),
      execute: async (_toolCallId, args) =>
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
    }),
    defineTool({
      name: "delete_feature",
      label: "Delete Feature",
      description: "Remove a feature from this project's backlog by id.",
      parameters: Type.Object({
        id: Type.Number({ minimum: 1 }),
      }),
      execute: async (_toolCallId, args) =>
        guard(() => {
          assertSameProject(args.id);
          const ok = deleteFeature(args.id);
          return TEXT(
            ok ? `Deleted feature ${args.id}.` : `Feature ${args.id} not found.`,
          );
        }),
    }),
    defineTool({
      name: "add_dependency",
      label: "Add Dependency",
      description:
        "Declare that one feature depends on another. Both features must belong to this project. Rejected if it would create a cycle.",
      parameters: Type.Object({
        feature_id: Type.Number({
          minimum: 1,
          description: "The feature that depends on another.",
        }),
        depends_on_feature_id: Type.Number({
          minimum: 1,
          description: "The prerequisite feature that must be done first.",
        }),
      }),
      execute: async (_toolCallId, args) =>
        guard(() => {
          assertSameProject(args.feature_id);
          assertSameProject(args.depends_on_feature_id);
          addDependency(args.feature_id, args.depends_on_feature_id);
          return TEXT(
            `Feature ${args.feature_id} now depends on ${args.depends_on_feature_id}.`,
          );
        }),
    }),
    defineTool({
      name: "remove_dependency",
      label: "Remove Dependency",
      description: "Remove a dependency link between two features in this project.",
      parameters: Type.Object({
        feature_id: Type.Number({ minimum: 1 }),
        depends_on_feature_id: Type.Number({ minimum: 1 }),
      }),
      execute: async (_toolCallId, args) =>
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
    }),
    defineTool({
      name: "set_dependencies",
      label: "Set Dependencies",
      description:
        "Replace the full dependency list for a feature in a single call. Pass depends_on=[] to clear all dependencies.",
      parameters: Type.Object({
        feature_id: Type.Number({ minimum: 1 }),
        depends_on: Type.Array(Type.Number({ minimum: 1 })),
      }),
      execute: async (_toolCallId, args) =>
        guard(() => {
          assertSameProject(args.feature_id);
          for (const dependencyId of args.depends_on) {
            assertSameProject(dependencyId);
          }
          const deps = setDependencies(args.feature_id, args.depends_on);
          return JSON_BLOCK(deps.map((d) => ({ id: d.id, title: d.title })));
        }),
    }),
  ];
}

export const FEATURE_CRUD_TOOL_NAMES = [
  "list_features",
  "create_feature",
  "update_feature",
  "delete_feature",
  "add_dependency",
  "remove_dependency",
  "set_dependencies",
] as const;
