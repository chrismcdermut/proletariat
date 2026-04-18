/**
 * Work Lifecycle Hook Storage
 *
 * CRUD operations for hook configurations in the workspace database.
 * Hooks are stored in the pmo_work_hooks table.
 */

import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { WorkHookConfig, WorkHookRow, HookableEvent, HookActionType, HookMode } from './types.js'

/** Table name for work hooks. */
export const HOOKS_TABLE = 'pmo_work_hooks'

/** SQL to create the hooks table. */
export const HOOKS_TABLE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS ${HOOKS_TABLE} (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    event TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN ('shell', 'webhook', 'log', 'action')),
    action_value TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`

export const HOOKS_TABLE_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_event ON ${HOOKS_TABLE}(event);
  CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_enabled ON ${HOOKS_TABLE}(enabled);
`

/**
 * Ensure the hooks table exists in the database.
 * Safe to call multiple times.
 */
export function ensureHooksTable(db: Database.Database): void {
  db.exec(HOOKS_TABLE_SCHEMA)
  db.exec(HOOKS_TABLE_INDEX)
}

/**
 * Convert a database row to a WorkHookConfig.
 */
function rowToConfig(row: WorkHookRow): WorkHookConfig {
  let config: Record<string, unknown> | null = null
  if (row.config) {
    try {
      config = JSON.parse(row.config) as Record<string, unknown>
    } catch {
      // Invalid JSON — ignore
    }
  }

  return {
    id: row.id,
    name: row.name,
    event: row.event as HookableEvent,
    actionType: row.action_type as HookActionType,
    actionValue: row.action_value,
    enabled: row.enabled === 1,
    description: row.description,
    createdAt: row.created_at,
    mode: (row.mode as HookMode) || 'auto',
    priority: row.priority ?? 0,
    config,
  }
}

/**
 * WorkHookStorage provides CRUD operations for hook configurations.
 */
export class WorkHookStorage {
  constructor(private db: Database.Database) {
    ensureHooksTable(db)
  }

  /**
   * List all hooks, optionally filtered by event name or enabled status.
   * Returns hooks ordered by priority (ascending), then creation time.
   */
  list(options?: { event?: HookableEvent; enabled?: boolean }): WorkHookConfig[] {
    const params: unknown[] = []
    let where = ' WHERE 1=1'

    if (options?.event) {
      where += ' AND event = ?'
      params.push(options.event)
    }
    if (options?.enabled !== undefined) {
      where += ' AND enabled = ?'
      params.push(options.enabled ? 1 : 0)
    }

    // Try extended query with mode/priority/config columns first
    try {
      const sql = `SELECT id, name, event, action_type, action_value, enabled, description, created_at, mode, priority, config FROM ${HOOKS_TABLE}${where} ORDER BY priority ASC, created_at ASC`
      const rows = this.db.prepare(sql).all(...params) as WorkHookRow[]
      return rows.map(rowToConfig)
    } catch {
      // Fallback without mode/priority/config (pre-migration)
      const sql = `SELECT id, name, event, action_type, action_value, enabled, description, created_at FROM ${HOOKS_TABLE}${where} ORDER BY created_at ASC`
      const rows = this.db.prepare(sql).all(...params) as WorkHookRow[]
      return rows.map(rowToConfig)
    }
  }

  /**
   * Get a single hook by ID.
   */
  getById(id: string): WorkHookConfig | null {
    const row = this.db.prepare(`SELECT * FROM ${HOOKS_TABLE} WHERE id = ?`).get(id) as WorkHookRow | undefined
    return row ? rowToConfig(row) : null
  }

  /**
   * Get a single hook by name.
   */
  getByName(name: string): WorkHookConfig | null {
    const row = this.db.prepare(`SELECT * FROM ${HOOKS_TABLE} WHERE name = ?`).get(name) as WorkHookRow | undefined
    return row ? rowToConfig(row) : null
  }

  /**
   * Create a new hook configuration.
   */
  create(params: {
    name: string
    event: HookableEvent
    actionType: HookActionType
    actionValue: string
    description?: string
  }): WorkHookConfig {
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO ${HOOKS_TABLE} (id, name, event, action_type, action_value, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, params.name, params.event, params.actionType, params.actionValue, params.description ?? null)

    return this.getById(id)!
  }

  /**
   * Delete a hook by ID.
   */
  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM ${HOOKS_TABLE} WHERE id = ?`).run(id)
    return result.changes > 0
  }

  /**
   * Enable or disable a hook.
   */
  setEnabled(id: string, enabled: boolean): boolean {
    const result = this.db.prepare(`UPDATE ${HOOKS_TABLE} SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id)
    return result.changes > 0
  }
}
