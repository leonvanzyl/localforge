import { sqliteTable, integer, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Drizzle schema for LocalForge.
 *
 * Mirrors the <database_schema> block in app_spec.txt. The coding agent is
 * expected to generate and apply the first migration via:
 *     npx drizzle-kit generate
 *     npx drizzle-kit migrate
 *
 * Feature 1 (Database schema applied correctly) verifies these tables exist.
 */

export const projects = sqliteTable(
  "projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    folderPath: text("folder_path").notNull(),
    status: text("status").notNull().default("active"), // active | completed | archived
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    folderPathUnique: uniqueIndex("projects_folder_path_unique").on(t.folderPath),
  }),
);

export const features = sqliteTable(
  "features",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    acceptanceCriteria: text("acceptance_criteria"),
    status: text("status").notNull().default("backlog"), // backlog | in_progress | completed
    priority: integer("priority").notNull().default(0),
    category: text("category").notNull().default("functional"), // functional | style
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    projectIdIdx: index("features_project_id_idx").on(t.projectId),
  }),
);

export const featureDependencies = sqliteTable(
  "feature_dependencies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    featureId: integer("feature_id")
      .notNull()
      .references(() => features.id, { onDelete: "cascade" }),
    dependsOnFeatureId: integer("depends_on_feature_id")
      .notNull()
      .references(() => features.id, { onDelete: "cascade" }),
  },
  (t) => ({
    featureIdIdx: index("feature_deps_feature_id_idx").on(t.featureId),
    dependsOnIdx: index("feature_deps_depends_on_idx").on(t.dependsOnFeatureId),
  }),
);

export const agentSessions = sqliteTable(
  "agent_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    featureId: integer("feature_id").references(() => features.id, {
      onDelete: "set null",
    }),
    sessionType: text("session_type").notNull(), // coding | bootstrapper
    status: text("status").notNull().default("in_progress"), // in_progress | completed | failed | terminated
    startedAt: text("started_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    endedAt: text("ended_at"),
  },
  (t) => ({
    projectIdIdx: index("agent_sessions_project_id_idx").on(t.projectId),
  }),
);

export const agentLogs = sqliteTable(
  "agent_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    featureId: integer("feature_id").references(() => features.id, {
      onDelete: "set null",
    }),
    message: text("message").notNull(),
    messageType: text("message_type").notNull().default("info"), // info | action | error | screenshot | test_result
    screenshotPath: text("screenshot_path"),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    sessionIdIdx: index("agent_logs_session_id_idx").on(t.sessionId),
  }),
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    sessionIdIdx: index("chat_messages_session_id_idx").on(t.sessionId),
  }),
);

export const settings = sqliteTable(
  "settings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (t) => ({
    keyPerProjectUnique: uniqueIndex("settings_project_key_unique").on(
      t.projectId,
      t.key,
    ),
  }),
);
