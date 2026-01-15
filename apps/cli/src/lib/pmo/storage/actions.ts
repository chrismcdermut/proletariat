/**
 * Work action operations.
 */

import { PMO_TABLES } from '../schema.js'
import { PMOError, StateCategory, WorkAction, WorkActionFilter } from '../types.js'
import { slugify } from '../utils.js'
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

    if (filter?.suggestedFor) {
      conditions.push('suggested_for_categories LIKE ?')
      params.push(`%"${filter.suggestedFor}"%`)
    }

    if (filter?.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }

    sql += ' ORDER BY is_builtin DESC, position ASC, name ASC'

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
      INSERT INTO ${T.actions} (id, name, description, prompt, end_prompt, suggested_for_categories, default_move_to_category, modifies_code, is_builtin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      action.name,
      action.description || null,
      action.prompt,
      action.endPrompt || null,
      action.suggestedForCategories ? JSON.stringify(action.suggestedForCategories) : null,
      action.defaultMoveToCategory || null,
      modifiesCode ? 1 : 0,
      action.isBuiltin ? 1 : 0,
      now
    )

    return {
      id,
      name: action.name,
      description: action.description,
      prompt: action.prompt,
      endPrompt: action.endPrompt,
      suggestedForCategories: action.suggestedForCategories,
      defaultMoveToCategory: action.defaultMoveToCategory,
      modifiesCode,
      isBuiltin: action.isBuiltin || false,
      createdAt: new Date(now),
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
    if (changes.suggestedForCategories !== undefined) {
      updates.push('suggested_for_categories = ?')
      params.push(
        changes.suggestedForCategories ? JSON.stringify(changes.suggestedForCategories) : null
      )
    }
    if (changes.defaultMoveToCategory !== undefined) {
      updates.push('default_move_to_category = ?')
      params.push(changes.defaultMoveToCategory || null)
    }
    if (changes.modifiesCode !== undefined) {
      updates.push('modifies_code = ?')
      params.push(changes.modifiesCode ? 1 : 0)
    }

    if (updates.length > 0) {
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
   * Get suggested action for a state category.
   */
  async getSuggestedAction(category: StateCategory): Promise<WorkAction | null> {
    const actions = await this.listActions({ suggestedFor: category })
    return actions.length > 0 ? actions[0] : null
  }

  private rowToAction(row: WorkActionRow): WorkAction {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      prompt: row.prompt,
      endPrompt: row.end_prompt || undefined,
      suggestedForCategories: row.default_category
        ? (JSON.parse(row.default_category) as StateCategory[])
        : undefined,
      defaultMoveToCategory: row.default_category as StateCategory | undefined,
      modifiesCode: row.is_builtin === 1,
      isBuiltin: row.is_builtin === 1,
      createdAt: new Date(row.created_at),
    }
  }
}
