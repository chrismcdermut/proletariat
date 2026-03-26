/**
 * Migration 0017 — Drop agent_work FK to pmo_tickets
 *
 * Part of PMO removal. Recreates the agent_work table without the
 * FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE
 * constraint, allowing agent_work to exist independently of the PMO
 * ticket system.
 *
 * SQLite doesn't support ALTER TABLE DROP CONSTRAINT, so we recreate
 * the table (same pattern as migration 0013).
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const dropAgentWorkFk: Migration = {
  id: '0017',
  name: 'drop_agent_work_fk',
  up: (db: Database.Database) => {
    // Check that agent_work exists before attempting migration
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_work'")
      .get()
    if (!tableExists) return

    // 1. Create new table without the FK constraint to pmo_tickets
    // Includes all columns from the original schema + columns added by migrations 0014-0016
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_work_new (
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
        cleanup_policy TEXT NOT NULL DEFAULT 'on-exit',
        last_heartbeat TEXT,
        retries INTEGER DEFAULT 0,
        lifecycle_state TEXT DEFAULT 'healthy'
      );

      INSERT OR IGNORE INTO agent_work_new (
        id, ticket_id, agent_name, executor, environment, display_mode,
        permission_mode, status, branch, pid, container_id, session_id,
        host, log_path, external_source, external_key, external_id,
        external_url, started_at, completed_at, exit_code, error_message,
        cleanup_policy, last_heartbeat, retries, lifecycle_state
      )
      SELECT
        id, ticket_id, agent_name, executor, environment, display_mode,
        permission_mode, status, branch, pid, container_id, session_id,
        host, log_path, external_source, external_key, external_id,
        external_url, started_at, completed_at, exit_code, error_message,
        cleanup_policy, last_heartbeat, retries, lifecycle_state
      FROM agent_work;

      DROP TABLE agent_work;

      ALTER TABLE agent_work_new RENAME TO agent_work;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_agent_work_agent ON agent_work(agent_name);
      CREATE INDEX IF NOT EXISTS idx_agent_work_status ON agent_work(status);
      CREATE INDEX IF NOT EXISTS idx_agent_work_ticket ON agent_work(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_agent_work_lifecycle ON agent_work(lifecycle_state, status);
    `)
  },
}
