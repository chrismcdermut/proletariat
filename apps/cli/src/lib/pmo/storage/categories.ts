/**
 * Category operations.
 * Manages ticket and status categories.
 *
 * This module uses Drizzle ORM for type-safe database queries.
 */

import { eq, and, like, or, asc, sql } from 'drizzle-orm'
import {
  pmoCategories,
  pmoTickets,
  pmoWorkflowStatuses,
} from '../../database/drizzle-schema.js'
import { Category, CategoryFilter, CategoryType, PMOError } from '../types.js'
import { slugify } from '../utils.js'
import { StorageContext } from './types.js'

export class CategoryStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * List categories.
   */
  async listCategories(filter?: CategoryFilter): Promise<Category[]> {
    let query = this.ctx.drizzle
      .select()
      .from(pmoCategories)
      .$dynamic()

    const conditions = []

    if (filter?.type) {
      conditions.push(eq(pmoCategories.type, filter.type))
    }

    if (filter?.isBuiltin !== undefined) {
      conditions.push(eq(pmoCategories.isBuiltin, filter.isBuiltin))
    }

    if (filter?.search) {
      conditions.push(
        or(
          like(pmoCategories.name, `%${filter.search}%`),
          like(pmoCategories.description, `%${filter.search}%`)
        )
      )
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions))
    }

    const rows = query
      .orderBy(asc(pmoCategories.type), asc(pmoCategories.position), asc(pmoCategories.name))
      .all()

    return rows.map((row) => this.rowToCategory(row))
  }

  /**
   * Get a category by ID.
   */
  async getCategory(id: string): Promise<Category | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoCategories)
      .where(eq(pmoCategories.id, id))
      .get()

    if (!row) return null

    return this.rowToCategory(row)
  }

  /**
   * Get a category by name and type.
   */
  async getCategoryByName(name: string, type: CategoryType): Promise<Category | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoCategories)
      .where(and(
        sql`LOWER(${pmoCategories.name}) = LOWER(${name})`,
        eq(pmoCategories.type, type)
      ))
      .get()

    if (!row) return null

    return this.rowToCategory(row)
  }

  /**
   * Create a new category.
   */
  async createCategory(category: Partial<Category> & { name: string; type: CategoryType }): Promise<Category> {
    if (!category.name) {
      throw new PMOError('INVALID', 'Category name is required')
    }
    if (!category.type) {
      throw new PMOError('INVALID', 'Category type is required')
    }

    const id = category.id || slugify(category.name)

    // Check for duplicate name within the same type
    const existing = this.ctx.drizzle
      .select({ id: pmoCategories.id })
      .from(pmoCategories)
      .where(and(
        sql`LOWER(${pmoCategories.name}) = LOWER(${category.name})`,
        eq(pmoCategories.type, category.type)
      ))
      .get()
    if (existing) {
      throw new PMOError('CONFLICT', `Category "${category.name}" already exists for type "${category.type}"`)
    }

    // Get the next position
    const maxPos = this.ctx.drizzle
      .select({ max: sql<number | null>`MAX(${pmoCategories.position})` })
      .from(pmoCategories)
      .where(eq(pmoCategories.type, category.type))
      .get()
    const position = category.position ?? ((maxPos?.max ?? -1) + 1)

    const now = new Date().toISOString()

    this.ctx.drizzle.insert(pmoCategories).values({
      id,
      name: category.name,
      type: category.type,
      description: category.description || null,
      color: category.color || null,
      position,
      isBuiltin: category.isBuiltin || false,
      createdAt: now,
    }).run()

    return {
      id,
      name: category.name,
      type: category.type,
      description: category.description,
      color: category.color,
      position,
      isBuiltin: category.isBuiltin || false,
      createdAt: new Date(now),
    }
  }

  /**
   * Update a category.
   */
  async updateCategory(id: string, changes: Partial<Category>): Promise<Category> {
    const existing = await this.getCategory(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Category not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot modify built-in categories')
    }

    // Check for duplicate name if name is changing
    if (changes.name && changes.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = this.ctx.drizzle
        .select({ id: pmoCategories.id })
        .from(pmoCategories)
        .where(and(
          sql`LOWER(${pmoCategories.name}) = LOWER(${changes.name})`,
          eq(pmoCategories.type, existing.type),
          sql`${pmoCategories.id} != ${id}`
        ))
        .get()
      if (dup) {
        throw new PMOError('CONFLICT', `Category "${changes.name}" already exists for type "${existing.type}"`)
      }
    }

    const updates: Partial<typeof pmoCategories.$inferInsert> = {}

    if (changes.name !== undefined) {
      updates.name = changes.name
    }
    if (changes.description !== undefined) {
      updates.description = changes.description || null
    }
    if (changes.color !== undefined) {
      updates.color = changes.color || null
    }
    if (changes.position !== undefined) {
      updates.position = changes.position
    }

    if (Object.keys(updates).length > 0) {
      this.ctx.drizzle
        .update(pmoCategories)
        .set(updates)
        .where(eq(pmoCategories.id, id))
        .run()
    }

    return (await this.getCategory(id))!
  }

  /**
   * Rename a category.
   */
  async renameCategory(id: string, newName: string): Promise<Category> {
    return this.updateCategory(id, { name: newName })
  }

  /**
   * Delete a category.
   */
  async deleteCategory(id: string): Promise<void> {
    const existing = await this.getCategory(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Category not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot delete built-in categories')
    }

    // Check if the category is in use
    if (existing.type === 'ticket') {
      const ticketsUsing = this.ctx.drizzle
        .select({ count: sql<number>`COUNT(*)` })
        .from(pmoTickets)
        .where(eq(pmoTickets.category, existing.name))
        .get()
      if (ticketsUsing && ticketsUsing.count > 0) {
        throw new PMOError('INVALID', `Cannot delete category "${existing.name}": ${ticketsUsing.count} ticket(s) are using it. Reassign tickets first.`)
      }
    } else if (existing.type === 'status') {
      const statusesUsing = this.ctx.drizzle
        .select({ count: sql<number>`COUNT(*)` })
        .from(pmoWorkflowStatuses)
        .where(eq(pmoWorkflowStatuses.category, existing.name))
        .get()
      if (statusesUsing && statusesUsing.count > 0) {
        throw new PMOError('INVALID', `Cannot delete category "${existing.name}": ${statusesUsing.count} status(es) are using it. Reassign statuses first.`)
      }
    }

    this.ctx.drizzle
      .delete(pmoCategories)
      .where(eq(pmoCategories.id, id))
      .run()
  }

  /**
   * Get category names for a type (for validation and autocomplete).
   */
  async getCategoryNames(type: CategoryType): Promise<string[]> {
    const categories = await this.listCategories({ type })
    return categories.map(c => c.name)
  }

  /**
   * Check if a category name is valid for a type.
   */
  async isValidCategory(name: string, type: CategoryType): Promise<boolean> {
    const category = await this.getCategoryByName(name, type)
    return category !== null
  }

  private rowToCategory(row: {
    id: string
    name: string
    type: string
    description: string | null
    color: string | null
    position: number
    isBuiltin: boolean | null
    createdAt: string | null
  }): Category {
    return {
      id: row.id,
      name: row.name,
      type: row.type as CategoryType,
      description: row.description || undefined,
      color: row.color || undefined,
      position: row.position,
      isBuiltin: row.isBuiltin ?? false,
      createdAt: new Date(row.createdAt || Date.now()),
    }
  }
}
