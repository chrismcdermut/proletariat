/**
 * Migration 0003 — Actions Table Redesign
 *
 * Redesigns pmo_actions to use state-name-based wiring (from_state/to_state)
 * instead of category-based (suggestedForCategories/defaultMoveToCategory).
 *
 * New columns: from_state, to_state, executor, environment, permission_mode,
 *              timeout, model, is_default, updated_at
 * Removed columns: suggested_for_categories, default_move_to_category
 *
 * Migration strategy: Add new columns first, migrate data, then remove old columns.
 * SQLite doesn't support DROP COLUMN before 3.35.0, so we recreate the table.
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

/**
 * Map a StateCategory to a default state name.
 * Used during migration to convert old category-based values to state names.
 */
function categoryToStateName(category: string): string {
  const map: Record<string, string> = {
    triage: 'Triage',
    backlog: 'Backlog',
    unstarted: 'Todo',
    started: 'In Progress',
    completed: 'Done',
    canceled: 'Canceled',
  }
  return map[category] || category
}

export const actionsRedesign: Migration = {
  id: '0003',
  name: 'actions_redesign',
  up: (db: SqliteDatabase) => {
    // Check if pmo_actions table exists
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_actions'"
    ).get()
    if (!tableExists) return

    // Check if migration is already done (from_state column exists)
    const columns = db.pragma('table_info(pmo_actions)') as Array<{ name: string }>
    const columnNames = new Set(columns.map(c => c.name))

    if (columnNames.has('from_state')) {
      // Already migrated — just ensure old columns are gone
      return
    }

    // Read existing data before migration
    const existingActions = db.prepare('SELECT * FROM pmo_actions').all() as Array<{
      id: string
      name: string
      description: string | null
      prompt: string
      end_prompt: string | null
      suggested_for_categories: string | null
      default_move_to_category: string | null
      modifies_code: number
      is_builtin: number
      position: number
      created_at: string
    }>

    // Create new table with updated schema
    db.exec(`
      CREATE TABLE pmo_actions_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        prompt TEXT NOT NULL,
        end_prompt TEXT,
        from_state TEXT,
        to_state TEXT,
        executor TEXT CHECK (executor IN ('claude', 'codex', 'opencode', 'custom')),
        environment TEXT CHECK (environment IN ('devcontainer', 'docker', 'host', 'vm')),
        permission_mode TEXT CHECK (permission_mode IN ('full', 'readonly', 'bypassPermissions')),
        timeout INTEGER,
        model TEXT,
        modifies_code INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP
      )
    `)

    // Migrate existing actions with backward-compatible data mapping
    const insert = db.prepare(`
      INSERT INTO pmo_actions_new (id, name, description, prompt, end_prompt, from_state, to_state,
        executor, environment, permission_mode, modifies_code, is_default, is_builtin, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const action of existingActions) {
      // Map suggestedForCategories to from_state (use first category as from_state)
      let fromState: string | null = null
      if (action.suggested_for_categories) {
        try {
          const categories = JSON.parse(action.suggested_for_categories) as string[]
          if (categories.length > 0) {
            fromState = categoryToStateName(categories[0])
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Map defaultMoveToCategory to to_state
      const toState = action.default_move_to_category
        ? categoryToStateName(action.default_move_to_category)
        : null

      insert.run(
        action.id,
        action.name,
        action.description,
        action.prompt,
        action.end_prompt,
        fromState,
        toState,
        'claude',       // Default executor
        'host',         // Default environment
        'full',         // Default permission mode
        action.modifies_code,
        0,              // is_default
        action.is_builtin,
        action.position,
        action.created_at,
        action.created_at  // updated_at = created_at for migrated records
      )
    }

    // Swap tables
    db.exec('DROP TABLE pmo_actions')
    db.exec('ALTER TABLE pmo_actions_new RENAME TO pmo_actions')
  },
}
