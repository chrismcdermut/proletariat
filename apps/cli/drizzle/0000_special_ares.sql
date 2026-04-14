CREATE TABLE `agent_theme_names` (
	`theme_id` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`theme_id`, `name`)
);
--> statement-breakpoint
CREATE INDEX `idx_theme_names_theme` ON `agent_theme_names` (`theme_id`);--> statement-breakpoint
CREATE TABLE `agent_themes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`builtin` integer DEFAULT false,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_themes_name_unique` ON `agent_themes` (`name`);--> statement-breakpoint
CREATE TABLE `agent_worktrees` (
	`agent_name` text NOT NULL,
	`repo_name` text NOT NULL,
	`worktree_path` text NOT NULL,
	`branch` text NOT NULL,
	`created_at` text NOT NULL,
	`last_commit_hash` text,
	`commits_ahead` integer DEFAULT 0 NOT NULL,
	`is_clean` integer DEFAULT true NOT NULL,
	`last_checked` text,
	PRIMARY KEY(`agent_name`, `repo_name`)
);
--> statement-breakpoint
CREATE INDEX `idx_worktrees_agent` ON `agent_worktrees` (`agent_name`);--> statement-breakpoint
CREATE INDEX `idx_worktrees_repo` ON `agent_worktrees` (`repo_name`);--> statement-breakpoint
CREATE TABLE `agents` (
	`name` text PRIMARY KEY NOT NULL,
	`type` text DEFAULT 'persistent' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`base_name` text,
	`theme_id` text,
	`worktree_path` text,
	`mount_mode` text DEFAULT 'worktree' NOT NULL,
	`created_at` text NOT NULL,
	`cleaned_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_agents_theme` ON `agents` (`theme_id`);--> statement-breakpoint
CREATE INDEX `idx_agents_status` ON `agents` (`status`);--> statement-breakpoint
CREATE TABLE `media_items` (
	`name` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`source_path` text,
	`media_type` text DEFAULT 'video' NOT NULL,
	`duration_seconds` integer,
	`resolution` text,
	`frame_count` integer DEFAULT 0 NOT NULL,
	`has_transcript` integer DEFAULT false NOT NULL,
	`frame_interval` integer DEFAULT 30 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`added_at` text NOT NULL,
	`processed_at` text
);
--> statement-breakpoint
CREATE TABLE `pmo_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`prompt` text NOT NULL,
	`end_prompt` text,
	`from_intent` text,
	`to_intent` text,
	`executor` text,
	`environment` text,
	`permission_mode` text,
	`timeout` integer,
	`model` text,
	`review_gate` text,
	`network_allowlist` text,
	`modifies_code` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pmo_actions_name_unique` ON `pmo_actions` (`name`);--> statement-breakpoint
CREATE TABLE `agent_work` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`agent_name` text NOT NULL,
	`executor` text NOT NULL,
	`environment` text DEFAULT 'host' NOT NULL,
	`display_mode` text DEFAULT 'terminal' NOT NULL,
	`permission_mode` text DEFAULT 'safe' NOT NULL,
	`status` text DEFAULT 'starting' NOT NULL,
	`branch` text,
	`pid` text,
	`container_id` text,
	`session_id` text,
	`host` text,
	`log_path` text,
	`external_source` text,
	`external_key` text,
	`external_id` text,
	`external_url` text,
	`started_at` text DEFAULT CURRENT_TIMESTAMP,
	`completed_at` text,
	`exit_code` integer,
	`error_message` text,
	`cleanup_policy` text DEFAULT 'on-exit' NOT NULL,
	`gc_cleaned_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_agent_work_agent` ON `agent_work` (`agent_name`);--> statement-breakpoint
CREATE INDEX `idx_agent_work_status` ON `agent_work` (`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_work_ticket` ON `agent_work` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `pmo_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`description` text,
	`color` text,
	`position` integer DEFAULT 0 NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_pmo_categories_type` ON `pmo_categories` (`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `pmo_categories_name_type_unique` ON `pmo_categories` (`name`,`type`);--> statement-breakpoint
CREATE TABLE `containers` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_name` text NOT NULL,
	`docker_id` text NOT NULL,
	`docker_name` text,
	`image` text,
	`status` text DEFAULT 'unknown' NOT NULL,
	`current_execution_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_containers_agent` ON `containers` (`agent_name`);--> statement-breakpoint
CREATE INDEX `idx_containers_docker_id` ON `containers` (`docker_id`);--> statement-breakpoint
CREATE INDEX `idx_containers_status` ON `containers` (`status`);--> statement-breakpoint
CREATE TABLE `pmo_external_execution_links` (
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`execution_id` text NOT NULL,
	`linked_at` text DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`provider`, `external_id`, `execution_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_pmo_external_execution_links_execution_id` ON `pmo_external_execution_links` (`execution_id`);--> statement-breakpoint
CREATE TABLE `pmo_external_execution_map` (
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`external_key` text,
	`canonical_url` text,
	`latest_state_snapshot` text,
	`last_synced_at` text,
	`last_spawned_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`provider`, `external_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_pmo_external_execution_map_external_key` ON `pmo_external_execution_map` (`provider`,`external_key`);--> statement-breakpoint
CREATE TABLE `pmo_external_execution_prs` (
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`pr_url` text NOT NULL,
	`linked_at` text DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`provider`, `external_id`, `pr_url`)
);
--> statement-breakpoint
CREATE INDEX `idx_pmo_external_execution_prs_pr_url` ON `pmo_external_execution_prs` (`pr_url`);--> statement-breakpoint
CREATE TABLE `pmo_external_issue_map` (
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`external_key` text NOT NULL,
	`external_url` text NOT NULL,
	`team_key` text NOT NULL,
	`sync_direction` text DEFAULT 'inbound' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`provider`, `external_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_pmo_external_issue_map_provider` ON `pmo_external_issue_map` (`provider`);--> statement-breakpoint
CREATE INDEX `idx_pmo_external_issue_map_external_key` ON `pmo_external_issue_map` (`provider`,`external_key`);--> statement-breakpoint
CREATE INDEX `idx_pmo_external_issue_map_team_key` ON `pmo_external_issue_map` (`provider`,`team_key`);--> statement-breakpoint
CREATE TABLE `id_sequences` (
	`table_name` text PRIMARY KEY NOT NULL,
	`next_id` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pmo_label_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_exclusive` integer DEFAULT false NOT NULL,
	`is_required` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pmo_label_groups_name_unique` ON `pmo_label_groups` (`name`);--> statement-breakpoint
CREATE TABLE `pmo_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`description` text,
	`group_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_pmo_labels_group` ON `pmo_labels` (`group_id`);--> statement-breakpoint
CREATE TABLE `pmo_phase_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_builtin` integer DEFAULT false NOT NULL,
	`phases` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pmo_phase_templates_name_unique` ON `pmo_phase_templates` (`name`);--> statement-breakpoint
CREATE TABLE `pmo_phases` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`color` text,
	`description` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pmo_phases_name_unique` ON `pmo_phases` (`name`);--> statement-breakpoint
CREATE INDEX `idx_pmo_phases_category` ON `pmo_phases` (`category`);--> statement-breakpoint
CREATE INDEX `idx_pmo_phases_position` ON `pmo_phases` (`category`,`position`);--> statement-breakpoint
CREATE TABLE `pmo_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`template` text,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`phase_id` text,
	`workflow_id` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`target_date` text,
	`initiative_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_pmo_projects_initiative` ON `pmo_projects` (`initiative_id`);--> statement-breakpoint
CREATE INDEX `idx_pmo_projects_status` ON `pmo_projects` (`status`);--> statement-breakpoint
CREATE INDEX `idx_pmo_projects_phase` ON `pmo_projects` (`phase_id`);--> statement-breakpoint
CREATE INDEX `idx_pmo_projects_workflow` ON `pmo_projects` (`workflow_id`);--> statement-breakpoint
CREATE INDEX `idx_pmo_projects_archived` ON `pmo_projects` (`is_archived`);--> statement-breakpoint
CREATE TABLE `pmo_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pmo_ticket_metadata` (
	`ticket_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text,
	PRIMARY KEY(`ticket_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `ticket_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'pmo' NOT NULL,
	`external_id` text,
	`external_key` text,
	`external_url` text,
	`title` text NOT NULL,
	`description` text,
	`status` text,
	`priority` text,
	`category` text,
	`assignee` text,
	`project_id` text,
	`cached_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_ticket_refs_provider` ON `ticket_refs` (`provider`);--> statement-breakpoint
CREATE INDEX `idx_ticket_refs_external_key` ON `ticket_refs` (`provider`,`external_key`);--> statement-breakpoint
CREATE INDEX `idx_ticket_refs_status` ON `ticket_refs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_ticket_refs_project` ON `ticket_refs` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_refs_provider_external_id_unique` ON `ticket_refs` (`provider`,`external_id`);--> statement-breakpoint
CREATE TABLE `pmo_ticket_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_builtin` integer DEFAULT false NOT NULL,
	`title_pattern` text,
	`description_template` text,
	`default_priority` text,
	`default_category` text,
	`default_status_id` text,
	`default_assignee` text,
	`default_owner` text,
	`default_labels` text DEFAULT '[]' NOT NULL,
	`suggested_subtasks` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pmo_ticket_templates_name_unique` ON `pmo_ticket_templates` (`name`);--> statement-breakpoint
CREATE INDEX `idx_pmo_ticket_templates_builtin` ON `pmo_ticket_templates` (`is_builtin`);--> statement-breakpoint
CREATE TABLE `pmo_work_hooks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`event` text NOT NULL,
	`action_type` text NOT NULL,
	`action_value` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`description` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pmo_work_hooks_name_unique` ON `pmo_work_hooks` (`name`);--> statement-breakpoint
CREATE INDEX `idx_pmo_work_hooks_event` ON `pmo_work_hooks` (`event`);--> statement-breakpoint
CREATE INDEX `idx_pmo_work_hooks_enabled` ON `pmo_work_hooks` (`enabled`);--> statement-breakpoint
CREATE TABLE `pmo_workflow_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`from_intent` text,
	`to_intent` text NOT NULL,
	`action_id` text NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text,
	FOREIGN KEY (`action_id`) REFERENCES `pmo_actions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `repositories` (
	`name` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`type` text DEFAULT 'main',
	`source_url` text,
	`action` text,
	`added_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` integer PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`workspace_name` text NOT NULL,
	`has_pmo` integer DEFAULT false,
	`active_theme_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
