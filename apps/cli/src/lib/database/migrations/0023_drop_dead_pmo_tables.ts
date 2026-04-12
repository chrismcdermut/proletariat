/**
 * Migration 0023 — Drop dead PMO tables (PRLT-1299)
 *
 * Removes local ticket store, local workflow definitions, and vestigial tables.
 * Provider is the source of truth for tickets and workflow states.
 *
 * Also rekeys:
 * - pmo_external_issue_map: drops pmo_ticket_id column, PK becomes (provider, external_id)
 * - pmo_ticket_metadata: removes FK to pmo_tickets, rekeys ticket_id from TKT-### to provider IDs
 * - pmo_projects: removes FK to pmo_workflows (which is being dropped)
 */

import type { Migration } from '../migrator.js'

export const dropDeadPmoTables: Migration = {
  id: '0023',
  name: 'drop_dead_pmo_tables',
  up(db) {
    // =========================================================================
    // Phase 1: Drop tables in reverse dependency order
    // =========================================================================

    const tablesToDrop = [
      // Local ticket store (provider is source of truth)
      'pmo_board_tickets',
      'pmo_board_views',
      'pmo_ticket_labels',
      'pmo_ticket_assignments',
      'pmo_ticket_specs',
      'pmo_ticket_affected_paths',
      'pmo_ticket_acceptance_criteria',
      'pmo_ticket_dependencies',
      'pmo_subtasks',

      // Vestigial / empty — drop before pmo_tickets since some reference it
      'pmo_linear_issue_map',
      'pmo_monday_item_map',
      'pmo_external_execution_links',
      'pmo_provider_status_map',
      'pmo_provider_triggers',
      'pmo_cache_metadata',

      // Specs/epics (depend on pmo_tickets via FKs)
      'pmo_project_specs',
      'pmo_epic_dependencies',
      'pmo_spec_dependencies',
      'pmo_ticket_specs',  // may already be dropped above, IF NOT EXISTS is safe

      // Roadmaps
      'pmo_roadmap_projects',
      'pmo_roadmaps',

      // Labels (not actively used)
      'pmo_ticket_labels',  // may already be dropped above
      'pmo_labels',
      'pmo_label_groups',
      'pmo_categories',

      // Core tables (drop after dependents)
      'pmo_tickets',
      'pmo_epics',
      'pmo_specs',
      'pmo_initiatives',

      // Local workflow definitions (provider defines the workflow)
      'pmo_columns',
      'pmo_statuses',
      'pmo_workflow_statuses',
      'pmo_workflows',
    ]

    for (const table of tablesToDrop) {
      db.exec(`DROP TABLE IF EXISTS ${table}`)
    }

    // Also drop related indexes that may linger after table drops
    // (SQLite usually drops indexes with the table, but be safe)

    // =========================================================================
    // Phase 2: Rekey pmo_external_issue_map — drop pmo_ticket_id column
    // =========================================================================

    const hasExternalIssueMap = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_external_issue_map'"
    ).get()

    if (hasExternalIssueMap) {
      // Recreate table without pmo_ticket_id, PK is (provider, external_id)
      db.exec(`
        CREATE TABLE pmo_external_issue_map_new (
          provider TEXT NOT NULL CHECK (provider IN ('linear', 'jira', 'shortcut', 'trello', 'github', 'asana', 'clickup', 'monday')),
          external_id TEXT NOT NULL,
          external_key TEXT NOT NULL,
          external_url TEXT NOT NULL,
          team_key TEXT NOT NULL,
          sync_direction TEXT NOT NULL DEFAULT 'inbound',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (provider, external_id)
        )
      `)

      // Copy existing data (skip pmo_ticket_id)
      db.exec(`
        INSERT OR IGNORE INTO pmo_external_issue_map_new
          (provider, external_id, external_key, external_url, team_key, sync_direction, created_at)
        SELECT provider, external_id, external_key, external_url, team_key, sync_direction, created_at
        FROM pmo_external_issue_map
      `)

      db.exec('DROP TABLE pmo_external_issue_map')
      db.exec('ALTER TABLE pmo_external_issue_map_new RENAME TO pmo_external_issue_map')

      // Recreate indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_provider
          ON pmo_external_issue_map(provider)
      `)
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_external_key_eim
          ON pmo_external_issue_map(provider, external_key)
      `)
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_team_key
          ON pmo_external_issue_map(provider, team_key)
      `)
    }

    // =========================================================================
    // Phase 3: Rekey pmo_ticket_metadata — remove FK to pmo_tickets,
    //          migrate TKT-### keys to provider IDs where possible
    // =========================================================================

    const hasTicketMetadata = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_ticket_metadata'"
    ).get()

    if (hasTicketMetadata) {
      // Recreate without FK to pmo_tickets
      db.exec(`
        CREATE TABLE pmo_ticket_metadata_new (
          ticket_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT,
          PRIMARY KEY (ticket_id, key)
        )
      `)

      // Migrate: for rows with TKT-### ticket_id, try to resolve to the
      // provider key using the old pmo_external_issue_map data (which we
      // already migrated). Use the external_key metadata to self-resolve.
      // Rows that were keyed by external_key (PRLT-xxx) stay as-is.
      // Rows with TKT-### that have a corresponding external_key metadata
      // entry get rekeyed.
      db.exec(`
        INSERT OR IGNORE INTO pmo_ticket_metadata_new (ticket_id, key, value)
        SELECT
          CASE
            WHEN m.ticket_id LIKE 'TKT-%' THEN
              COALESCE(
                (SELECT m2.value FROM pmo_ticket_metadata m2
                 WHERE m2.ticket_id = m.ticket_id AND m2.key = 'external_key'),
                m.ticket_id
              )
            ELSE m.ticket_id
          END,
          m.key,
          m.value
        FROM pmo_ticket_metadata m
      `)

      db.exec('DROP TABLE pmo_ticket_metadata')
      db.exec('ALTER TABLE pmo_ticket_metadata_new RENAME TO pmo_ticket_metadata')
    }

    // =========================================================================
    // Phase 4: Update pmo_projects — remove FK to pmo_workflows
    // =========================================================================

    const hasProjects = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
    ).get()

    if (hasProjects) {
      db.exec(`
        CREATE TABLE pmo_projects_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          template TEXT,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          phase_id TEXT,
          is_archived INTEGER NOT NULL DEFAULT 0,
          target_date TIMESTAMP,
          initiative_id TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (phase_id) REFERENCES pmo_phases(id) ON DELETE SET NULL
        )
      `)

      // Copy data, dropping workflow_id
      db.exec(`
        INSERT INTO pmo_projects_new
          (id, name, template, description, status, phase_id, is_archived, target_date, initiative_id, created_at, updated_at)
        SELECT id, name, template, description, status, phase_id, is_archived, target_date, initiative_id, created_at, updated_at
        FROM pmo_projects
      `)

      db.exec('DROP TABLE pmo_projects')
      db.exec('ALTER TABLE pmo_projects_new RENAME TO pmo_projects')

      // Recreate project indexes
      db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_projects_status ON pmo_projects(status)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_projects_phase ON pmo_projects(phase_id)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_projects_archived ON pmo_projects(is_archived)')
    }
  },
}
