/**
 * Migration 0013 — Agent Lifecycle States
 *
 * Placeholder for agent lifecycle state tracking.
 * The schema already includes the necessary columns via baseline;
 * this migration exists to maintain the migration sequence.
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

export const agentLifecycleStates: Migration = {
  id: '0013',
  name: 'agent_lifecycle_states',
  up: (_db: SqliteDatabase) => {
    // No-op: lifecycle state columns already exist in baseline schema.
    // This migration placeholder preserves the migration ID sequence.
  },
}
