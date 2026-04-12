/**
 * Migration 0023 — Drop Dead PMO Tables
 *
 * Removes 30+ dead PMO tables that were part of the local ticket store,
 * local workflow definitions, and vestigial features. The provider (Linear,
 * Jira, etc.) is now the source of truth for tickets and workflows.
 *
 * Also rekeys:
 * - pmo_external_issue_map: drops pmo_ticket_id, rekeys by (provider, external_id)
 * - pmo_ticket_metadata: rekeys from TKT-### to provider IDs
 * - pmo_projects: removes dead FKs to dropped tables
 *
 * See PRLT-1299 for full context.
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

/** Tables to drop (children before parents to respect FK order). */
const TABLES_TO_DROP = [
  // Junction / child tables (depend on pmo_tickets)
  'pmo_ticket_labels',
  'pmo_ticket_assignments',
  'pmo_ticket_dependencies',
  'pmo_ticket_affected_paths',
  'pmo_ticket_acceptance_criteria',
  'pmo_ticket_specs',
  'pmo_subtasks',
  'pmo_board_tickets',
  'pmo_board_views',

  // Ticket store
  'pmo_tickets',

  // Workflow tables
  'pmo_workflow_statuses',
  'pmo_workflows',
  'pmo_columns',
  'pmo_statuses',

  // Epic tables
  'pmo_epic_dependencies',
  'pmo_epics',

  // Spec tables
  'pmo_spec_dependencies',
  'pmo_ticket_specs', // duplicate safety
  'pmo_project_specs',
  'pmo_specs',

  // Vestigial tables
  'pmo_initiatives',
  'pmo_roadmap_projects',
  'pmo_roadmaps',
  'pmo_cache_metadata',
  'pmo_linear_issue_map',
  'pmo_monday_item_map',
  'pmo_provider_status_map',
  'pmo_provider_triggers',
  'pmo_external_execution_links',

  // Evaluated as dead (no src/ code uses them)
  'pmo_phases',
  'pmo_phase_templates',
  'pmo_ticket_templates',
  'pmo_categories',
  'pmo_label_groups',
  'pmo_labels',

  // Asana / Trello maps (depend on pmo_tickets FK)
  'pmo_asana_task_map',
  'pmo_trello_card_map',
]

export const dropDeadPmoTables: Migration = {
  id: '0023',
  name: 'drop_dead_pmo_tables',
  up: (db: Database.Database) => {
    const tableExists = (name: string): boolean => {
      const result = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(name) as { name: string } | undefined
      return !!result
    }

    // ---------------------------------------------------------------
    // 1. Rekey pmo_ticket_metadata: TKT-### → provider external_key
    // ---------------------------------------------------------------
    if (tableExists('pmo_ticket_metadata')) {
      // Build a TKT-### → external_key mapping from pmo_external_issue_map
      // Also check pmo_ticket_metadata itself for 'external_key' entries
      const mapping = new Map<string, string>()

      if (tableExists('pmo_external_issue_map')) {
        const rows = db.prepare(
          'SELECT pmo_ticket_id, external_key FROM pmo_external_issue_map'
        ).all() as Array<{ pmo_ticket_id: string; external_key: string }>
        for (const row of rows) {
          mapping.set(row.pmo_ticket_id, row.external_key)
        }
      }

      // Fallback: check metadata itself for 'external_key' values
      if (tableExists('pmo_ticket_metadata')) {
        const metaRows = db.prepare(
          "SELECT ticket_id, value FROM pmo_ticket_metadata WHERE key = 'external_key'"
        ).all() as Array<{ ticket_id: string; value: string }>
        for (const row of metaRows) {
          if (!mapping.has(row.ticket_id) && row.value) {
            mapping.set(row.ticket_id, row.value)
          }
        }
      }

      // Recreate table without FK to pmo_tickets
      db.exec(`
        CREATE TABLE IF NOT EXISTS pmo_ticket_metadata_new (
          ticket_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT,
          PRIMARY KEY (ticket_id, key)
        )
      `)

      // Copy data with rekeyed ticket_id
      const allMeta = db.prepare(
        'SELECT ticket_id, key, value FROM pmo_ticket_metadata'
      ).all() as Array<{ ticket_id: string; key: string; value: string | null }>

      const insert = db.prepare(
        'INSERT OR IGNORE INTO pmo_ticket_metadata_new (ticket_id, key, value) VALUES (?, ?, ?)'
      )

      for (const row of allMeta) {
        const newId = mapping.get(row.ticket_id) || row.ticket_id
        insert.run(newId, row.key, row.value)
      }

      db.exec('DROP TABLE pmo_ticket_metadata')
      db.exec('ALTER TABLE pmo_ticket_metadata_new RENAME TO pmo_ticket_metadata')
    }

    // ---------------------------------------------------------------
    // 2. Rekey pmo_external_issue_map: drop pmo_ticket_id column
    // ---------------------------------------------------------------
    if (tableExists('pmo_external_issue_map')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pmo_external_issue_map_new (
          provider TEXT NOT NULL CHECK (provider IN ('linear', 'jira', 'shortcut', 'trello', 'github')),
          external_id TEXT NOT NULL,
          external_key TEXT NOT NULL,
          external_url TEXT NOT NULL,
          team_key TEXT NOT NULL,
          sync_direction TEXT NOT NULL DEFAULT 'inbound',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (provider, external_id)
        )
      `)

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
      db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_external_key ON pmo_external_issue_map(provider, external_key)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_team_key ON pmo_external_issue_map(provider, team_key)')
    }

    // ---------------------------------------------------------------
    // 3. Recreate pmo_projects without dead FKs
    // ---------------------------------------------------------------
    if (tableExists('pmo_projects')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pmo_projects_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          template TEXT,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          is_archived INTEGER NOT NULL DEFAULT 0,
          target_date TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `)

      db.exec(`
        INSERT OR IGNORE INTO pmo_projects_new
          (id, name, template, description, status, is_archived, target_date, created_at, updated_at)
        SELECT id, name, template, description, status, is_archived, target_date, created_at, updated_at
        FROM pmo_projects
      `)

      db.exec('DROP TABLE pmo_projects')
      db.exec('ALTER TABLE pmo_projects_new RENAME TO pmo_projects')

      // Recreate indexes
      db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_projects_status ON pmo_projects(status)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_projects_archived ON pmo_projects(is_archived)')
    }

    // ---------------------------------------------------------------
    // 4. Drop all dead tables
    // ---------------------------------------------------------------
    for (const table of TABLES_TO_DROP) {
      db.exec(`DROP TABLE IF EXISTS ${table}`)
    }

    // Also drop indexes that reference dropped tables
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"
    ).all() as Array<{ name: string }>

    for (const idx of indexes) {
      // Check if the index references a dropped table
      const indexSql = db.prepare(
        "SELECT sql FROM sqlite_master WHERE name=?"
      ).get(idx.name) as { sql: string } | undefined

      if (!indexSql?.sql) continue

      const referencesDroppedTable = TABLES_TO_DROP.some(
        table => indexSql.sql.includes(` ${table}(`) || indexSql.sql.includes(` ${table} `)
      )
      if (referencesDroppedTable) {
        try {
          db.exec(`DROP INDEX IF EXISTS ${idx.name}`)
        } catch {
          // Index may have been auto-dropped with its table
        }
      }
    }
  },
}
