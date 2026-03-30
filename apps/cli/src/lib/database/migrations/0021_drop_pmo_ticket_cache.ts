/**
 * Migration 0021 — Drop PMO ticket cache tables
 *
 * The local DB holds integration routing only — providers are queried
 * live for ticket and PR data. This migration drops the local cache
 * tables that duplicated provider data:
 *
 * - pmo_tickets (query provider live)
 * - pmo_linear_issue_map (use provider IDs directly via ticket metadata)
 * - pmo_external_execution_prs (query GitHub live)
 * - pmo_board_tickets (deprecated, tickets use status_id directly)
 * - pmo_board_views (query provider live)
 * - pmo_provider_status_map (sync layer removed)
 * - pmo_provider_triggers (sync layer removed)
 *
 * Also adds daemon_events table for lightweight event dedup.
 *
 * Tables kept:
 * - ticket_refs (runtime ticket cache, provider-agnostic)
 * - pmo_transition_map (intent → provider state mapping)
 * - pmo_external_execution_map, pmo_external_execution_links (execution tracking)
 * - pmo_projects, pmo_workflows, pmo_workflow_statuses (config)
 * - agents, agent_work, containers, sessions, worktrees (runtime)
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const dropPmoTicketCache: Migration = {
  id: '0021',
  name: 'drop_pmo_ticket_cache',
  up: (db: Database.Database) => {
    // Drop ticket cache tables (data now queried from providers live)
    // Use IF EXISTS since some databases may not have all tables
    db.exec(`
      DROP TABLE IF EXISTS pmo_board_tickets;
      DROP TABLE IF EXISTS pmo_board_views;
      DROP TABLE IF EXISTS pmo_ticket_acceptance_criteria;
      DROP TABLE IF EXISTS pmo_subtasks;
      DROP TABLE IF EXISTS pmo_ticket_metadata;
      DROP TABLE IF EXISTS pmo_ticket_dependencies;
      DROP TABLE IF EXISTS pmo_ticket_affected_paths;
      DROP TABLE IF EXISTS pmo_ticket_assignments;
      DROP TABLE IF EXISTS pmo_ticket_labels;
      DROP TABLE IF EXISTS pmo_ticket_specs;
      DROP TABLE IF EXISTS pmo_tickets;
      DROP TABLE IF EXISTS pmo_linear_issue_map;
      DROP TABLE IF EXISTS pmo_external_execution_prs;
      DROP TABLE IF EXISTS pmo_provider_status_map;
      DROP TABLE IF EXISTS pmo_provider_triggers;
    `)

    // Daemon event dedup table: tracks events the daemon has already
    // acted on so it doesn't fire the same action twice.
    db.exec(`
      CREATE TABLE IF NOT EXISTS daemon_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        event_key TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT '*',
        payload_hash TEXT,
        fired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_type, event_key, provider)
      );

      CREATE INDEX IF NOT EXISTS idx_daemon_events_type_key
        ON daemon_events(event_type, event_key);
      CREATE INDEX IF NOT EXISTS idx_daemon_events_fired
        ON daemon_events(fired_at);
    `)
  },
}
