CREATE INDEX `agent_logs_session_id_idx` ON `agent_logs` (`session_id`);--> statement-breakpoint
CREATE INDEX `agent_sessions_project_id_idx` ON `agent_sessions` (`project_id`);--> statement-breakpoint
CREATE INDEX `chat_messages_session_id_idx` ON `chat_messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `feature_deps_feature_id_idx` ON `feature_dependencies` (`feature_id`);--> statement-breakpoint
CREATE INDEX `feature_deps_depends_on_idx` ON `feature_dependencies` (`depends_on_feature_id`);--> statement-breakpoint
CREATE INDEX `features_project_id_idx` ON `features` (`project_id`);