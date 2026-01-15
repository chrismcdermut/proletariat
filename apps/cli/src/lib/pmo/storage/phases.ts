/**
 * Project phase operations.
 */

import { PMO_TABLES } from '../schema.js'
import {
  PhaseFilter,
  PhaseTemplate,
  PhaseTemplateFilter,
  PhaseTemplatePhase,
  PMOError,
  ProjectPhase,
  StateCategory,
  STATE_CATEGORY_ORDER,
} from '../types.js'
import { slugify } from '../utils.js'
import { StorageContext, PhaseRow, PhaseTemplateRow } from './types.js'

const T = PMO_TABLES

export class PhaseStorage {
  constructor(private ctx: StorageContext) {}

  // =========================================================================
  // Project Phases
  // =========================================================================

  /**
   * List project phases.
   */
  async listPhases(filter?: PhaseFilter): Promise<ProjectPhase[]> {
    let sql = `SELECT * FROM ${T.phases}`
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter?.category) {
      conditions.push('category = ?')
      params.push(filter.category)
    }

    if (filter?.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      const searchTerm = `%${filter.search}%`
      params.push(searchTerm, searchTerm)
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    sql += ` ORDER BY
      CASE category
        WHEN 'backlog' THEN 0
        WHEN 'unstarted' THEN 1
        WHEN 'started' THEN 2
        WHEN 'completed' THEN 3
        WHEN 'canceled' THEN 4
      END,
      position`

    const rows = this.ctx.db.prepare(sql).all(...params) as PhaseRow[]

    return rows.map((row) => this.rowToPhase(row))
  }

  /**
   * Get a phase by ID.
   */
  async getPhase(id: string): Promise<ProjectPhase | null> {
    const row = this.ctx.db.prepare(`SELECT * FROM ${T.phases} WHERE id = ?`).get(
      id
    ) as PhaseRow | undefined

    if (!row) return null

    return this.rowToPhase(row)
  }

  /**
   * Create a new phase.
   */
  async createPhase(phase: Partial<ProjectPhase>): Promise<ProjectPhase> {
    if (!phase.name) {
      throw new PMOError('INVALID', 'Phase name is required')
    }

    if (!phase.category) {
      throw new PMOError('INVALID', 'Phase category is required')
    }

    if (!STATE_CATEGORY_ORDER.includes(phase.category)) {
      throw new PMOError(
        'INVALID',
        `Invalid category: ${phase.category}. Must be one of: ${STATE_CATEGORY_ORDER.join(', ')}`
      )
    }

    // Check for duplicate name
    const existing = this.ctx.db.prepare(`
      SELECT id FROM ${T.phases} WHERE LOWER(name) = LOWER(?)
    `).get(phase.name)
    if (existing) {
      throw new PMOError('CONFLICT', `Phase "${phase.name}" already exists`)
    }

    // Get next position within category
    const maxPos = this.ctx.db.prepare(`
      SELECT MAX(position) as max FROM ${T.phases} WHERE category = ?
    `).get(phase.category) as { max: number | null }
    const position = phase.position ?? (maxPos.max !== null ? maxPos.max + 1 : 0)

    const id = phase.id || slugify(phase.name)
    const now = new Date().toISOString()

    // If setting as default, unset other defaults first
    if (phase.isDefault) {
      this.ctx.db.prepare(`UPDATE ${T.phases} SET is_default = 0`).run()
    }

    this.ctx.db.prepare(`
      INSERT INTO ${T.phases} (id, name, category, position, color, description, is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      phase.name,
      phase.category,
      position,
      phase.color || null,
      phase.description || null,
      phase.isDefault ? 1 : 0,
      now
    )

    return (await this.getPhase(id))!
  }

  /**
   * Update a phase.
   */
  async updatePhase(id: string, changes: Partial<ProjectPhase>): Promise<ProjectPhase> {
    const existing = await this.getPhase(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Phase not found: ${id}`)
    }

    if (
      changes.category &&
      !STATE_CATEGORY_ORDER.includes(changes.category)
    ) {
      throw new PMOError(
        'INVALID',
        `Invalid category: ${changes.category}. Must be one of: ${STATE_CATEGORY_ORDER.join(', ')}`
      )
    }

    // Check for duplicate name if name is changing
    if (
      changes.name &&
      changes.name.toLowerCase() !== existing.name.toLowerCase()
    ) {
      const dup = this.ctx.db.prepare(`
        SELECT id FROM ${T.phases} WHERE LOWER(name) = LOWER(?) AND id != ?
      `).get(changes.name, id)
      if (dup) {
        throw new PMOError('CONFLICT', `Phase "${changes.name}" already exists`)
      }
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.category !== undefined) {
      updates.push('category = ?')
      params.push(changes.category)
    }
    if (changes.position !== undefined) {
      updates.push('position = ?')
      params.push(changes.position)
    }
    if (changes.color !== undefined) {
      updates.push('color = ?')
      params.push(changes.color || null)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description || null)
    }
    if (changes.isDefault !== undefined) {
      updates.push('is_default = ?')
      params.push(changes.isDefault ? 1 : 0)

      if (changes.isDefault) {
        this.ctx.db.prepare(`UPDATE ${T.phases} SET is_default = 0 WHERE id != ?`).run(id)
      }
    }

    if (updates.length > 0) {
      params.push(id)
      this.ctx.db.prepare(`UPDATE ${T.phases} SET ${updates.join(', ')} WHERE id = ?`).run(
        ...params
      )
    }

    return (await this.getPhase(id))!
  }

  /**
   * Delete a phase.
   */
  async deletePhase(id: string): Promise<void> {
    const existing = await this.getPhase(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Phase not found: ${id}`)
    }

    // Check if any projects use this phase
    const projectCount = this.ctx.db.prepare(`
      SELECT COUNT(*) as count FROM ${T.projects} WHERE phase_id = ?
    `).get(id) as { count: number }
    if (projectCount.count > 0) {
      throw new PMOError(
        'CONFLICT',
        `Cannot delete phase "${existing.name}" - ${projectCount.count} project(s) are using it`
      )
    }

    this.ctx.db.prepare(`DELETE FROM ${T.phases} WHERE id = ?`).run(id)
  }

  /**
   * Reorder a phase to a new position.
   */
  async reorderPhase(id: string, newPosition: number): Promise<ProjectPhase> {
    const phase = await this.getPhase(id)
    if (!phase) {
      throw new PMOError('NOT_FOUND', `Phase not found: ${id}`)
    }

    const oldPosition = phase.position

    if (newPosition === oldPosition) {
      return phase
    }

    if (newPosition < oldPosition) {
      this.ctx.db.prepare(`
        UPDATE ${T.phases}
        SET position = position + 1
        WHERE category = ? AND position >= ? AND position < ? AND id != ?
      `).run(phase.category, newPosition, oldPosition, id)
    } else {
      this.ctx.db.prepare(`
        UPDATE ${T.phases}
        SET position = position - 1
        WHERE category = ? AND position > ? AND position <= ? AND id != ?
      `).run(phase.category, oldPosition, newPosition, id)
    }

    this.ctx.db.prepare(`UPDATE ${T.phases} SET position = ? WHERE id = ?`).run(
      newPosition,
      id
    )

    return (await this.getPhase(id))!
  }

  /**
   * Get the default phase.
   */
  async getDefaultPhase(): Promise<ProjectPhase | null> {
    const row = this.ctx.db.prepare(`SELECT * FROM ${T.phases} WHERE is_default = 1`).get() as
      | PhaseRow
      | undefined

    if (!row) {
      // Fallback to first phase
      const firstRow = this.ctx.db.prepare(`
        SELECT * FROM ${T.phases}
        ORDER BY
          CASE category WHEN 'backlog' THEN 0 WHEN 'unstarted' THEN 1 WHEN 'started' THEN 2 WHEN 'completed' THEN 3 WHEN 'canceled' THEN 4 END,
          position
        LIMIT 1
      `).get() as PhaseRow | undefined
      if (!firstRow) return null
      return this.rowToPhase(firstRow)
    }

    return this.rowToPhase(row)
  }

  // =========================================================================
  // Phase Templates
  // =========================================================================

  /**
   * List phase templates.
   */
  async listPhaseTemplates(filter?: PhaseTemplateFilter): Promise<PhaseTemplate[]> {
    let query = `SELECT * FROM ${T.phase_templates} WHERE 1=1`
    const params: unknown[] = []

    if (filter?.isBuiltin !== undefined) {
      query += ' AND is_builtin = ?'
      params.push(filter.isBuiltin ? 1 : 0)
    }
    if (filter?.search) {
      query += ' AND (name LIKE ? OR description LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }

    query += ' ORDER BY is_builtin DESC, name'

    const rows = this.ctx.db.prepare(query).all(...params) as PhaseTemplateRow[]

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      isBuiltin: row.is_builtin === 1,
      phases: JSON.parse(row.phases) as PhaseTemplatePhase[],
      createdAt: new Date(row.created_at),
    }))
  }

  /**
   * Get a phase template by ID.
   */
  async getPhaseTemplate(id: string): Promise<PhaseTemplate | null> {
    const row = this.ctx.db.prepare(`
      SELECT * FROM ${T.phase_templates} WHERE id = ?
    `).get(id) as PhaseTemplateRow | undefined

    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      isBuiltin: row.is_builtin === 1,
      phases: JSON.parse(row.phases) as PhaseTemplatePhase[],
      createdAt: new Date(row.created_at),
    }
  }

  /**
   * Apply a phase template.
   */
  async applyPhaseTemplate(templateId: string): Promise<ProjectPhase[]> {
    const template = await this.getPhaseTemplate(templateId)
    if (!template) {
      throw new PMOError('NOT_FOUND', `Phase template not found: ${templateId}`)
    }

    // Delete existing phases
    this.ctx.db.prepare(`DELETE FROM ${T.phases}`).run()

    // Create new phases from template
    const now = new Date().toISOString()
    const insertPhase = this.ctx.db.prepare(`
      INSERT INTO ${T.phases} (id, name, category, position, description, is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const createdPhases: ProjectPhase[] = []

    for (const templatePhase of template.phases) {
      const id = slugify(templatePhase.name)

      insertPhase.run(
        id,
        templatePhase.name,
        templatePhase.category,
        templatePhase.position,
        templatePhase.description || null,
        templatePhase.isDefault ? 1 : 0,
        now
      )

      createdPhases.push({
        id,
        name: templatePhase.name,
        category: templatePhase.category,
        position: templatePhase.position,
        description: templatePhase.description,
        isDefault: templatePhase.isDefault || false,
        createdAt: new Date(now),
      })
    }

    return createdPhases
  }

  /**
   * Save current phases as a template.
   */
  async savePhaseTemplate(name: string, description?: string): Promise<PhaseTemplate> {
    // Get current phases
    const phases = await this.listPhases()
    if (phases.length === 0) {
      throw new PMOError('INVALID', 'No phases to save as template')
    }

    // Check for duplicate name
    const existing = this.ctx.db.prepare(`
      SELECT id FROM ${T.phase_templates} WHERE LOWER(name) = LOWER(?)
    `).get(name) as { id: string } | undefined
    if (existing) {
      throw new PMOError('CONFLICT', `Phase template "${name}" already exists`)
    }

    const id = slugify(name)
    const now = new Date().toISOString()

    // Convert phases to template format
    const templatePhases: PhaseTemplatePhase[] = phases.map((p) => ({
      name: p.name,
      category: p.category,
      position: p.position,
      description: p.description,
      isDefault: p.isDefault,
    }))

    this.ctx.db.prepare(`
      INSERT INTO ${T.phase_templates} (id, name, description, is_builtin, phases, created_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(id, name, description || null, JSON.stringify(templatePhases), now)

    return {
      id,
      name,
      description,
      isBuiltin: false,
      phases: templatePhases,
      createdAt: new Date(now),
    }
  }

  /**
   * Update a phase template.
   */
  async updatePhaseTemplate(
    id: string,
    changes: { name?: string; description?: string }
  ): Promise<PhaseTemplate> {
    const existing = await this.getPhaseTemplate(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Phase template not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot modify built-in templates')
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      const dup = this.ctx.db.prepare(`
        SELECT id FROM ${T.phase_templates}
        WHERE LOWER(name) = LOWER(?) AND id != ?
      `).get(changes.name, id)
      if (dup) {
        throw new PMOError('CONFLICT', `Phase template "${changes.name}" already exists`)
      }
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description || null)
    }

    if (updates.length > 0) {
      params.push(id)
      this.ctx.db.prepare(`UPDATE ${T.phase_templates} SET ${updates.join(', ')} WHERE id = ?`).run(
        ...params
      )
    }

    return (await this.getPhaseTemplate(id))!
  }

  /**
   * Delete a phase template.
   */
  async deletePhaseTemplate(id: string): Promise<void> {
    const existing = await this.getPhaseTemplate(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Phase template not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot delete built-in templates')
    }

    this.ctx.db.prepare(`DELETE FROM ${T.phase_templates} WHERE id = ?`).run(id)
  }

  private rowToPhase(row: PhaseRow): ProjectPhase {
    return {
      id: row.id,
      name: row.name,
      category: row.category as StateCategory,
      position: row.position,
      color: row.color || undefined,
      description: row.description || undefined,
      isDefault: row.is_default === 1,
      createdAt: new Date(row.created_at),
    }
  }
}
