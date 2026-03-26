/**
 * Migration 0018 — Create ticket_refs table
 *
 * Part of PMO removal. Adds a lightweight ticket_refs table for
 * runtime ticket caching. This replaces the dependency on pmo_tickets
 * for agent_work and other runtime operations, storing just enough
 * ticket metadata for display and lookup without requiring the full
 * PMO storage layer.
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const createTicketRefs: Migration = {
  id: '0018',
  name: 'create_ticket_refs',
  up: (db: Database.Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ticket_refs (
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
      );

      CREATE INDEX IF NOT EXISTS idx_ticket_refs_provider ON ticket_refs(provider);
      CREATE INDEX IF NOT EXISTS idx_ticket_refs_external_key ON ticket_refs(provider, external_key);
      CREATE INDEX IF NOT EXISTS idx_ticket_refs_status ON ticket_refs(status);
      CREATE INDEX IF NOT EXISTS idx_ticket_refs_project ON ticket_refs(project_id);
    `)
  },
}
