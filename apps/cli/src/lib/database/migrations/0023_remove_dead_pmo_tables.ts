/**
 * Migration: Remove dead PMO tables (PRLT-1299)
 *
 * Drops local ticket store, local workflow definitions, and vestigial tables.
 * The provider (Linear, Jira, etc.) is now the source of truth for tickets and workflows.
 *
 * Also:
 * - Rekeys pmo_external_issue_map by provider ID (drops pmo_ticket_id column)
 * - Rekeys pmo_ticket_metadata from TKT-### to provider IDs
 */

import type { Migration } from '../migrator.js'

export const removeDeadPmoTables: Migration = {
  id: '0023',
  name: 'remove_dead_pmo_tables',

  up(db) {
    // =========================================================================
    // Phase 1: Drop tables that depend on pmo_tickets first (FK order)
    // =========================================================================
    const dependentTables = [
      'pmo_board_tickets',       // FK → pmo_tickets, pmo_columns
      'pmo_ticket_labels',       // FK → pmo_tickets, pmo_labels
      'pmo_ticket_assignments',  // FK → pmo_tickets
      'pmo_ticket_specs',        // FK → pmo_tickets, pmo_specs
      'pmo_ticket_acceptance_criteria', // FK → pmo_tickets
      'pmo_ticket_affected_paths',     // FK → pmo_tickets
      'pmo_ticket_dependencies', // FK → pmo_tickets
      'pmo_subtasks',            // FK → pmo_tickets
      'pmo_board_views',         // FK → pmo_projects
      'pmo_linear_issue_map',    // FK → pmo_tickets (deprecated)
      'pmo_monday_item_map',     // FK → pmo_tickets
      'pmo_external_execution_links', // FK → pmo_external_execution_map
    ]

    for (const table of dependentTables) {
      db.exec(`DROP TABLE IF EXISTS ${table}`)
    }

    // =========================================================================
    // Phase 2: Rekey pmo_external_issue_map — drop pmo_ticket_id FK,
    // rekey by (provider, external_id) as primary key
    // =========================================================================
    const hasExternalIssueMap = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_external_issue_map'"
    ).get()

    if (hasExternalIssueMap) {
      // SQLite doesn't support DROP COLUMN before 3.35.0, so recreate the table
      db.exec(`
        CREATE TABLE IF NOT EXISTS pmo_external_issue_map_new (
          provider TEXT NOT NULL CHECK (provider IN ('linear', 'jira', 'shortcut', 'trello', 'github', 'asana', 'monday', 'pmo')),
          external_id TEXT NOT NULL,
          external_key TEXT NOT NULL,
          external_url TEXT NOT NULL,
          team_key TEXT NOT NULL,
          sync_direction TEXT NOT NULL DEFAULT 'inbound',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (provider, external_id)
        )
      `)

      // Migrate existing data (drop the pmo_ticket_id column)
      db.exec(`
        INSERT OR IGNORE INTO pmo_external_issue_map_new
          (provider, external_id, external_key, external_url, team_key, sync_direction, created_at)
        SELECT provider, external_id, external_key, external_url, team_key, sync_direction, created_at
        FROM pmo_external_issue_map
      `)

      db.exec('DROP TABLE pmo_external_issue_map')
      db.exec('ALTER TABLE pmo_external_issue_map_new RENAME TO pmo_external_issue_map')

      // Recreate indexes
      db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_provider ON pmo_external_issue_map(provider)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_external_id ON pmo_external_issue_map(provider, external_id)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_external_key ON pmo_external_issue_map(provider, external_key)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_team_key ON pmo_external_issue_map(provider, team_key)')
    }

    // =========================================================================
    // Phase 3: Rekey pmo_ticket_metadata from TKT-### to provider IDs
    // =========================================================================
    const hasTicketMetadata = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_ticket_metadata'"
    ).get()

    if (hasTicketMetadata) {
      // Recreate without FK to pmo_tickets
      db.exec(`
        CREATE TABLE IF NOT EXISTS pmo_ticket_metadata_new (
          ticket_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT,
          PRIMARY KEY (ticket_id, key)
        )
      `)

      // Migrate data, rekeying TKT-### → provider IDs where possible
      // Strategy: if there's an external_key in pmo_external_issue_map, use it
      const hasExternalMap = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_external_issue_map'"
      ).get()

      if (hasExternalMap) {
        // Rekey rows that have external issue mappings
        db.exec(`
          INSERT OR IGNORE INTO pmo_ticket_metadata_new (ticket_id, key, value)
          SELECT COALESCE(eim.external_key, m.ticket_id), m.key, m.value
          FROM pmo_ticket_metadata m
          LEFT JOIN pmo_external_issue_map eim ON eim.external_key = (
            SELECT value FROM pmo_ticket_metadata m2
            WHERE m2.ticket_id = m.ticket_id AND m2.key = 'external_key'
          )
        `)
      } else {
        // No external issue map - just copy data as-is
        db.exec(`
          INSERT OR IGNORE INTO pmo_ticket_metadata_new (ticket_id, key, value)
          SELECT ticket_id, key, value FROM pmo_ticket_metadata
        `)
      }

      db.exec('DROP TABLE pmo_ticket_metadata')
      db.exec('ALTER TABLE pmo_ticket_metadata_new RENAME TO pmo_ticket_metadata')
    }

    // =========================================================================
    // Phase 4: Drop the main dead tables
    // =========================================================================
    const mainTables = [
      // Local ticket store
      'pmo_tickets',
      // Local workflows
      'pmo_workflows',
      'pmo_workflow_statuses',
      'pmo_columns',           // deprecated
      'pmo_statuses',          // deprecated
      // Vestigial
      'pmo_epics',
      'pmo_epic_dependencies',
      'pmo_initiatives',
      'pmo_roadmaps',
      'pmo_roadmap_projects',
      'pmo_specs',
      'pmo_spec_dependencies',
      'pmo_project_specs',
      'pmo_cache_metadata',
      'pmo_provider_status_map',
      'pmo_provider_triggers',
      // Provider-specific mapping tables (replaced by pmo_external_issue_map)
      'pmo_asana_task_map',
      'pmo_trello_card_map',
    ]

    for (const table of mainTables) {
      db.exec(`DROP TABLE IF EXISTS ${table}`)
    }

    // =========================================================================
    // Phase 5: Clean up pmo_projects — drop dead FK columns
    // =========================================================================
    const hasProjects = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
    ).get()

    if (hasProjects) {
      const columns = db.pragma('table_info(pmo_projects)') as Array<{ name: string }>
      const colNames = new Set(columns.map(c => c.name))

      // initiative_id and workflow_id referenced dead tables — remove them
      if (colNames.has('initiative_id') || colNames.has('workflow_id')) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS pmo_projects_new (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            template TEXT,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            phase_id TEXT,
            is_archived INTEGER NOT NULL DEFAULT 0,
            target_date TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `)

        db.exec(`
          INSERT OR IGNORE INTO pmo_projects_new
            (id, name, template, description, status, phase_id, is_archived, target_date, created_at, updated_at)
          SELECT id, name, template, description, status, phase_id, is_archived, target_date, created_at, updated_at
          FROM pmo_projects
        `)

        db.exec('DROP TABLE pmo_projects')
        db.exec('ALTER TABLE pmo_projects_new RENAME TO pmo_projects')

        // Recreate indexes
        db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_projects_status ON pmo_projects(status)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_projects_phase ON pmo_projects(phase_id)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_projects_archived ON pmo_projects(is_archived)')
      }
    }
  },

}
