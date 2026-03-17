import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

/**
 * Migration 0005: Add validation_result column to agent_work table.
 *
 * Stores the JSON-serialized CommitValidationResult for each execution,
 * enabling audit trails for post-execution commit validation (PRLT-984).
 */
export const commitValidation: Migration = {
  id: '0005',
  name: 'commit_validation',
  up: (db: Database.Database) => {
    // Check if the column already exists (idempotent)
    const columns = db.prepare("PRAGMA table_info('agent_work')").all() as { name: string }[]
    const hasColumn = columns.some(col => col.name === 'validation_result')
    if (hasColumn) return

    db.exec(`
      ALTER TABLE agent_work ADD COLUMN validation_result TEXT
    `)
  },
}
