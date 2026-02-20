/**
 * Project phase operations.
 *
 * This module uses Drizzle ORM for type-safe database queries.
 */

import { eq, and, like, or, asc, sql } from 'drizzle-orm'
import {
  pmoPhases,
  pmoPhaseTemplates,
  pmoProjects,
} from '../../database/drizzle-schema.js'
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
import { StorageContext } from './types.js'

export class PhaseStorage {
  constructor(private ctx: StorageContext) {}

  // =========================================================================
  // Project Phases
  // =========================================================================

  /**
   * List project phases.
   */
  async listPhases(filter?: PhaseFilter): Promise<ProjectPhase[]> {
    let query = this.ctx.drizzle
      .select()
      .from(pmoPhases)
      .$dynamic()

    const conditions = []

    if (filter?.category) {
      conditions.push(eq(pmoPhases.category, filter.category))
    }

    if (filter?.search) {
      conditions.push(
        or(
          like(pmoPhases.name, `%${filter.search}%`),
          like(pmoPhases.description, `%${filter.search}%`)
        )
      )
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions))
    }

    const rows = query
      .orderBy(
        sql`CASE ${pmoPhases.category}
          WHEN 'backlog' THEN 0
          WHEN 'unstarted' THEN 1
          WHEN 'started' THEN 2
          WHEN 'completed' THEN 3
          WHEN 'canceled' THEN 4
        END`,
        asc(pmoPhases.position)
      )
      .all()

    return rows.map((row) => this.rowToPhase(row))
  }

  /**
   * Get a phase by ID.
   */
  async getPhase(id: string): Promise<ProjectPhase | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoPhases)
      .where(eq(pmoPhases.id, id))
      .get()

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
    const existing = this.ctx.drizzle
      .select({ id: pmoPhases.id })
      .from(pmoPhases)
      .where(sql`LOWER(${pmoPhases.name}) = LOWER(${phase.name})`)
      .get()
    if (existing) {
      throw new PMOError('CONFLICT', `Phase "${phase.name}" already exists`)
    }

    // Get next position within category
    const maxPos = this.ctx.drizzle
      .select({ max: sql<number | null>`MAX(${pmoPhases.position})` })
      .from(pmoPhases)
      .where(eq(pmoPhases.category, phase.category))
      .get()
    const position = phase.position ?? (maxPos?.max !== null ? (maxPos?.max ?? -1) + 1 : 0)

    const id = phase.id || slugify(phase.name)
    const now = new Date().toISOString()

    // If setting as default, unset other defaults first
    if (phase.isDefault) {
      this.ctx.drizzle
        .update(pmoPhases)
        .set({ isDefault: false })
        .run()
    }

    this.ctx.drizzle.insert(pmoPhases).values({
      id,
      name: phase.name,
      category: phase.category,
      position,
      color: phase.color || null,
      description: phase.description || null,
      isDefault: phase.isDefault || false,
      createdAt: now,
    }).run()

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
      const dup = this.ctx.drizzle
        .select({ id: pmoPhases.id })
        .from(pmoPhases)
        .where(and(
          sql`LOWER(${pmoPhases.name}) = LOWER(${changes.name})`,
          sql`${pmoPhases.id} != ${id}`
        ))
        .get()
      if (dup) {
        throw new PMOError('CONFLICT', `Phase "${changes.name}" already exists`)
      }
    }

    const updates: Partial<typeof pmoPhases.$inferInsert> = {}

    if (changes.name !== undefined) {
      updates.name = changes.name
    }
    if (changes.category !== undefined) {
      updates.category = changes.category
    }
    if (changes.position !== undefined) {
      updates.position = changes.position
    }
    if (changes.color !== undefined) {
      updates.color = changes.color || null
    }
    if (changes.description !== undefined) {
      updates.description = changes.description || null
    }
    if (changes.isDefault !== undefined) {
      updates.isDefault = changes.isDefault

      if (changes.isDefault) {
        this.ctx.drizzle
          .update(pmoPhases)
          .set({ isDefault: false })
          .where(sql`${pmoPhases.id} != ${id}`)
          .run()
      }
    }

    if (Object.keys(updates).length > 0) {
      this.ctx.drizzle
        .update(pmoPhases)
        .set(updates)
        .where(eq(pmoPhases.id, id))
        .run()
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
    const projectCount = this.ctx.drizzle
      .select({ count: sql<number>`COUNT(*)` })
      .from(pmoProjects)
      .where(eq(pmoProjects.phaseId, id))
      .get()
    if (projectCount && projectCount.count > 0) {
      throw new PMOError(
        'CONFLICT',
        `Cannot delete phase "${existing.name}" - ${projectCount.count} project(s) are using it`
      )
    }

    this.ctx.drizzle
      .delete(pmoPhases)
      .where(eq(pmoPhases.id, id))
      .run()
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
      this.ctx.drizzle
        .update(pmoPhases)
        .set({ position: sql`${pmoPhases.position} + 1` })
        .where(and(
          eq(pmoPhases.category, phase.category),
          sql`${pmoPhases.position} >= ${newPosition}`,
          sql`${pmoPhases.position} < ${oldPosition}`,
          sql`${pmoPhases.id} != ${id}`
        ))
        .run()
    } else {
      this.ctx.drizzle
        .update(pmoPhases)
        .set({ position: sql`${pmoPhases.position} - 1` })
        .where(and(
          eq(pmoPhases.category, phase.category),
          sql`${pmoPhases.position} > ${oldPosition}`,
          sql`${pmoPhases.position} <= ${newPosition}`,
          sql`${pmoPhases.id} != ${id}`
        ))
        .run()
    }

    this.ctx.drizzle
      .update(pmoPhases)
      .set({ position: newPosition })
      .where(eq(pmoPhases.id, id))
      .run()

    return (await this.getPhase(id))!
  }

  /**
   * Get the default phase.
   */
  async getDefaultPhase(): Promise<ProjectPhase | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoPhases)
      .where(eq(pmoPhases.isDefault, true))
      .get()

    if (!row) {
      // Fallback to first phase
      const firstRow = this.ctx.drizzle
        .select()
        .from(pmoPhases)
        .orderBy(
          sql`CASE ${pmoPhases.category} WHEN 'backlog' THEN 0 WHEN 'unstarted' THEN 1 WHEN 'started' THEN 2 WHEN 'completed' THEN 3 WHEN 'canceled' THEN 4 END`,
          asc(pmoPhases.position)
        )
        .limit(1)
        .get()
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
    let query = this.ctx.drizzle
      .select()
      .from(pmoPhaseTemplates)
      .$dynamic()

    const conditions = []

    if (filter?.isBuiltin !== undefined) {
      conditions.push(eq(pmoPhaseTemplates.isBuiltin, filter.isBuiltin))
    }
    if (filter?.search) {
      conditions.push(
        or(
          like(pmoPhaseTemplates.name, `%${filter.search}%`),
          like(pmoPhaseTemplates.description, `%${filter.search}%`)
        )
      )
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions))
    }

    const rows = query
      .orderBy(sql`${pmoPhaseTemplates.isBuiltin} DESC`, asc(pmoPhaseTemplates.name))
      .all()

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      isBuiltin: row.isBuiltin ?? false,
      phases: JSON.parse(row.phases) as PhaseTemplatePhase[],
      createdAt: new Date(row.createdAt || Date.now()),
    }))
  }

  /**
   * Get a phase template by ID.
   */
  async getPhaseTemplate(id: string): Promise<PhaseTemplate | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoPhaseTemplates)
      .where(eq(pmoPhaseTemplates.id, id))
      .get()

    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      isBuiltin: row.isBuiltin ?? false,
      phases: JSON.parse(row.phases) as PhaseTemplatePhase[],
      createdAt: new Date(row.createdAt || Date.now()),
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
    this.ctx.drizzle
      .delete(pmoPhases)
      .run()

    // Create new phases from template
    const now = new Date().toISOString()
    const createdPhases: ProjectPhase[] = []

    for (const templatePhase of template.phases) {
      const id = slugify(templatePhase.name)

      this.ctx.drizzle.insert(pmoPhases).values({
        id,
        name: templatePhase.name,
        category: templatePhase.category,
        position: templatePhase.position,
        description: templatePhase.description || null,
        isDefault: templatePhase.isDefault || false,
        createdAt: now,
      }).run()

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
    const existing = this.ctx.drizzle
      .select({ id: pmoPhaseTemplates.id })
      .from(pmoPhaseTemplates)
      .where(sql`LOWER(${pmoPhaseTemplates.name}) = LOWER(${name})`)
      .get()
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

    this.ctx.drizzle.insert(pmoPhaseTemplates).values({
      id,
      name,
      description: description || null,
      isBuiltin: false,
      phases: JSON.stringify(templatePhases),
      createdAt: now,
    }).run()

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

    const updates: Partial<typeof pmoPhaseTemplates.$inferInsert> = {}

    if (changes.name !== undefined) {
      const dup = this.ctx.drizzle
        .select({ id: pmoPhaseTemplates.id })
        .from(pmoPhaseTemplates)
        .where(and(
          sql`LOWER(${pmoPhaseTemplates.name}) = LOWER(${changes.name})`,
          sql`${pmoPhaseTemplates.id} != ${id}`
        ))
        .get()
      if (dup) {
        throw new PMOError('CONFLICT', `Phase template "${changes.name}" already exists`)
      }
      updates.name = changes.name
    }
    if (changes.description !== undefined) {
      updates.description = changes.description || null
    }

    if (Object.keys(updates).length > 0) {
      this.ctx.drizzle
        .update(pmoPhaseTemplates)
        .set(updates)
        .where(eq(pmoPhaseTemplates.id, id))
        .run()
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

    this.ctx.drizzle
      .delete(pmoPhaseTemplates)
      .where(eq(pmoPhaseTemplates.id, id))
      .run()
  }

  private rowToPhase(row: {
    id: string
    name: string
    category: string
    position: number
    color: string | null
    description: string | null
    isDefault: boolean | null
    createdAt: string | null
  }): ProjectPhase {
    return {
      id: row.id,
      name: row.name,
      category: row.category as StateCategory,
      position: row.position,
      color: row.color || undefined,
      description: row.description || undefined,
      isDefault: row.isDefault ?? false,
      createdAt: new Date(row.createdAt || Date.now()),
    }
  }
}
