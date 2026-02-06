/**
 * Category operations.
 * Manages ticket and status categories.
 */

import { PMO_TABLES } from '../schema.js'
import { Category, CategoryFilter, CategoryType, PMOError } from '../types.js'
import { slugify } from '../utils.js'
import { StorageContext, CategoryRow } from './types.js'

const T = PMO_TABLES

export class CategoryStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * List categories.
   */
  async listCategories(filter?: CategoryFilter): Promise<Category[]> {
    let sql = `SELECT * FROM ${T.categories}`
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter?.type) {
      conditions.push('type = ?')
      params.push(filter.type)
    }

    if (filter?.isBuiltin !== undefined) {
      conditions.push('is_builtin = ?')
      params.push(filter.isBuiltin ? 1 : 0)
    }

    if (filter?.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }

    sql += ' ORDER BY type, position ASC, name ASC'

    const rows = this.ctx.db.prepare(sql).all(...params) as CategoryRow[]

    return rows.map((row) => this.rowToCategory(row))
  }

  /**
   * Get a category by ID.
   */
  async getCategory(id: string): Promise<Category | null> {
    const row = this.ctx.db.prepare(`SELECT * FROM ${T.categories} WHERE id = ?`).get(
      id
    ) as CategoryRow | undefined

    if (!row) return null

    return this.rowToCategory(row)
  }

  /**
   * Get a category by name and type.
   */
  async getCategoryByName(name: string, type: CategoryType): Promise<Category | null> {
    const row = this.ctx.db.prepare(`
      SELECT * FROM ${T.categories} WHERE LOWER(name) = LOWER(?) AND type = ?
    `).get(name, type) as CategoryRow | undefined

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
    const existing = this.ctx.db.prepare(`
      SELECT id FROM ${T.categories} WHERE LOWER(name) = LOWER(?) AND type = ?
    `).get(category.name, category.type)
    if (existing) {
      throw new PMOError('CONFLICT', `Category "${category.name}" already exists for type "${category.type}"`)
    }

    // Get the next position
    const maxPos = this.ctx.db.prepare(`
      SELECT MAX(position) as max FROM ${T.categories} WHERE type = ?
    `).get(category.type) as { max: number | null }
    const position = category.position ?? (maxPos.max ?? -1) + 1

    const now = new Date().toISOString()

    this.ctx.db.prepare(`
      INSERT INTO ${T.categories} (id, name, type, description, color, position, is_builtin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      category.name,
      category.type,
      category.description || null,
      category.color || null,
      position,
      category.isBuiltin ? 1 : 0,
      now
    )

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
      const dup = this.ctx.db.prepare(`
        SELECT id FROM ${T.categories} WHERE LOWER(name) = LOWER(?) AND type = ? AND id != ?
      `).get(changes.name, existing.type, id)
      if (dup) {
        throw new PMOError('CONFLICT', `Category "${changes.name}" already exists for type "${existing.type}"`)
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
    if (changes.color !== undefined) {
      updates.push('color = ?')
      params.push(changes.color || null)
    }
    if (changes.position !== undefined) {
      updates.push('position = ?')
      params.push(changes.position)
    }

    if (updates.length > 0) {
      params.push(id)
      this.ctx.db.prepare(`UPDATE ${T.categories} SET ${updates.join(', ')} WHERE id = ?`).run(
        ...params
      )
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
      const ticketsUsing = this.ctx.db.prepare(`
        SELECT COUNT(*) as count FROM ${T.tickets} WHERE category = ?
      `).get(existing.name) as { count: number }
      if (ticketsUsing.count > 0) {
        throw new PMOError('INVALID', `Cannot delete category "${existing.name}": ${ticketsUsing.count} ticket(s) are using it. Reassign tickets first.`)
      }
    } else if (existing.type === 'status') {
      const statusesUsing = this.ctx.db.prepare(`
        SELECT COUNT(*) as count FROM ${T.workflow_statuses} WHERE category = ?
      `).get(existing.name) as { count: number }
      if (statusesUsing.count > 0) {
        throw new PMOError('INVALID', `Cannot delete category "${existing.name}": ${statusesUsing.count} status(es) are using it. Reassign statuses first.`)
      }
    }

    this.ctx.db.prepare(`DELETE FROM ${T.categories} WHERE id = ?`).run(id)
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

  private rowToCategory(row: CategoryRow): Category {
    return {
      id: row.id,
      name: row.name,
      type: row.type as CategoryType,
      description: row.description || undefined,
      color: row.color || undefined,
      position: row.position,
      isBuiltin: row.is_builtin === 1,
      createdAt: new Date(row.created_at),
    }
  }
}
