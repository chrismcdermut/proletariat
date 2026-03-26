/**
 * Work action operations.
 */

import { PMO_TABLES } from '../schema.js'
import { PMOError, WorkAction, WorkActionFilter, ActionExecutor, ActionEnvironment, ActionPermissionMode, ReviewGateMode } from '../types.js'
import { slugify } from '../../utils/text.js'
import { StorageContext, WorkActionRow } from './types.js'

const T = PMO_TABLES

export class ActionStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * List work actions.
   */
  async listActions(filter?: WorkActionFilter): Promise<WorkAction[]> {
    let sql = `SELECT * FROM ${T.actions}`
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter?.isBuiltin !== undefined) {
      conditions.push('is_builtin = ?')
      params.push(filter.isBuiltin ? 1 : 0)
    }

    if (filter?.fromState) {
      // Match actions where from_state equals the given state name, or from_state is null (matches any)
      conditions.push('(from_state = ? OR from_state IS NULL)')
      params.push(filter.fromState)
    }

    if (filter?.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }

    sql += ' ORDER BY is_builtin DESC, is_default DESC, position ASC, name ASC'

    const rows = this.ctx.db.prepare(sql).all(...params) as WorkActionRow[]

    return rows.map((row) => this.rowToAction(row))
  }

  /**
   * Get a work action by ID.
   */
  async getAction(id: string): Promise<WorkAction | null> {
    const row = this.ctx.db.prepare(`SELECT * FROM ${T.actions} WHERE id = ?`).get(
      id
    ) as WorkActionRow | undefined

    if (!row) return null

    return this.rowToAction(row)
  }

  /**
   * Create a new work action.
   */
  async createAction(action: Partial<WorkAction>): Promise<WorkAction> {
    if (!action.name) {
      throw new PMOError('INVALID', 'Action name is required')
    }
    if (!action.prompt) {
      throw new PMOError('INVALID', 'Action prompt is required')
    }

    const id = action.id || slugify(action.name)

    // Check for duplicate name
    const existing = this.ctx.db.prepare(`
      SELECT id FROM ${T.actions} WHERE LOWER(name) = LOWER(?)
    `).get(action.name)
    if (existing) {
      throw new PMOError('CONFLICT', `Action with name "${action.name}" already exists`)
    }

    const now = new Date().toISOString()
    const modifiesCode = action.modifiesCode !== false

    this.ctx.db.prepare(`
      INSERT INTO ${T.actions} (id, name, description, prompt, end_prompt, from_state, to_state,
        executor, environment, permission_mode, timeout, model, review_gate, network_allowlist, modifies_code, is_default, is_builtin, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      action.name,
      action.description || null,
      action.prompt,
      action.endPrompt || null,
      action.fromState || null,
      action.toState || null,
      action.executor || null,
      action.environment || null,
      action.permissionMode || null,
      action.timeout || null,
      action.model || null,
      action.reviewGate || null,
      action.networkAllowlist?.length ? JSON.stringify(action.networkAllowlist) : null,
      modifiesCode ? 1 : 0,
      action.isDefault ? 1 : 0,
      action.isBuiltin ? 1 : 0,
      action.position || 0,
      now,
      now
    )

    return {
      id,
      name: action.name,
      description: action.description,
      prompt: action.prompt,
      endPrompt: action.endPrompt,
      fromState: action.fromState,
      toState: action.toState,
      executor: action.executor,
      environment: action.environment,
      permissionMode: action.permissionMode,
      timeout: action.timeout,
      model: action.model,
      reviewGate: action.reviewGate,
      networkAllowlist: action.networkAllowlist,
      modifiesCode,
      isDefault: action.isDefault,
      isBuiltin: action.isBuiltin || false,
      position: action.position || 0,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  }

  /**
   * Update a work action.
   */
  async updateAction(id: string, changes: Partial<WorkAction>): Promise<WorkAction> {
    const existing = await this.getAction(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Action not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot modify built-in actions')
    }

    // Check for duplicate name if name is changing
    if (changes.name && changes.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = this.ctx.db.prepare(`
        SELECT id FROM ${T.actions} WHERE LOWER(name) = LOWER(?) AND id != ?
      `).get(changes.name, id)
      if (dup) {
        throw new PMOError('CONFLICT', `Action "${changes.name}" already exists`)
      }
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description || null)
    }
    if (changes.prompt !== undefined) {
      updates.push('prompt = ?')
      params.push(changes.prompt)
    }
    if (changes.endPrompt !== undefined) {
      updates.push('end_prompt = ?')
      params.push(changes.endPrompt || null)
    }
    if (changes.fromState !== undefined) {
      updates.push('from_state = ?')
      params.push(changes.fromState || null)
    }
    if (changes.toState !== undefined) {
      updates.push('to_state = ?')
      params.push(changes.toState || null)
    }
    if (changes.executor !== undefined) {
      updates.push('executor = ?')
      params.push(changes.executor || null)
    }
    if (changes.environment !== undefined) {
      updates.push('environment = ?')
      params.push(changes.environment || null)
    }
    if (changes.permissionMode !== undefined) {
      updates.push('permission_mode = ?')
      params.push(changes.permissionMode || null)
    }
    if (changes.timeout !== undefined) {
      updates.push('timeout = ?')
      params.push(changes.timeout || null)
    }
    if (changes.model !== undefined) {
      updates.push('model = ?')
      params.push(changes.model || null)
    }
    if (changes.reviewGate !== undefined) {
      updates.push('review_gate = ?')
      params.push(changes.reviewGate || null)
    }
    if (changes.networkAllowlist !== undefined) {
      updates.push('network_allowlist = ?')
      params.push(changes.networkAllowlist?.length ? JSON.stringify(changes.networkAllowlist) : null)
    }
    if (changes.modifiesCode !== undefined) {
      updates.push('modifies_code = ?')
      params.push(changes.modifiesCode ? 1 : 0)
    }
    if (changes.isDefault !== undefined) {
      updates.push('is_default = ?')
      params.push(changes.isDefault ? 1 : 0)
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(new Date().toISOString())
      params.push(id)
      this.ctx.db.prepare(`UPDATE ${T.actions} SET ${updates.join(', ')} WHERE id = ?`).run(
        ...params
      )
    }

    return (await this.getAction(id))!
  }

  /**
   * Delete a work action.
   */
  async deleteAction(id: string): Promise<void> {
    const existing = await this.getAction(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Action not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot delete built-in actions')
    }

    this.ctx.db.prepare(`DELETE FROM ${T.actions} WHERE id = ?`).run(id)
  }

  /**
   * Get suggested action for a state name.
   * Matches actions where from_state equals the given state name, or from_state is null.
   * Prefers exact from_state matches with is_default=true, then by position.
   */
  async getSuggestedAction(stateName: string): Promise<WorkAction | null> {
    // First try to find a default action with exact from_state match
    const exactMatch = this.ctx.db.prepare(`
      SELECT * FROM ${T.actions}
      WHERE from_state = ? AND is_default = 1
      ORDER BY position ASC
      LIMIT 1
    `).get(stateName) as WorkActionRow | undefined

    if (exactMatch) {
      return this.rowToAction(exactMatch)
    }

    // Fall back to any action matching this state (exact match first, then null from_state)
    const anyMatch = this.ctx.db.prepare(`
      SELECT * FROM ${T.actions}
      WHERE from_state = ? OR from_state IS NULL
      ORDER BY
        CASE WHEN from_state = ? THEN 0 ELSE 1 END,
        is_default DESC,
        position ASC
      LIMIT 1
    `).get(stateName, stateName) as WorkActionRow | undefined

    if (anyMatch) {
      return this.rowToAction(anyMatch)
    }

    return null
  }

  private rowToAction(row: WorkActionRow): WorkAction {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      prompt: row.prompt,
      endPrompt: row.end_prompt || undefined,
      fromState: row.from_state || undefined,
      toState: row.to_state || undefined,
      executor: (row.executor as ActionExecutor) || undefined,
      environment: (row.environment as ActionEnvironment) || undefined,
      permissionMode: (row.permission_mode as ActionPermissionMode) || undefined,
      timeout: row.timeout || undefined,
      model: row.model || undefined,
      reviewGate: (row.review_gate as ReviewGateMode) || undefined,
      networkAllowlist: row.network_allowlist ? JSON.parse(row.network_allowlist) : undefined,
      modifiesCode: row.modifies_code === 1,
      isDefault: row.is_default === 1,
      isBuiltin: row.is_builtin === 1,
      position: row.position,
      createdAt: new Date(row.created_at),
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
    }
  }
}
