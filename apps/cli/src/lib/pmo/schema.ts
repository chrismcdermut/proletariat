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
  specs: 'pmo_specs',
  ticket_specs: 'pmo_ticket_specs',
  ticket_assignments: 'pmo_ticket_assignments',
  epics: 'pmo_epics',
  cache_metadata: 'pmo_cache_metadata',
  settings: 'pmo_settings',
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

  specs: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.specs} (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      title TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      file_path TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES ${PMO_TABLES.projects}(id) ON DELETE CASCADE
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
  CREATE INDEX IF NOT EXISTS idx_pmo_projects_initiative ON ${PMO_TABLES.projects}(initiative_id);
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
  PMO_TABLE_SCHEMAS.epics,  // Must be before tickets (FK reference)
  PMO_TABLE_SCHEMAS.tickets,
  PMO_TABLE_SCHEMAS.board_tickets,
  PMO_TABLE_SCHEMAS.subtasks,
  PMO_TABLE_SCHEMAS.ticket_metadata,
  PMO_TABLE_SCHEMAS.ticket_specs,
  PMO_TABLE_SCHEMAS.ticket_assignments,
  PMO_TABLE_SCHEMAS.cache_metadata,
  PMO_TABLE_SCHEMAS.settings,
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
