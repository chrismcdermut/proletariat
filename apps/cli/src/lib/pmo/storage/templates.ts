/**
 * Ticket template operations.
 *
 * Note: Workflow templates have been removed. Workflows are now used directly
 * as the source of truth for status configurations. See workflow commands
 * and StatusStorage for workflow operations.
 *
 * This module uses Drizzle ORM for type-safe database queries.
 */

import { eq, and, like, or, asc, sql } from 'drizzle-orm'
import {
  pmoTicketTemplates,
  pmoTickets,
  pmoSubtasks,
} from '../../database/drizzle-schema.js'
import {
  PMOError,
  TicketTemplate,
  TicketTemplateFilter,
} from '../types.js'
import { slugify } from '../utils.js'
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
    let query = this.ctx.drizzle
      .select()
      .from(pmoTicketTemplates)
      .$dynamic()

    const conditions = []

    if (filter?.isBuiltin !== undefined) {
      conditions.push(eq(pmoTicketTemplates.isBuiltin, filter.isBuiltin))
    }
    if (filter?.search) {
      conditions.push(
        or(
          like(pmoTicketTemplates.name, `%${filter.search}%`),
          like(pmoTicketTemplates.description, `%${filter.search}%`)
        )
      )
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions))
    }

    const rows = query
      .orderBy(sql`${pmoTicketTemplates.isBuiltin} DESC`, asc(pmoTicketTemplates.name))
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

    this.ctx.drizzle.insert(pmoTicketTemplates).values({
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
    }).run()

    return (await this.getTicketTemplate(id))!
  }

  /**
   * Create a ticket template from an existing ticket.
   */
  async createTicketTemplateFromTicket(
    ticketId: string,
    name: string,
    description?: string
  ): Promise<TicketTemplate> {
    // Get the ticket
    const ticket = this.ctx.drizzle
      .select()
      .from(pmoTickets)
      .where(eq(pmoTickets.id, ticketId))
      .get()

    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    // Get subtasks
    const subtasks = this.ctx.drizzle
      .select({ title: pmoSubtasks.title })
      .from(pmoSubtasks)
      .where(eq(pmoSubtasks.ticketId, ticketId))
      .orderBy(asc(pmoSubtasks.position))
      .all()

    // Create template from ticket
    return this.createTicketTemplate({
      name,
      description,
      descriptionTemplate: ticket.description || undefined,
      defaultPriority: ticket.priority || undefined,
      defaultCategory: ticket.category || undefined,
      defaultStatusId: ticket.statusId || undefined,
      defaultOwner: ticket.owner || undefined,
      defaultAssignee: ticket.assignee || undefined,
      defaultLabels: ticket.labels ? JSON.parse(ticket.labels) : [],
      suggestedSubtasks: subtasks.map((st) => ({ title: st.title })),
    })
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

    const updates: Partial<typeof pmoTicketTemplates.$inferInsert> = {}

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
      updates.name = changes.name
    }
    if (changes.description !== undefined) {
      updates.description = changes.description || null
    }
    if (changes.titlePattern !== undefined) {
      updates.titlePattern = changes.titlePattern || null
    }
    if (changes.descriptionTemplate !== undefined) {
      updates.descriptionTemplate = changes.descriptionTemplate || null
    }
    if (changes.defaultPriority !== undefined) {
      updates.defaultPriority = changes.defaultPriority || null
    }
    if (changes.defaultCategory !== undefined) {
      updates.defaultCategory = changes.defaultCategory || null
    }
    if (changes.defaultStatusId !== undefined) {
      updates.defaultStatusId = changes.defaultStatusId || null
    }
    if (changes.defaultAssignee !== undefined) {
      updates.defaultAssignee = changes.defaultAssignee || null
    }
    if (changes.defaultOwner !== undefined) {
      updates.defaultOwner = changes.defaultOwner || null
    }
    if (changes.defaultLabels !== undefined) {
      updates.defaultLabels = JSON.stringify(changes.defaultLabels)
    }
    if (changes.suggestedSubtasks !== undefined) {
      updates.suggestedSubtasks = JSON.stringify(changes.suggestedSubtasks)
    }

    if (Object.keys(updates).length > 0) {
      this.ctx.drizzle
        .update(pmoTicketTemplates)
        .set(updates)
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

  private rowToTicketTemplate(row: {
    id: string
    name: string
    description: string | null
    isBuiltin: boolean | null
    titlePattern: string | null
    descriptionTemplate: string | null
    defaultPriority: string | null
    defaultCategory: string | null
    defaultStatusId: string | null
    defaultAssignee: string | null
    defaultOwner: string | null
    defaultLabels: string
    suggestedSubtasks: string
    createdAt: string | null
  }): TicketTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      isBuiltin: row.isBuiltin ?? false,
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
      createdAt: new Date(row.createdAt || Date.now()),
    }
  }
}
