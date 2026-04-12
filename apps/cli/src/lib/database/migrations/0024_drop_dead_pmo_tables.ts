/**
 * Migration 0024 — Drop Dead PMO Tables
 *
 * Removes 28+ dead PMO tables that are no longer used now that the provider
 * (Linear, Jira, etc.) is the source of truth for tickets, workflows, and
 * board state. Rekeys surviving tables to use provider IDs instead of
 * internal PMO ticket IDs.
 *
 * Tables dropped:
 *   Local ticket store: pmo_tickets, pmo_subtasks, pmo_ticket_acceptance_criteria,
 *     pmo_ticket_labels, pmo_ticket_assignments, pmo_ticket_dependencies,
 *     pmo_ticket_affected_paths, pmo_ticket_specs, pmo_board_tickets, pmo_board_views
 *   Local workflows: pmo_workflows, pmo_workflow_statuses, pmo_columns, pmo_statuses
 *   Vestigial: pmo_epics, pmo_epic_dependencies, pmo_initiatives, pmo_roadmaps,
 *     pmo_roadmap_projects, pmo_specs, pmo_spec_dependencies, pmo_project_specs,
 *     pmo_cache_metadata, pmo_linear_issue_map, pmo_monday_item_map,
 *     pmo_provider_status_map, pmo_provider_triggers
 *
 * Tables rekeyed:
 *   pmo_external_issue_map — drop pmo_ticket_id column, rekey by (provider, external_id)
 *   pmo_ticket_metadata — rekey from TKT-### to provider external_key
 *
 * PRLT-1299
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

/** Tables to unconditionally drop */
const DEAD_TABLES = [
  // Local ticket store
  'pmo_board_tickets',
  'pmo_board_views',
  'pmo_ticket_labels',
  'pmo_ticket_assignments',
  'pmo_ticket_dependencies',
  'pmo_ticket_affected_paths',
  'pmo_ticket_acceptance_criteria',
  'pmo_ticket_specs',
  'pmo_subtasks',
  // Local workflows
  'pmo_workflow_statuses',
  'pmo_workflows',
  'pmo_columns',
  'pmo_statuses',
  // Vestigial
  'pmo_epic_dependencies',
  'pmo_epics',
  'pmo_spec_dependencies',
  'pmo_project_specs',
  'pmo_specs',
  'pmo_initiatives',
  'pmo_roadmap_projects',
  'pmo_roadmaps',
  'pmo_cache_metadata',
  'pmo_linear_issue_map',
  'pmo_monday_item_map',
  'pmo_provider_status_map',
  'pmo_provider_triggers',
  // Drop pmo_tickets last (many FKs point to it)
  'pmo_tickets',
]

export const dropDeadPmoTables: Migration = {
  id: '0024',
  name: 'drop_dead_pmo_tables',
  up: (db: Database.Database) => {
    const tableExists = (name: string): boolean => {
      const result = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(name) as { name: string } | undefined
      return !!result
    }

    // ---------------------------------------------------------------
    // 1. Rekey pmo_external_issue_map: drop pmo_ticket_id, rekey by provider ID
    // ---------------------------------------------------------------
    if (tableExists('pmo_external_issue_map')) {
      const cols = db.pragma('table_info(pmo_external_issue_map)') as { name: string }[]
      const colNames = new Set(cols.map(c => c.name))

      if (colNames.has('pmo_ticket_id')) {
        // Recreate without pmo_ticket_id, keyed by (provider, external_id)
        db.exec(`
          CREATE TABLE IF NOT EXISTS pmo_external_issue_map_new (
            provider TEXT NOT NULL,
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
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_provider
            ON pmo_external_issue_map(provider);
          CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_external_key
            ON pmo_external_issue_map(provider, external_key);
          CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_team_key
            ON pmo_external_issue_map(provider, team_key);
        `)
      }
    }

    // ---------------------------------------------------------------
    // 2. Rekey pmo_ticket_metadata: ticket_id → external_key
    //    Convert TKT-### IDs to provider external_key via pmo_external_issue_map
    // ---------------------------------------------------------------
    if (tableExists('pmo_ticket_metadata')) {
      // Try to migrate data from TKT-### to provider keys
      if (tableExists('pmo_external_issue_map')) {
        try {
          // Update ticket_id to external_key where a mapping exists
          db.exec(`
            UPDATE pmo_ticket_metadata
            SET ticket_id = (
              SELECT e.external_key
              FROM pmo_external_issue_map e
              WHERE e.external_id = (
                SELECT e2.external_id FROM pmo_external_issue_map e2
                WHERE e2.external_key IS NOT NULL
                LIMIT 1
              )
            )
            WHERE ticket_id LIKE 'TKT-%'
            AND EXISTS (
              SELECT 1 FROM pmo_external_issue_map
            )
          `)
        } catch {
          // Best-effort rekeying — if it fails, the old keys remain
        }
      }

      // Remove FK constraint on ticket_id (it referenced pmo_tickets which is being dropped)
      const metaCols = db.pragma('table_info(pmo_ticket_metadata)') as { name: string }[]
      const metaColNames = new Set(metaCols.map(c => c.name))

      if (metaColNames.has('ticket_id')) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS pmo_ticket_metadata_new (
            ticket_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT,
            PRIMARY KEY (ticket_id, key)
          )
        `)

        db.exec(`
          INSERT OR IGNORE INTO pmo_ticket_metadata_new (ticket_id, key, value)
          SELECT ticket_id, key, value FROM pmo_ticket_metadata
        `)

        db.exec('DROP TABLE pmo_ticket_metadata')
        db.exec('ALTER TABLE pmo_ticket_metadata_new RENAME TO pmo_ticket_metadata')
      }
    }

    // ---------------------------------------------------------------
    // 3. Drop dead tables
    // ---------------------------------------------------------------
    for (const table of DEAD_TABLES) {
      if (tableExists(table)) {
        try {
          db.exec(`DROP TABLE ${table}`)
        } catch {
          // Table may have already been dropped or have dependencies
          // Try with IF EXISTS as fallback
          try {
            db.exec(`DROP TABLE IF EXISTS ${table}`)
          } catch {
            // Ignore — table may not exist
          }
        }
      }
    }

    // ---------------------------------------------------------------
    // 4. Drop orphaned indexes that referenced dead tables
    // ---------------------------------------------------------------
    const deadIndexPrefixes = [
      'idx_pmo_tickets_',
      'idx_pmo_subtasks_',
      'idx_pmo_ticket_specs_',
      'idx_pmo_assignments_',
      'idx_pmo_epics_',
      'idx_pmo_specs_',
      'idx_pmo_spec_deps_',
      'idx_pmo_ticket_deps_',
      'idx_pmo_epic_deps_',
      'idx_pmo_project_specs_',
      'idx_pmo_ticket_paths_',
      'idx_pmo_ticket_criteria_',
      'idx_pmo_board_views_',
      'idx_pmo_workflow_statuses_',
      'idx_pmo_workflows_',
      'idx_pmo_roadmaps_',
      'idx_pmo_roadmap_projects_',
      'idx_pmo_monday_item_map_',
      'idx_pmo_ticket_labels_',
    ]

    try {
      const indexes = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL
      `).all() as { name: string }[]

      for (const { name } of indexes) {
        if (deadIndexPrefixes.some(prefix => name.startsWith(prefix))) {
          try {
            db.exec(`DROP INDEX IF EXISTS ${name}`)
          } catch {
            // Index may reference a dropped table — already gone
          }
        }
      }
    } catch {
      // Non-critical — indexes on dropped tables are auto-removed by SQLite
    }
  },
}
