/**
 * Work action operations.
 *
 * This module uses Drizzle ORM for type-safe database queries.
 */

import { eq, and, like, or, asc, sql } from 'drizzle-orm'
import {
  pmoActions,
} from '../../database/drizzle-schema.js'
import { PMOError, StateCategory, WorkAction, WorkActionFilter } from '../types.js'
import { slugify } from '../utils.js'
import { StorageContext } from './types.js'

export class ActionStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * List work actions.
   */
  async listActions(filter?: WorkActionFilter): Promise<WorkAction[]> {
    let query = this.ctx.drizzle
      .select()
      .from(pmoActions)
      .$dynamic()

    const conditions = []

    if (filter?.isBuiltin !== undefined) {
      conditions.push(eq(pmoActions.isBuiltin, filter.isBuiltin))
    }

    if (filter?.suggestedFor) {
      conditions.push(like(pmoActions.suggestedForCategories, `%"${filter.suggestedFor}"%`))
    }

    if (filter?.search) {
      conditions.push(
        or(
          like(pmoActions.name, `%${filter.search}%`),
          like(pmoActions.description, `%${filter.search}%`)
        )
      )
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions))
    }

    const rows = query
      .orderBy(sql`${pmoActions.isBuiltin} DESC`, asc(pmoActions.position), asc(pmoActions.name))
      .all()

    return rows.map((row) => this.rowToAction(row))
  }

  /**
   * Get a work action by ID.
   */
  async getAction(id: string): Promise<WorkAction | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoActions)
      .where(eq(pmoActions.id, id))
      .get()

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
    const existing = this.ctx.drizzle
      .select({ id: pmoActions.id })
      .from(pmoActions)
      .where(sql`LOWER(${pmoActions.name}) = LOWER(${action.name})`)
      .get()
    if (existing) {
      throw new PMOError('CONFLICT', `Action with name "${action.name}" already exists`)
    }

    const now = new Date().toISOString()
    const modifiesCode = action.modifiesCode !== false

    this.ctx.drizzle.insert(pmoActions).values({
      id,
      name: action.name,
      description: action.description || null,
      prompt: action.prompt,
      endPrompt: action.endPrompt || null,
      suggestedForCategories: action.suggestedForCategories ? JSON.stringify(action.suggestedForCategories) : null,
      defaultMoveToCategory: action.defaultMoveToCategory || null,
      modifiesCode,
      isBuiltin: action.isBuiltin || false,
      createdAt: now,
    }).run()

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
      const dup = this.ctx.drizzle
        .select({ id: pmoActions.id })
        .from(pmoActions)
        .where(and(
          sql`LOWER(${pmoActions.name}) = LOWER(${changes.name})`,
          sql`${pmoActions.id} != ${id}`
        ))
        .get()
      if (dup) {
        throw new PMOError('CONFLICT', `Action "${changes.name}" already exists`)
      }
    }

    const updates: Partial<typeof pmoActions.$inferInsert> = {}

    if (changes.name !== undefined) {
      updates.name = changes.name
    }
    if (changes.description !== undefined) {
      updates.description = changes.description || null
    }
    if (changes.prompt !== undefined) {
      updates.prompt = changes.prompt
    }
    if (changes.endPrompt !== undefined) {
      updates.endPrompt = changes.endPrompt || null
    }
    if (changes.suggestedForCategories !== undefined) {
      updates.suggestedForCategories = changes.suggestedForCategories ? JSON.stringify(changes.suggestedForCategories) : null
    }
    if (changes.defaultMoveToCategory !== undefined) {
      updates.defaultMoveToCategory = changes.defaultMoveToCategory || null
    }
    if (changes.modifiesCode !== undefined) {
      updates.modifiesCode = changes.modifiesCode
    }

    if (Object.keys(updates).length > 0) {
      this.ctx.drizzle
        .update(pmoActions)
        .set(updates)
        .where(eq(pmoActions.id, id))
        .run()
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

    this.ctx.drizzle
      .delete(pmoActions)
      .where(eq(pmoActions.id, id))
      .run()
  }

  /**
   * Get suggested action for a state category.
   */
  async getSuggestedAction(category: StateCategory): Promise<WorkAction | null> {
    const actions = await this.listActions({ suggestedFor: category })
    return actions.length > 0 ? actions[0] : null
  }

  private rowToAction(row: {
    id: string
    name: string
    description: string | null
    prompt: string
    endPrompt: string | null
    suggestedForCategories: string | null
    defaultMoveToCategory: string | null
    modifiesCode: boolean | null
    isBuiltin: boolean | null
    position: number
    createdAt: string | null
  }): WorkAction {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      prompt: row.prompt,
      endPrompt: row.endPrompt || undefined,
      suggestedForCategories: row.suggestedForCategories
        ? (JSON.parse(row.suggestedForCategories) as StateCategory[])
        : undefined,
      defaultMoveToCategory: (row.defaultMoveToCategory as StateCategory) || undefined,
      modifiesCode: row.modifiesCode ?? true,
      isBuiltin: row.isBuiltin ?? false,
      createdAt: new Date(row.createdAt || Date.now()),
    }
  }
}
