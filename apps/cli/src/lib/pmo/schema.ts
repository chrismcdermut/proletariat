/**
 * PMO Schema - Single Source of Truth
 *
 * All PMO table definitions live here. Both database/index.ts and
 * storage-sqlite.ts import from this file to ensure schema consistency.
 *
 * As of PRLT-1299, the local ticket store, local workflow definitions, and
 * vestigial tables have been removed. The provider (Linear, Jira, etc.) is
 * now the source of truth for tickets and workflows.
 *
 * Tables kept:
 * - pmo_projects — HQ scoping
 * - pmo_settings — workspace configuration
 * - pmo_actions — work action definitions (agent prompts)
 * - pmo_workflow_rules — state-to-action wiring
 * - pmo_work_hooks — event-driven lifecycle hooks
 * - pmo_transition_map — intent → provider state mapping (created by migration 0020)
 * - pmo_external_issue_map — registry of tickets prlt knows about (rekeyed by provider ID)
 * - pmo_external_execution_map — links external issues to executions
 * - pmo_external_execution_prs — PR links for external executions
 * - pmo_ticket_metadata — free-form metadata keyed by provider ticket ID
 * - agent_work, ticket_refs, containers, id_sequences — execution infrastructure
 */

// =============================================================================
// Table Names (all PMO tables use pmo_ prefix in workspace.db)
// =============================================================================

export const PMO_TABLES = {
  projects: 'pmo_projects',
  settings: 'pmo_settings',
  agent_work: 'agent_work',
  ticket_refs: 'ticket_refs',           // Runtime ticket cache (provider-agnostic)
  containers: 'containers',             // Docker containers per agent
  id_sequences: 'id_sequences',         // Sequence counters for ID generation
  actions: 'pmo_actions',               // Work actions (reusable agent prompts)
  workflow_rules: 'pmo_workflow_rules',  // Workflow rules (state-to-action wiring)
  work_hooks: 'pmo_work_hooks',         // Configurable event-driven actions for work events
  // External issue registry (provider is source of truth)
  external_issue_map: 'pmo_external_issue_map',
  external_execution_map: 'pmo_external_execution_map',
  external_execution_prs: 'pmo_external_execution_prs',
  // Free-form metadata keyed by provider ticket ID
  ticket_metadata: 'pmo_ticket_metadata',
} as const;

// =============================================================================
// Individual Table Schemas
// =============================================================================

export const PMO_TABLE_SCHEMAS = {
  projects: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.projects} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      is_archived INTEGER NOT NULL DEFAULT 0,
      target_date TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

  // Runtime ticket cache (provider-agnostic, replaces the dependency on pmo_tickets)
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

  actions: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.actions} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      prompt TEXT NOT NULL,
      end_prompt TEXT,
      from_state TEXT,
      to_state TEXT,
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

  // Workflow rules — wire state transitions to actions
  workflow_rules: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.workflow_rules} (
      id TEXT PRIMARY KEY,
      from_state TEXT,
      to_state TEXT NOT NULL,
      action_id TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'on_enter')),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP,
      FOREIGN KEY (action_id) REFERENCES ${PMO_TABLES.actions}(id) ON DELETE CASCADE
    )`,

  // External issue registry — tickets prlt knows about, keyed by provider ID
  external_issue_map: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.external_issue_map} (
      provider TEXT NOT NULL CHECK (provider IN ('linear', 'jira', 'shortcut', 'trello', 'github')),
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

  // Free-form metadata keyed by provider ticket ID (e.g., PRLT-1299)
  ticket_metadata: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.ticket_metadata} (
      ticket_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (ticket_id, key)
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
  CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_provider ON ${PMO_TABLES.external_issue_map}(provider);
  CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_external_key ON ${PMO_TABLES.external_issue_map}(provider, external_key);
  CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_team_key ON ${PMO_TABLES.external_issue_map}(provider, team_key);
  CREATE INDEX IF NOT EXISTS idx_pmo_external_execution_map_external_key ON ${PMO_TABLES.external_execution_map}(provider, external_key);
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
 */
export const PMO_SCHEMA_SQL = [
  PMO_TABLE_SCHEMAS.projects,
  PMO_TABLE_SCHEMAS.settings,
  PMO_TABLE_SCHEMAS.agent_work,
  PMO_TABLE_SCHEMAS.ticket_refs,
  PMO_TABLE_SCHEMAS.containers,
  PMO_TABLE_SCHEMAS.id_sequences,
  PMO_TABLE_SCHEMAS.actions,
  PMO_TABLE_SCHEMAS.workflow_rules,
  PMO_TABLE_SCHEMAS.external_issue_map,
  PMO_TABLE_SCHEMAS.external_execution_map,
  PMO_TABLE_SCHEMAS.external_execution_prs,
  PMO_TABLE_SCHEMAS.ticket_metadata,
  PMO_TABLE_SCHEMAS.work_hooks,
  PMO_INDEXES,
].join(';\n');
