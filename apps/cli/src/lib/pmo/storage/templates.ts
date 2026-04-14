/**
 * Ticket template operations.
 *
 * Note: Workflow templates have been removed. Workflows are now used directly
 * as the source of truth for status configurations. See workflow commands
 * and StatusStorage for workflow operations.
 */

import { eq, and, like, or, asc, desc, sql } from 'drizzle-orm'
import { pmoTicketTemplates } from '../../database/drizzle-schema.js'
import {
  PMOError,
  TicketTemplate,
  TicketTemplateFilter,
} from '../types.js'
import { slugify } from '../../utils/text.js'
import type { StorageContext } from './types.js'

export class TemplateStorage {
  constructor(private ctx: StorageContext) {}

  // =========================================================================
  // Ticket Templates
  // =========================================================================

  /**
   * List ticket templates.
   */
  async listTicketTemplates(filter?: TicketTemplateFilter): Promise<TicketTemplate[]> {
    const conditions = []

    if (filter?.isBuiltin !== undefined) {
      conditions.push(eq(pmoTicketTemplates.isBuiltin, filter.isBuiltin))
    }
    if (filter?.search) {
      const searchPattern = `%${filter.search}%`
      conditions.push(
        or(
          like(pmoTicketTemplates.name, searchPattern),
          like(pmoTicketTemplates.description, searchPattern)
        )
      )
    }

    const rows = this.ctx.drizzle
      .select()
      .from(pmoTicketTemplates)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(pmoTicketTemplates.isBuiltin), asc(pmoTicketTemplates.name))
      .all()

    return rows.map((row) => this.rowToTicketTemplate(row))
  }

  /**
   * Get a ticket template by ID.
   */
  async getTicketTemplate(id: string): Promise<TicketTemplate | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoTicketTemplates)
      .where(eq(pmoTicketTemplates.id, id))
      .get()

    if (!row) return null

    return this.rowToTicketTemplate(row)
  }

  /**
   * Create a new ticket template.
   */
  async createTicketTemplate(
    template: Partial<TicketTemplate> & { name: string }
  ): Promise<TicketTemplate> {
    // Check for duplicate name
    const existing = this.ctx.drizzle
      .select({ id: pmoTicketTemplates.id })
      .from(pmoTicketTemplates)
      .where(sql`LOWER(${pmoTicketTemplates.name}) = LOWER(${template.name})`)
      .get()
    if (existing) {
      throw new PMOError('CONFLICT', `Template "${template.name}" already exists`)
    }

    const id = template.id || slugify(template.name)
    const now = new Date().toISOString()

    this.ctx.drizzle
      .insert(pmoTicketTemplates)
      .values({
        id,
        name: template.name,
        description: template.description || null,
        isBuiltin: false,
        titlePattern: template.titlePattern || null,
        descriptionTemplate: template.descriptionTemplate || null,
        defaultPriority: template.defaultPriority || null,
        defaultCategory: template.defaultCategory || null,
        defaultStatusId: template.defaultStatusId || null,
        defaultAssignee: template.defaultAssignee || null,
        defaultOwner: template.defaultOwner || null,
        defaultLabels: JSON.stringify(template.defaultLabels || []),
        suggestedSubtasks: JSON.stringify(template.suggestedSubtasks || []),
        createdAt: now,
      })
      .run()

    return (await this.getTicketTemplate(id))!
  }

  /**
   * Update a ticket template.
   */
  async updateTicketTemplate(
    id: string,
    changes: Partial<TicketTemplate>
  ): Promise<TicketTemplate> {
    const existing = await this.getTicketTemplate(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Template not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot modify built-in templates')
    }

    const updateValues: Record<string, unknown> = {}

    if (changes.name !== undefined) {
      // Check for duplicate
      const dup = this.ctx.drizzle
        .select({ id: pmoTicketTemplates.id })
        .from(pmoTicketTemplates)
        .where(and(
          sql`LOWER(${pmoTicketTemplates.name}) = LOWER(${changes.name})`,
          sql`${pmoTicketTemplates.id} != ${id}`
        ))
        .get()
      if (dup) {
        throw new PMOError('CONFLICT', `Template "${changes.name}" already exists`)
      }
      updateValues.name = changes.name
    }
    if (changes.description !== undefined) updateValues.description = changes.description || null
    if (changes.titlePattern !== undefined) updateValues.titlePattern = changes.titlePattern || null
    if (changes.descriptionTemplate !== undefined) updateValues.descriptionTemplate = changes.descriptionTemplate || null
    if (changes.defaultPriority !== undefined) updateValues.defaultPriority = changes.defaultPriority || null
    if (changes.defaultCategory !== undefined) updateValues.defaultCategory = changes.defaultCategory || null
    if (changes.defaultStatusId !== undefined) updateValues.defaultStatusId = changes.defaultStatusId || null
    if (changes.defaultAssignee !== undefined) updateValues.defaultAssignee = changes.defaultAssignee || null
    if (changes.defaultOwner !== undefined) updateValues.defaultOwner = changes.defaultOwner || null
    if (changes.defaultLabels !== undefined) updateValues.defaultLabels = JSON.stringify(changes.defaultLabels)
    if (changes.suggestedSubtasks !== undefined) updateValues.suggestedSubtasks = JSON.stringify(changes.suggestedSubtasks)

    if (Object.keys(updateValues).length > 0) {
      this.ctx.drizzle
        .update(pmoTicketTemplates)
        .set(updateValues)
        .where(eq(pmoTicketTemplates.id, id))
        .run()
    }

    return (await this.getTicketTemplate(id))!
  }

  /**
   * Delete a ticket template.
   */
  async deleteTicketTemplate(id: string): Promise<void> {
    const existing = await this.getTicketTemplate(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Template not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot delete built-in templates')
    }

    this.ctx.drizzle
      .delete(pmoTicketTemplates)
      .where(eq(pmoTicketTemplates.id, id))
      .run()
  }

  private rowToTicketTemplate(row: typeof pmoTicketTemplates.$inferSelect): TicketTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      isBuiltin: row.isBuiltin === true,
      titlePattern: row.titlePattern || undefined,
      descriptionTemplate: row.descriptionTemplate || undefined,
      defaultPriority: row.defaultPriority || undefined,
      defaultCategory: row.defaultCategory || undefined,
      defaultStatusId: row.defaultStatusId || undefined,
      defaultAssignee: row.defaultAssignee || undefined,
      defaultOwner: row.defaultOwner || undefined,
      defaultLabels: row.defaultLabels ? JSON.parse(row.defaultLabels) : [],
      suggestedSubtasks: row.suggestedSubtasks
        ? JSON.parse(row.suggestedSubtasks)
        : [],
      createdAt: new Date(row.createdAt!),
    }
  }
}
