/**
 * PMO Schema — Legacy Raw SQL Definitions
 *
 * PRLT-1302: The single source of truth for table schema is now
 * `database/drizzle-schema.ts`. The Drizzle ORM schema definitions
 * drive table creation via Drizzle Kit migrations (`drizzle/`).
 *
 * This file is retained only for:
 * - PMO_TABLES: table name constants used across the codebase
 * - PMO_TABLE_SCHEMAS / PMO_SCHEMA_SQL: referenced by legacy migrations
 *   (0001_baseline, 0016_schema_catchup) and db-safety.ts validation.
 *   These are @deprecated and should NOT be used in new code.
 *
 * PRLT-1299: Dead tables removed. Provider (Linear/Jira) is the source of truth
 * for tickets, workflows, and board state.
 */

// =============================================================================
// Table Names (all PMO tables use pmo_ prefix in workspace.db)
// =============================================================================

export const PMO_TABLES = {
  projects: 'pmo_projects',
  categories: 'pmo_categories',
  ticket_metadata: 'pmo_ticket_metadata',
  settings: 'pmo_settings',
  agent_work: 'agent_work',
  ticket_refs: 'ticket_refs',  // Runtime ticket cache (provider-agnostic)
  containers: 'containers',  // Docker containers per agent
  id_sequences: 'id_sequences',  // Sequence counters for ID generation
  phases: 'pmo_phases',  // Project lifecycle phases (workspace-scoped)
  phase_templates: 'pmo_phase_templates',  // Phase configuration templates
  actions: 'pmo_actions',  // Work actions (reusable agent prompts)
  workflow_rules: 'pmo_workflow_rules',  // Workflow rules (state-to-action wiring)
  ticket_templates: 'pmo_ticket_templates',  // Ticket templates for quick creation
  // Label system tables
  label_groups: 'pmo_label_groups',
  labels: 'pmo_labels',
  // Generic external issue ↔ ticket mapping (provider-agnostic)
  external_issue_map: 'pmo_external_issue_map',
  // Provider-agnostic external issue/execution mapping
  external_execution_map: 'pmo_external_execution_map',
  external_execution_links: 'pmo_external_execution_links',
  external_execution_prs: 'pmo_external_execution_prs',
  // Asana integration tables
  asana_task_map: 'pmo_asana_task_map',  // Asana task ↔ ticket mapping
  // Trello integration tables
  trello_card_map: 'pmo_trello_card_map',  // Trello card ↔ ticket mapping
  // Work lifecycle hooks
  work_hooks: 'pmo_work_hooks',  // Configurable event-driven actions for work events
} as const;

// =============================================================================
// Individual Table Schemas
// @deprecated PRLT-1302 — use drizzle-schema.ts for new code.
// Kept for legacy migrations (0001, 0016) and db-safety.ts only.
// =============================================================================

export const PMO_TABLE_SCHEMAS = {
  projects: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.projects} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      phase_id TEXT,
      workflow_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      target_date TIMESTAMP,
      initiative_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (phase_id) REFERENCES ${PMO_TABLES.phases}(id) ON DELETE SET NULL
    )`,

  // Categories for tickets and status types
  categories: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.categories} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('ticket', 'status')),
      description TEXT,
      color TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, type)
    )`,

  ticket_metadata: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.ticket_metadata} (
      ticket_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (ticket_id, key)
    )`,

  settings: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.settings} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,

  agent_work: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.agent_work} (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      executor TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'host',
      display_mode TEXT NOT NULL DEFAULT 'terminal',
      permission_mode TEXT NOT NULL DEFAULT 'safe',
      status TEXT NOT NULL DEFAULT 'starting',
      branch TEXT,
      pid TEXT,
      container_id TEXT,
      session_id TEXT,
      host TEXT,
      log_path TEXT,
      external_source TEXT,
      external_key TEXT,
      external_id TEXT,
      external_url TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP,
      exit_code INTEGER,
      error_message TEXT,
      cleanup_policy TEXT NOT NULL DEFAULT 'on-exit'
    )`,

  // Runtime ticket cache (provider-agnostic, replaces PMO dependency for agent_work)
  ticket_refs: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.ticket_refs} (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'pmo',
      external_id TEXT,
      external_key TEXT,
      external_url TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT,
      priority TEXT,
      category TEXT,
      assignee TEXT,
      project_id TEXT,
      cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, external_id)
    )`,

  // Docker containers (per-agent, reused across executions)
  containers: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.containers} (
      id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      docker_id TEXT NOT NULL,
      docker_name TEXT,
      image TEXT,
      status TEXT NOT NULL DEFAULT 'unknown',
      current_execution_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_name) REFERENCES agents(name) ON DELETE CASCADE,
      FOREIGN KEY (current_execution_id) REFERENCES ${PMO_TABLES.agent_work}(id) ON DELETE SET NULL
    )`,

  // Sequence counters for ID generation (avoids collisions after deletions)
  id_sequences: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.id_sequences} (
      table_name TEXT PRIMARY KEY,
      next_id INTEGER NOT NULL DEFAULT 1
    )`,

  // Project lifecycle phases (workspace-scoped, not per-project)
  phases: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.phases} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

  // Phase templates (preset phase configurations)
  phase_templates: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.phase_templates} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      phases TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

  actions: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.actions} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      prompt TEXT NOT NULL,
      end_prompt TEXT,
      from_intent TEXT,
      to_intent TEXT,
      valid_from TEXT,
      executor TEXT CHECK (executor IN ('claude', 'codex', 'opencode', 'custom')),
      environment TEXT CHECK (environment IN ('devcontainer', 'docker', 'host', 'vm')),
      permission_mode TEXT CHECK (permission_mode IN ('full', 'readonly', 'bypassPermissions')),
      timeout INTEGER,
      model TEXT,
      review_gate TEXT CHECK (review_gate IN ('required', 'auto', 'post')),
      network_allowlist TEXT,
      modifies_code INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP
    )`,

  // Workflow rules — wire intent transitions to actions
  workflow_rules: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.workflow_rules} (
      id TEXT PRIMARY KEY,
      from_intent TEXT,
      to_intent TEXT NOT NULL,
      action_id TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'on_enter')),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP,
      FOREIGN KEY (action_id) REFERENCES ${PMO_TABLES.actions}(id) ON DELETE CASCADE
    )`,

  // Ticket templates for quick ticket creation
  ticket_templates: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.ticket_templates} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      title_pattern TEXT,
      description_template TEXT,
      default_priority TEXT,
      default_category TEXT,
      default_status_id TEXT,
      default_assignee TEXT,
      default_owner TEXT,
      default_labels TEXT NOT NULL DEFAULT '[]',
      suggested_subtasks TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

  // Label groups (workspace-scoped grouping for labels)
  label_groups: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.label_groups} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_exclusive INTEGER NOT NULL DEFAULT 1,
      is_required INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

  // Labels (workspace-scoped, optionally grouped)
  labels: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.labels} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      description TEXT,
      group_id TEXT REFERENCES ${PMO_TABLES.label_groups}(id) ON DELETE SET NULL,
      position INTEGER NOT NULL DEFAULT 0,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, group_id)
    )`,

  // Generic external issue ↔ ticket mapping (provider-agnostic, rekeyed by provider ID)
  external_issue_map: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.external_issue_map} (
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      external_key TEXT NOT NULL,
      external_url TEXT NOT NULL,
      team_key TEXT NOT NULL,
      sync_direction TEXT NOT NULL DEFAULT 'inbound',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider, external_id)
    )`,

  // Provider-agnostic external issue ↔ execution mapping
  external_execution_map: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.external_execution_map} (
      provider TEXT NOT NULL CHECK (provider IN ('linear', 'jira', 'shortcut', 'asana', 'trello', 'monday', 'pmo')),
      external_id TEXT NOT NULL,
      external_key TEXT,
      canonical_url TEXT,
      latest_state_snapshot TEXT,
      last_synced_at TIMESTAMP,
      last_spawned_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider, external_id)
    )`,

  // Linked execution IDs for external mappings
  external_execution_links: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.external_execution_links} (
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider, external_id, execution_id),
      FOREIGN KEY (provider, external_id)
        REFERENCES ${PMO_TABLES.external_execution_map}(provider, external_id)
        ON DELETE CASCADE
    )`,

  // Linked PR URLs for external mappings
  external_execution_prs: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.external_execution_prs} (
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      pr_url TEXT NOT NULL,
      linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider, external_id, pr_url),
      FOREIGN KEY (provider, external_id)
        REFERENCES ${PMO_TABLES.external_execution_map}(provider, external_id)
        ON DELETE CASCADE
    )`,

  // Work lifecycle hooks: configurable event-driven actions
  work_hooks: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.work_hooks} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      event TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('shell', 'webhook', 'log')),
      action_value TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
} as const;

// =============================================================================
// Indexes
// =============================================================================

export const PMO_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_pmo_projects_status ON ${PMO_TABLES.projects}(status);
  CREATE INDEX IF NOT EXISTS idx_pmo_projects_phase ON ${PMO_TABLES.projects}(phase_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_projects_archived ON ${PMO_TABLES.projects}(is_archived);
  CREATE INDEX IF NOT EXISTS idx_agent_work_agent ON ${PMO_TABLES.agent_work}(agent_name);
  CREATE INDEX IF NOT EXISTS idx_agent_work_status ON ${PMO_TABLES.agent_work}(status);
  CREATE INDEX IF NOT EXISTS idx_agent_work_ticket ON ${PMO_TABLES.agent_work}(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_ticket_refs_provider ON ${PMO_TABLES.ticket_refs}(provider);
  CREATE INDEX IF NOT EXISTS idx_ticket_refs_external_key ON ${PMO_TABLES.ticket_refs}(provider, external_key);
  CREATE INDEX IF NOT EXISTS idx_ticket_refs_status ON ${PMO_TABLES.ticket_refs}(status);
  CREATE INDEX IF NOT EXISTS idx_ticket_refs_project ON ${PMO_TABLES.ticket_refs}(project_id);
  CREATE INDEX IF NOT EXISTS idx_containers_agent ON ${PMO_TABLES.containers}(agent_name);
  CREATE INDEX IF NOT EXISTS idx_containers_docker_id ON ${PMO_TABLES.containers}(docker_id);
  CREATE INDEX IF NOT EXISTS idx_containers_status ON ${PMO_TABLES.containers}(status);
  CREATE INDEX IF NOT EXISTS idx_pmo_phases_category ON ${PMO_TABLES.phases}(category);
  CREATE INDEX IF NOT EXISTS idx_pmo_phases_position ON ${PMO_TABLES.phases}(category, position);
  CREATE INDEX IF NOT EXISTS idx_pmo_ticket_templates_builtin ON ${PMO_TABLES.ticket_templates}(is_builtin);
  CREATE INDEX IF NOT EXISTS idx_pmo_categories_type ON ${PMO_TABLES.categories}(type);
  CREATE INDEX IF NOT EXISTS idx_pmo_categories_position ON ${PMO_TABLES.categories}(type, position);
  CREATE INDEX IF NOT EXISTS idx_pmo_label_groups_position ON ${PMO_TABLES.label_groups}(position);
  CREATE INDEX IF NOT EXISTS idx_pmo_labels_group ON ${PMO_TABLES.labels}(group_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_labels_position ON ${PMO_TABLES.labels}(group_id, position);
  CREATE INDEX IF NOT EXISTS idx_pmo_labels_builtin ON ${PMO_TABLES.labels}(is_builtin);
  CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_provider ON ${PMO_TABLES.external_issue_map}(provider);
  CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_external_key ON ${PMO_TABLES.external_issue_map}(provider, external_key);
  CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_team_key ON ${PMO_TABLES.external_issue_map}(provider, team_key);
  CREATE INDEX IF NOT EXISTS idx_pmo_external_execution_map_external_key ON ${PMO_TABLES.external_execution_map}(provider, external_key);
  CREATE INDEX IF NOT EXISTS idx_pmo_external_execution_links_execution_id ON ${PMO_TABLES.external_execution_links}(execution_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_external_execution_prs_pr_url ON ${PMO_TABLES.external_execution_prs}(pr_url);
  CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_event ON ${PMO_TABLES.work_hooks}(event);
  CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_enabled ON ${PMO_TABLES.work_hooks}(enabled);
`;

// =============================================================================
// Combined Schema
// =============================================================================

/**
 * All PMO table creation statements combined.
 * Order matters due to foreign key dependencies.
 * @deprecated PRLT-1302 — Drizzle Kit migrations now handle table creation.
 * Kept for legacy migration 0001_baseline.ts.
 */
export const PMO_SCHEMA_SQL = [
  PMO_TABLE_SCHEMAS.phases,  // Project phases (before projects for FK)
  PMO_TABLE_SCHEMAS.phase_templates,  // Phase templates
  PMO_TABLE_SCHEMAS.projects,
  PMO_TABLE_SCHEMAS.categories,  // Ticket and status categories
  PMO_TABLE_SCHEMAS.ticket_metadata,
  PMO_TABLE_SCHEMAS.settings,
  PMO_TABLE_SCHEMAS.agent_work,  // Execution tracking
  PMO_TABLE_SCHEMAS.ticket_refs,  // Runtime ticket cache
  PMO_TABLE_SCHEMAS.containers,  // Docker containers per agent
  PMO_TABLE_SCHEMAS.id_sequences,  // Sequence counters for ID generation
  PMO_TABLE_SCHEMAS.actions,  // Work actions (reusable agent prompts)
  PMO_TABLE_SCHEMAS.workflow_rules,  // Workflow rules (state-to-action wiring)
  PMO_TABLE_SCHEMAS.ticket_templates,  // Ticket templates for quick creation
  PMO_TABLE_SCHEMAS.label_groups,  // Label groups (before labels for FK)
  PMO_TABLE_SCHEMAS.labels,  // Labels
  PMO_TABLE_SCHEMAS.external_issue_map,  // External issue ↔ ticket mapping
  PMO_TABLE_SCHEMAS.external_execution_map,  // External issue ↔ execution mapping
  PMO_TABLE_SCHEMAS.external_execution_links,  // External issue ↔ execution links
  PMO_TABLE_SCHEMAS.external_execution_prs,  // External issue ↔ PR links
  PMO_TABLE_SCHEMAS.work_hooks,  // Work lifecycle hooks
  PMO_INDEXES,
].join(';\n');
