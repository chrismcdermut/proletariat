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
  tickets: 'pmo_tickets',
  board_views: 'pmo_board_views',  // Saved board view configurations
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
  epic_dependencies: 'pmo_epic_dependencies',
  project_specs: 'pmo_project_specs',  // Many-to-many: projects ↔ specs (specs are global)
  cache_metadata: 'pmo_cache_metadata',
  settings: 'pmo_settings',
  agent_work: 'agent_work',
  containers: 'containers',  // Docker containers per agent
  // Workflow tables (consolidated - workflows are the single source of truth for board columns)
  workflows: 'pmo_workflows',  // Shared workflow definitions
  workflow_statuses: 'pmo_workflow_statuses',  // Statuses belonging to workflows (= board columns)
  // templates: 'pmo_templates',  // REMOVED: workflows are now used directly
  phases: 'pmo_phases',  // Project lifecycle phases (workspace-scoped)
  phase_templates: 'pmo_phase_templates',  // Phase configuration templates
  actions: 'pmo_actions',  // Work actions (reusable agent prompts)
  ticket_templates: 'pmo_ticket_templates',  // Ticket templates for quick creation
  // Roadmap tables (ordered collections of projects for documentation)
  roadmaps: 'pmo_roadmaps',  // Named roadmap definitions
  roadmap_projects: 'pmo_roadmap_projects',  // Many-to-many: roadmaps ↔ projects with ordering
  // Legacy tables (deprecated, kept for migration)
  columns: 'pmo_columns',  // DEPRECATED: use workflow_statuses
  board_tickets: 'pmo_board_tickets',  // DEPRECATED: tickets now use status_id directly
  statuses: 'pmo_statuses',  // DEPRECATED: use workflow_statuses
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
      phase_id TEXT,
      workflow_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      target_date TIMESTAMP,
      initiative_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (phase_id) REFERENCES ${PMO_TABLES.phases}(id) ON DELETE SET NULL,
      FOREIGN KEY (workflow_id) REFERENCES ${PMO_TABLES.workflows}(id) ON DELETE SET NULL
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

  // Shared workflow definitions - projects reference these via workflow_id
  workflows: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.workflows} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

  // Statuses belonging to workflows - these ARE the board columns
  // Each status has a category (backlog, unstarted, started, completed, canceled)
  workflow_statuses: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.workflow_statuses} (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES ${PMO_TABLES.workflows}(id) ON DELETE CASCADE,
      UNIQUE(workflow_id, name)
    )`,

  // DEPRECATED: Legacy columns table - use workflow_statuses instead
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
      status_id TEXT,
      owner TEXT,
      assignee TEXT,
      branch TEXT,
      spec_id TEXT,
      epic_id TEXT,
      labels TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES ${PMO_TABLES.projects}(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_id) REFERENCES ${PMO_TABLES.specs}(id) ON DELETE SET NULL,
      FOREIGN KEY (epic_id) REFERENCES ${PMO_TABLES.epics}(id) ON DELETE SET NULL,
      FOREIGN KEY (status_id) REFERENCES ${PMO_TABLES.workflow_statuses}(id) ON DELETE SET NULL
    )`,

  // DEPRECATED: Legacy board_tickets table - tickets now use status_id directly
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

  // Board views - saved filter/display configurations for projects
  board_views: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.board_views} (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      filters TEXT NOT NULL DEFAULT '{}',
      group_by TEXT,
      sort_by TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES ${PMO_TABLES.projects}(id) ON DELETE CASCADE,
      UNIQUE(project_id, name)
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

  // Ticket-to-ticket dependencies (blocks, relates_to, duplicates)
  ticket_dependencies: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.ticket_dependencies} (
      ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE RESTRICT,
      depends_on_ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE RESTRICT,
      dependency_type TEXT NOT NULL DEFAULT 'blocks' CHECK (dependency_type IN ('blocks', 'relates_to', 'duplicates')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticket_id, depends_on_ticket_id, dependency_type),
      CHECK (ticket_id != depends_on_ticket_id)
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

  // Spec-to-spec dependencies (depends_on, relates_to, duplicates)
  spec_dependencies: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.spec_dependencies} (
      spec_id TEXT NOT NULL REFERENCES ${PMO_TABLES.specs}(id) ON DELETE RESTRICT,
      depends_on_spec_id TEXT NOT NULL REFERENCES ${PMO_TABLES.specs}(id) ON DELETE RESTRICT,
      dependency_type TEXT NOT NULL DEFAULT 'depends_on' CHECK (dependency_type IN ('depends_on', 'relates_to', 'duplicates')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (spec_id, depends_on_spec_id, dependency_type),
      CHECK (spec_id != depends_on_spec_id)
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

  // Epic-to-epic dependencies (blocks, relates_to, duplicates)
  epic_dependencies: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.epic_dependencies} (
      epic_id TEXT NOT NULL REFERENCES ${PMO_TABLES.epics}(id) ON DELETE RESTRICT,
      depends_on_epic_id TEXT NOT NULL REFERENCES ${PMO_TABLES.epics}(id) ON DELETE RESTRICT,
      dependency_type TEXT NOT NULL DEFAULT 'blocks' CHECK (dependency_type IN ('blocks', 'relates_to', 'duplicates')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (epic_id, depends_on_epic_id, dependency_type),
      CHECK (epic_id != depends_on_epic_id)
    )`,

  // Project-to-spec associations (many-to-many, specs are global living documents)
  project_specs: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.project_specs} (
      project_id TEXT NOT NULL REFERENCES ${PMO_TABLES.projects}(id) ON DELETE CASCADE,
      spec_id TEXT NOT NULL REFERENCES ${PMO_TABLES.specs}(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, spec_id)
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

  // DEPRECATED: Legacy per-project statuses - use workflow_statuses instead
  // Kept for migration from old schema
  statuses: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.statuses} (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES ${PMO_TABLES.projects}(id) ON DELETE CASCADE,
      UNIQUE(project_id, name)
    )`,

  // REMOVED: pmo_templates - workflows are now used directly (no separate template concept)

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
      suggested_for_categories TEXT,
      default_move_to_category TEXT,
      modifies_code INTEGER NOT NULL DEFAULT 1,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

  // Roadmap definitions (named collections of projects for documentation)
  roadmaps: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.roadmaps} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

  // Roadmap-to-project associations with ordering
  roadmap_projects: `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.roadmap_projects} (
      roadmap_id TEXT NOT NULL REFERENCES ${PMO_TABLES.roadmaps}(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES ${PMO_TABLES.projects}(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (roadmap_id, project_id)
    )`,
} as const;

// =============================================================================
// Indexes
// =============================================================================

export const PMO_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON ${PMO_TABLES.tickets}(project_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON ${PMO_TABLES.tickets}(status);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_owner ON ${PMO_TABLES.tickets}(owner);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_assignee ON ${PMO_TABLES.tickets}(assignee);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_spec ON ${PMO_TABLES.tickets}(spec_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_epic ON ${PMO_TABLES.tickets}(epic_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_priority ON ${PMO_TABLES.tickets}(priority);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_category ON ${PMO_TABLES.tickets}(category);
  CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status_id ON ${PMO_TABLES.tickets}(status_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_subtasks_ticket ON ${PMO_TABLES.subtasks}(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_ticket_specs_spec ON ${PMO_TABLES.ticket_specs}(spec_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_assignments_agent ON ${PMO_TABLES.ticket_assignments}(agent_name);
  CREATE INDEX IF NOT EXISTS idx_pmo_epics_project ON ${PMO_TABLES.epics}(project_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_epics_spec ON ${PMO_TABLES.epics}(spec_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_epics_position ON ${PMO_TABLES.epics}(project_id, position);
  CREATE INDEX IF NOT EXISTS idx_pmo_projects_initiative ON ${PMO_TABLES.projects}(initiative_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_projects_status ON ${PMO_TABLES.projects}(status);
  CREATE INDEX IF NOT EXISTS idx_pmo_projects_phase ON ${PMO_TABLES.projects}(phase_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_projects_workflow ON ${PMO_TABLES.projects}(workflow_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_projects_archived ON ${PMO_TABLES.projects}(is_archived);
  CREATE INDEX IF NOT EXISTS idx_agent_work_agent ON ${PMO_TABLES.agent_work}(agent_name);
  CREATE INDEX IF NOT EXISTS idx_agent_work_status ON ${PMO_TABLES.agent_work}(status);
  CREATE INDEX IF NOT EXISTS idx_agent_work_ticket ON ${PMO_TABLES.agent_work}(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_containers_agent ON ${PMO_TABLES.containers}(agent_name);
  CREATE INDEX IF NOT EXISTS idx_containers_docker_id ON ${PMO_TABLES.containers}(docker_id);
  CREATE INDEX IF NOT EXISTS idx_containers_status ON ${PMO_TABLES.containers}(status);
  CREATE INDEX IF NOT EXISTS idx_pmo_specs_status ON ${PMO_TABLES.specs}(status);
  CREATE INDEX IF NOT EXISTS idx_pmo_specs_type ON ${PMO_TABLES.specs}(type);
  CREATE INDEX IF NOT EXISTS idx_pmo_spec_deps_depends_on ON ${PMO_TABLES.spec_dependencies}(depends_on_spec_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_ticket_deps_depends_on ON ${PMO_TABLES.ticket_dependencies}(depends_on_ticket_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_epic_deps_depends_on ON ${PMO_TABLES.epic_dependencies}(depends_on_epic_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_project_specs_spec ON ${PMO_TABLES.project_specs}(spec_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_project_specs_project ON ${PMO_TABLES.project_specs}(project_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_ticket_paths_ticket ON ${PMO_TABLES.ticket_affected_paths}(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_ticket_criteria_ticket ON ${PMO_TABLES.ticket_acceptance_criteria}(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_phases_category ON ${PMO_TABLES.phases}(category);
  CREATE INDEX IF NOT EXISTS idx_pmo_phases_position ON ${PMO_TABLES.phases}(category, position);
  CREATE INDEX IF NOT EXISTS idx_pmo_board_views_project ON ${PMO_TABLES.board_views}(project_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_board_views_default ON ${PMO_TABLES.board_views}(project_id, is_default);
  CREATE INDEX IF NOT EXISTS idx_pmo_ticket_templates_builtin ON ${PMO_TABLES.ticket_templates}(is_builtin);
  CREATE INDEX IF NOT EXISTS idx_pmo_workflow_statuses_workflow ON ${PMO_TABLES.workflow_statuses}(workflow_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_workflow_statuses_category ON ${PMO_TABLES.workflow_statuses}(workflow_id, category);
  CREATE INDEX IF NOT EXISTS idx_pmo_workflow_statuses_position ON ${PMO_TABLES.workflow_statuses}(workflow_id, position);
  CREATE INDEX IF NOT EXISTS idx_pmo_workflows_builtin ON ${PMO_TABLES.workflows}(is_builtin);
  CREATE INDEX IF NOT EXISTS idx_pmo_roadmaps_default ON ${PMO_TABLES.roadmaps}(is_default);
  CREATE INDEX IF NOT EXISTS idx_pmo_roadmap_projects_roadmap ON ${PMO_TABLES.roadmap_projects}(roadmap_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_roadmap_projects_project ON ${PMO_TABLES.roadmap_projects}(project_id);
  CREATE INDEX IF NOT EXISTS idx_pmo_roadmap_projects_position ON ${PMO_TABLES.roadmap_projects}(roadmap_id, position);
`;

// =============================================================================
// Combined Schema
// =============================================================================

/**
 * All PMO table creation statements combined.
 * Order matters due to foreign key dependencies.
 */
export const PMO_SCHEMA_SQL = [
  PMO_TABLE_SCHEMAS.phases,  // Project phases (before projects for FK)
  PMO_TABLE_SCHEMAS.phase_templates,  // Phase templates (for preset phase configurations)
  PMO_TABLE_SCHEMAS.workflows,  // Shared workflows (before projects for FK)
  PMO_TABLE_SCHEMAS.workflow_statuses,  // Workflow statuses (= board columns)
  PMO_TABLE_SCHEMAS.projects,
  PMO_TABLE_SCHEMAS.initiatives,
  // PMO_TABLE_SCHEMAS.templates,  // REMOVED: workflows are now used directly
  PMO_TABLE_SCHEMAS.specs,  // Must be before tickets (FK reference)
  PMO_TABLE_SCHEMAS.spec_dependencies,  // Spec-to-spec dependencies
  PMO_TABLE_SCHEMAS.epics,  // Must be before tickets (FK reference)
  PMO_TABLE_SCHEMAS.epic_dependencies,  // Epic-to-epic dependencies
  PMO_TABLE_SCHEMAS.project_specs,  // Many-to-many project ↔ spec associations
  PMO_TABLE_SCHEMAS.tickets,
  PMO_TABLE_SCHEMAS.board_views,  // Saved board view configurations
  PMO_TABLE_SCHEMAS.subtasks,
  PMO_TABLE_SCHEMAS.ticket_metadata,
  PMO_TABLE_SCHEMAS.ticket_dependencies,  // Ticket-to-ticket dependencies
  PMO_TABLE_SCHEMAS.ticket_affected_paths,  // Agent execution: scope hints
  PMO_TABLE_SCHEMAS.ticket_acceptance_criteria,  // Agent execution: structured criteria
  PMO_TABLE_SCHEMAS.ticket_specs,
  PMO_TABLE_SCHEMAS.ticket_assignments,
  PMO_TABLE_SCHEMAS.cache_metadata,
  PMO_TABLE_SCHEMAS.settings,
  PMO_TABLE_SCHEMAS.agent_work,  // Execution tracking
  PMO_TABLE_SCHEMAS.containers,  // Docker containers per agent
  PMO_TABLE_SCHEMAS.actions,  // Work actions (reusable agent prompts)
  PMO_TABLE_SCHEMAS.ticket_templates,  // Ticket templates for quick creation
  PMO_TABLE_SCHEMAS.roadmaps,  // Named roadmap definitions
  PMO_TABLE_SCHEMAS.roadmap_projects,  // Roadmap-to-project associations
  // Legacy tables (kept for migration, will be dropped after data migrated)
  PMO_TABLE_SCHEMAS.columns,  // DEPRECATED
  PMO_TABLE_SCHEMAS.board_tickets,  // DEPRECATED
  PMO_TABLE_SCHEMAS.statuses,  // DEPRECATED
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
  'status_id',
  'owner',
  'assignee',
  'branch',
  'spec_id',
  'epic_id',
  'labels',
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
  const actualColumns = new Set(columns.map((c) => c.name));
  const missing = EXPECTED_TICKET_COLUMNS.filter((c) => !actualColumns.has(c));

  if (missing.length > 0) {
    throw new Error(
      `Schema mismatch: pmo_tickets is missing columns: ${missing.join(', ')}. ` +
      `Database may need migration or recreation.`
    );
  }
}
