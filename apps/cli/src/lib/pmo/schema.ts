/**
 * PMO Schema - Single Source of Truth
 *
 * All PMO table definitions live here. Both database/index.ts and
 * storage-sqlite.ts import from this file to ensure schema consistency.
 */

// =============================================================================
// Table Names (all PMO tables use pmo_ prefix in workspace.db)
// =============================================================================

export const PMO_TABLES = {
  projects: 'pmo_projects',
  initiatives: 'pmo_initiatives',
  columns: 'pmo_columns',
  tickets: 'pmo_tickets',
  board_tickets: 'pmo_board_tickets',
  subtasks: 'pmo_subtasks',
  ticket_metadata: 'pmo_ticket_metadata',
  ticket_dependencies: 'pmo_ticket_dependencies',
  ticket_affected_paths: 'pmo_ticket_affected_paths',
  ticket_acceptance_criteria: 'pmo_ticket_acceptance_criteria',
  specs: 'pmo_specs',
  spec_dependencies: 'pmo_spec_dependencies',
  ticket_specs: 'pmo_ticket_specs',
  ticket_assignments: 'pmo_ticket_assignments',
  epics: 'pmo_epics',
  cache_metadata: 'pmo_cache_metadata',
  settings: 'pmo_settings',
  agent_work: 'agent_work',
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
      initiative_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

  initiatives: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.initiatives} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      objective TEXT,
      key_results TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

  columns: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.columns} (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, id)
    )`,

  tickets: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.tickets} (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      owner TEXT,
      assignee TEXT,
      spec_id TEXT,
      epic_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES ${PMO_TABLES.projects}(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_id) REFERENCES ${PMO_TABLES.specs}(id) ON DELETE SET NULL,
      FOREIGN KEY (epic_id) REFERENCES ${PMO_TABLES.epics}(id) ON DELETE SET NULL
    )`,

  board_tickets: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.board_tickets} (
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (project_id, ticket_id),
      FOREIGN KEY (project_id) REFERENCES ${PMO_TABLES.projects}(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, column_id) REFERENCES ${PMO_TABLES.columns}(project_id, id) ON DELETE CASCADE
    )`,

  subtasks: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.subtasks} (
      id TEXT NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      position INTEGER NOT NULL,
      PRIMARY KEY (ticket_id, id)
    )`,

  ticket_metadata: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.ticket_metadata} (
      ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (ticket_id, key)
    )`,

  // Agent execution support: ticket dependencies for scheduling
  ticket_dependencies: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.ticket_dependencies} (
      ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
      blocked_by_ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticket_id, blocked_by_ticket_id),
      CHECK (ticket_id != blocked_by_ticket_id)
    )`,

  // Agent execution support: file/path scope hints
  ticket_affected_paths: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.ticket_affected_paths} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
      path_pattern TEXT NOT NULL,
      path_type TEXT NOT NULL DEFAULT 'file',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

  // Agent execution support: structured acceptance criteria
  ticket_acceptance_criteria: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.ticket_acceptance_criteria} (
      id TEXT NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
      criterion TEXT NOT NULL,
      verifiable INTEGER DEFAULT 1,
      verified INTEGER DEFAULT 0,
      verified_at TIMESTAMP,
      verified_by TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ticket_id, id)
    )`,

  specs: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.specs} (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      type TEXT,
      tags TEXT,
      depends_on TEXT,
      problem TEXT,
      solution TEXT,
      decisions TEXT,
      not_now TEXT,
      ui_ux TEXT,
      acceptance_criteria TEXT,
      open_questions TEXT,
      requirements_functional TEXT,
      requirements_technical TEXT,
      context TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

  spec_dependencies: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.spec_dependencies} (
      spec_id TEXT NOT NULL REFERENCES ${PMO_TABLES.specs}(id) ON DELETE CASCADE,
      depends_on TEXT NOT NULL REFERENCES ${PMO_TABLES.specs}(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (spec_id, depends_on),
      CHECK (spec_id != depends_on)
    )`,

  ticket_specs: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.ticket_specs} (
      ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
      spec_id TEXT NOT NULL REFERENCES ${PMO_TABLES.specs}(id) ON DELETE CASCADE,
      PRIMARY KEY (ticket_id, spec_id)
    )`,

  ticket_assignments: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.ticket_assignments} (
      ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
      agent_name TEXT NOT NULL,
      assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticket_id, agent_name)
    )`,

  epics: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.epics} (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      position INTEGER NOT NULL DEFAULT 0,
      file_path TEXT,
      spec_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES ${PMO_TABLES.projects}(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_id) REFERENCES ${PMO_TABLES.specs}(id) ON DELETE SET NULL
    )`,

  cache_metadata: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.cache_metadata} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
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
      mode TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'host',
      display_mode TEXT NOT NULL DEFAULT 'terminal',
      sandboxed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'starting',
      branch TEXT,
      pid TEXT,
      container_id TEXT,
      session_id TEXT,
      host TEXT,
      log_path TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP,
      exit_code INTEGER,
      FOREIGN KEY (ticket_id) REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE
    )`,
} as const;

// =============================================================================
// Indexes
// =============================================================================

export const PMO_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON ${PMO_TABLES.columns}(project_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON ${PMO_TABLES.tickets}(project_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON ${PMO_TABLES.tickets}(status);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_owner ON ${PMO_TABLES.tickets}(owner);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_assignee ON ${PMO_TABLES.tickets}(assignee);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_spec ON ${PMO_TABLES.tickets}(spec_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_epic ON ${PMO_TABLES.tickets}(epic_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_priority ON ${PMO_TABLES.tickets}(priority);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_category ON ${PMO_TABLES.tickets}(category);
  CREATE INDEX IF NOT EXISTS idx_pmo_board_tickets_column ON ${PMO_TABLES.board_tickets}(project_id, column_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_subtasks_ticket ON ${PMO_TABLES.subtasks}(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_ticket_specs_spec ON ${PMO_TABLES.ticket_specs}(spec_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_assignments_agent ON ${PMO_TABLES.ticket_assignments}(agent_name);
  CREATE INDEX IF NOT EXISTS idx_pmo_epics_project ON ${PMO_TABLES.epics}(project_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_epics_spec ON ${PMO_TABLES.epics}(spec_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_epics_position ON ${PMO_TABLES.epics}(project_id, position);
  CREATE INDEX IF NOT EXISTS idx_pmo_projects_initiative ON ${PMO_TABLES.projects}(initiative_id);
  CREATE INDEX IF NOT EXISTS idx_agent_work_agent ON ${PMO_TABLES.agent_work}(agent_name);
  CREATE INDEX IF NOT EXISTS idx_agent_work_status ON ${PMO_TABLES.agent_work}(status);
  CREATE INDEX IF NOT EXISTS idx_agent_work_ticket ON ${PMO_TABLES.agent_work}(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_specs_status ON ${PMO_TABLES.specs}(status);
  CREATE INDEX IF NOT EXISTS idx_pmo_specs_type ON ${PMO_TABLES.specs}(type);
  CREATE INDEX IF NOT EXISTS idx_pmo_spec_deps_depends_on ON ${PMO_TABLES.spec_dependencies}(depends_on);
  CREATE INDEX IF NOT EXISTS idx_pmo_ticket_deps_blocked_by ON ${PMO_TABLES.ticket_dependencies}(blocked_by_ticket_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_ticket_paths_ticket ON ${PMO_TABLES.ticket_affected_paths}(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_ticket_criteria_ticket ON ${PMO_TABLES.ticket_acceptance_criteria}(ticket_id);
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
  PMO_TABLE_SCHEMAS.initiatives,
  PMO_TABLE_SCHEMAS.columns,
  PMO_TABLE_SCHEMAS.specs,  // Must be before tickets (FK reference)
  PMO_TABLE_SCHEMAS.spec_dependencies,  // Spec dependency graph
  PMO_TABLE_SCHEMAS.epics,  // Must be before tickets (FK reference)
  PMO_TABLE_SCHEMAS.tickets,
  PMO_TABLE_SCHEMAS.board_tickets,
  PMO_TABLE_SCHEMAS.subtasks,
  PMO_TABLE_SCHEMAS.ticket_metadata,
  PMO_TABLE_SCHEMAS.ticket_dependencies,  // Agent execution: dependency tracking
  PMO_TABLE_SCHEMAS.ticket_affected_paths,  // Agent execution: scope hints
  PMO_TABLE_SCHEMAS.ticket_acceptance_criteria,  // Agent execution: structured criteria
  PMO_TABLE_SCHEMAS.ticket_specs,
  PMO_TABLE_SCHEMAS.ticket_assignments,
  PMO_TABLE_SCHEMAS.cache_metadata,
  PMO_TABLE_SCHEMAS.settings,
  PMO_TABLE_SCHEMAS.agent_work,  // Execution tracking
  PMO_INDEXES,
].join(';\n');

// =============================================================================
// Expected Columns (for validation)
// =============================================================================

export const EXPECTED_TICKET_COLUMNS = [
  'id',
  'project_id',
  'title',
  'description',
  'priority',
  'category',
  'status',
  'owner',
  'assignee',
  'spec_id',
  'epic_id',
  'created_at',
  'updated_at',
  'last_synced_from_spec',
  'last_synced_from_board',
] as const;

/**
 * Validate that pmo_tickets table has all expected columns.
 * Throws if columns are missing (indicates schema mismatch).
 */
export function validateTicketSchema(db: { pragma: (sql: string) => unknown }): void {
  const columns = db.pragma(`table_info(${PMO_TABLES.tickets})`) as Array<{ name: string }>;
  const actualColumns = columns.map((c) => c.name);
  const missing = EXPECTED_TICKET_COLUMNS.filter((c) => !actualColumns.includes(c));

  if (missing.length > 0) {
    throw new Error(
      `Schema mismatch: pmo_tickets is missing columns: ${missing.join(', ')}. ` +
      `Database may need migration or recreation.`
    );
  }
}
