/**
 * Ticket template operations.
 *
 * Note: Workflow templates have been removed. Workflows are now used directly
 * as the source of truth for status configurations. See workflow commands
 * and StatusStorage for workflow operations.
 */

import { PMO_TABLES } from '../schema.js'
import {
  PMOError,
  TicketTemplate,
  TicketTemplateFilter,
} from '../types.js'
import { slugify } from '../utils.js'
import type { StorageContext, TicketTemplateRow } from './types.js'

const T = PMO_TABLES

export class TemplateStorage {
  constructor(private ctx: StorageContext) {}

  // =========================================================================
  // Ticket Templates
  // =========================================================================

  /**
   * List ticket templates.
   */
  async listTicketTemplates(filter?: TicketTemplateFilter): Promise<TicketTemplate[]> {
    let query = `SELECT * FROM ${T.ticket_templates}`
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter?.isBuiltin !== undefined) {
      conditions.push('is_builtin = ?')
      params.push(filter.isBuiltin ? 1 : 0)
    }
    if (filter?.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      const searchPattern = `%${filter.search}%`
      params.push(searchPattern, searchPattern)
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }
    query += ' ORDER BY is_builtin DESC, name ASC'

    const rows = this.ctx.db.prepare(query).all(...params) as TicketTemplateRow[]

    return rows.map((row) => this.rowToTicketTemplate(row))
  }

  /**
   * Get a ticket template by ID.
   */
  async getTicketTemplate(id: string): Promise<TicketTemplate | null> {
    const row = this.ctx.db.prepare(`
      SELECT * FROM ${T.ticket_templates} WHERE id = ?
    `).get(id) as TicketTemplateRow | undefined

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
    const existing = this.ctx.db.prepare(`
      SELECT id FROM ${T.ticket_templates} WHERE LOWER(name) = LOWER(?)
    `).get(template.name) as { id: string } | undefined
    if (existing) {
      throw new PMOError('CONFLICT', `Template "${template.name}" already exists`)
    }

    const id = template.id || slugify(template.name)
    const now = new Date().toISOString()

    this.ctx.db.prepare(`
      INSERT INTO ${T.ticket_templates} (
        id, name, description, is_builtin, title_pattern, description_template,
        default_priority, default_category, default_status_id, default_assignee,
        default_owner, default_labels, suggested_subtasks, created_at
      )
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      template.name,
      template.description || null,
      template.titlePattern || null,
      template.descriptionTemplate || null,
      template.defaultPriority || null,
      template.defaultCategory || null,
      template.defaultStatusId || null,
      template.defaultAssignee || null,
      template.defaultOwner || null,
      JSON.stringify(template.defaultLabels || []),
      JSON.stringify(template.suggestedSubtasks || []),
      now
    )

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
    const ticket = this.ctx.db.prepare(`
      SELECT * FROM ${T.tickets} WHERE id = ?
    `).get(ticketId) as {
      title: string
      description: string | null
      priority: string | null
      category: string | null
      status_id: string | null
      owner: string | null
      assignee: string | null
      labels: string | null
    } | undefined

    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    // Get subtasks
    const subtasks = this.ctx.db.prepare(`
      SELECT title FROM ${T.subtasks} WHERE ticket_id = ? ORDER BY position
    `).all(ticketId) as Array<{ title: string }>

    // Create template from ticket
    return this.createTicketTemplate({
      name,
      description,
      descriptionTemplate: ticket.description || undefined,
      defaultPriority: ticket.priority || undefined,
      defaultCategory: ticket.category || undefined,
      defaultStatusId: ticket.status_id || undefined,
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

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      // Check for duplicate
      const dup = this.ctx.db.prepare(`
        SELECT id FROM ${T.ticket_templates}
        WHERE LOWER(name) = LOWER(?) AND id != ?
      `).get(changes.name, id)
      if (dup) {
        throw new PMOError('CONFLICT', `Template "${changes.name}" already exists`)
      }
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description || null)
    }
    if (changes.titlePattern !== undefined) {
      updates.push('title_pattern = ?')
      params.push(changes.titlePattern || null)
    }
    if (changes.descriptionTemplate !== undefined) {
      updates.push('description_template = ?')
      params.push(changes.descriptionTemplate || null)
    }
    if (changes.defaultPriority !== undefined) {
      updates.push('default_priority = ?')
      params.push(changes.defaultPriority || null)
    }
    if (changes.defaultCategory !== undefined) {
      updates.push('default_category = ?')
      params.push(changes.defaultCategory || null)
    }
    if (changes.defaultStatusId !== undefined) {
      updates.push('default_status_id = ?')
      params.push(changes.defaultStatusId || null)
    }
    if (changes.defaultAssignee !== undefined) {
      updates.push('default_assignee = ?')
      params.push(changes.defaultAssignee || null)
    }
    if (changes.defaultOwner !== undefined) {
      updates.push('default_owner = ?')
      params.push(changes.defaultOwner || null)
    }
    if (changes.defaultLabels !== undefined) {
      updates.push('default_labels = ?')
      params.push(JSON.stringify(changes.defaultLabels))
    }
    if (changes.suggestedSubtasks !== undefined) {
      updates.push('suggested_subtasks = ?')
      params.push(JSON.stringify(changes.suggestedSubtasks))
    }

    if (updates.length > 0) {
      params.push(id)
      this.ctx.db.prepare(`UPDATE ${T.ticket_templates} SET ${updates.join(', ')} WHERE id = ?`).run(
        ...params
      )
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

    this.ctx.db.prepare(`DELETE FROM ${T.ticket_templates} WHERE id = ?`).run(id)
  }

  private rowToTicketTemplate(row: TicketTemplateRow): TicketTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      isBuiltin: row.is_builtin === 1,
      titlePattern: row.default_title || undefined,
      descriptionTemplate: row.default_description || undefined,
      defaultPriority: row.default_priority || undefined,
      defaultCategory: row.default_category || undefined,
      defaultStatusId: row.default_status_id || undefined,
      defaultAssignee: row.default_assignee || undefined,
      defaultOwner: row.default_owner || undefined,
      defaultLabels: row.default_labels ? JSON.parse(row.default_labels) : [],
      suggestedSubtasks: row.suggested_subtasks
        ? JSON.parse(row.suggested_subtasks)
        : [],
      createdAt: new Date(row.created_at),
    }
  }
}
