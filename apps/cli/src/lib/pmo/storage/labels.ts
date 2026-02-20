/**
 * Label storage operations for PMO.
 * Handles CRUD for labels, label groups, and ticket-label associations.
 * Enforces group exclusivity constraints.
 *
 * This module uses Drizzle ORM for type-safe database queries.
 */

import { eq, and, like, or, asc, sql, isNull } from 'drizzle-orm'
import {
  pmoLabelGroups,
  pmoLabels,
  pmoTicketLabels,
  pmoTickets,
} from '../../database/drizzle-schema.js'
import { Label, LabelFilter, LabelGroup, LabelGroupFilter, PMOError } from '../types.js'
import { slugify } from '../utils.js'
import { StorageContext } from './types.js'

export class LabelStorage {
  constructor(private ctx: StorageContext) {}

  // ===========================================================================
  // Label Group Operations
  // ===========================================================================

  async listLabelGroups(filter?: LabelGroupFilter): Promise<LabelGroup[]> {
    let query = this.ctx.drizzle
      .select()
      .from(pmoLabelGroups)
      .$dynamic()

    const conditions = []

    if (filter?.search) {
      conditions.push(
        or(
          like(pmoLabelGroups.name, `%${filter.search}%`),
          like(pmoLabelGroups.description, `%${filter.search}%`)
        )
      )
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions))
    }

    const rows = query
      .orderBy(asc(pmoLabelGroups.position), asc(pmoLabelGroups.name))
      .all()

    return rows.map(rowToLabelGroup)
  }

  async getLabelGroup(id: string): Promise<LabelGroup | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoLabelGroups)
      .where(eq(pmoLabelGroups.id, id))
      .get()
    return row ? rowToLabelGroup(row) : null
  }

  async getLabelGroupByName(name: string): Promise<LabelGroup | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoLabelGroups)
      .where(sql`LOWER(${pmoLabelGroups.name}) = LOWER(${name})`)
      .get()
    return row ? rowToLabelGroup(row) : null
  }

  async createLabelGroup(group: Partial<LabelGroup> & { name: string }): Promise<LabelGroup> {
    const id = group.id || slugify(group.name)

    // Check for duplicate name
    const existing = await this.getLabelGroupByName(group.name)
    if (existing) {
      throw new PMOError('CONFLICT', `Label group "${group.name}" already exists`)
    }

    // Get next position
    const maxPos = this.ctx.drizzle
      .select({ maxPos: sql<number>`COALESCE(MAX(${pmoLabelGroups.position}), -1)` })
      .from(pmoLabelGroups)
      .get()

    const now = new Date().toISOString()
    this.ctx.drizzle.insert(pmoLabelGroups).values({
      id,
      name: group.name,
      description: group.description || null,
      isExclusive: group.isExclusive !== undefined ? group.isExclusive : true,
      isRequired: group.isRequired !== undefined ? group.isRequired : false,
      position: group.position ?? (maxPos?.maxPos ?? -1) + 1,
      createdAt: now,
    }).run()

    return (await this.getLabelGroup(id))!
  }

  async updateLabelGroup(id: string, changes: Partial<LabelGroup>): Promise<LabelGroup> {
    const existing = await this.getLabelGroup(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Label group not found: ${id}`)
    }

    const updates: Partial<typeof pmoLabelGroups.$inferInsert> = {}

    if (changes.name !== undefined) {
      updates.name = changes.name
    }
    if (changes.description !== undefined) {
      updates.description = changes.description
    }
    if (changes.isExclusive !== undefined) {
      updates.isExclusive = changes.isExclusive
    }
    if (changes.isRequired !== undefined) {
      updates.isRequired = changes.isRequired
    }
    if (changes.position !== undefined) {
      updates.position = changes.position
    }

    if (Object.keys(updates).length > 0) {
      this.ctx.drizzle
        .update(pmoLabelGroups)
        .set(updates)
        .where(eq(pmoLabelGroups.id, id))
        .run()
    }

    return (await this.getLabelGroup(id))!
  }

  async deleteLabelGroup(id: string): Promise<void> {
    const existing = await this.getLabelGroup(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Label group not found: ${id}`)
    }

    // Labels in this group will have group_id set to NULL (ON DELETE SET NULL)
    this.ctx.drizzle
      .delete(pmoLabelGroups)
      .where(eq(pmoLabelGroups.id, id))
      .run()
  }

  // ===========================================================================
  // Label Operations
  // ===========================================================================

  async listLabels(filter?: LabelFilter): Promise<Label[]> {
    let query = this.ctx.drizzle
      .select({
        id: pmoLabels.id,
        name: pmoLabels.name,
        color: pmoLabels.color,
        description: pmoLabels.description,
        groupId: pmoLabels.groupId,
        groupName: pmoLabelGroups.name,
        position: pmoLabels.position,
        isBuiltin: pmoLabels.isBuiltin,
        createdAt: pmoLabels.createdAt,
      })
      .from(pmoLabels)
      .leftJoin(pmoLabelGroups, eq(pmoLabels.groupId, pmoLabelGroups.id))
      .$dynamic()

    const conditions = []

    if (filter?.groupId) {
      conditions.push(eq(pmoLabels.groupId, filter.groupId))
    }
    if (filter?.search) {
      conditions.push(
        or(
          like(pmoLabels.name, `%${filter.search}%`),
          like(pmoLabels.description, `%${filter.search}%`)
        )
      )
    }
    if (filter?.isBuiltin !== undefined) {
      conditions.push(eq(pmoLabels.isBuiltin, filter.isBuiltin))
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions))
    }

    const rows = query
      .orderBy(asc(pmoLabelGroups.position), asc(pmoLabels.position), asc(pmoLabels.name))
      .all()

    return rows.map(rowToLabel)
  }

  async getLabel(id: string): Promise<Label | null> {
    const row = this.ctx.drizzle
      .select({
        id: pmoLabels.id,
        name: pmoLabels.name,
        color: pmoLabels.color,
        description: pmoLabels.description,
        groupId: pmoLabels.groupId,
        groupName: pmoLabelGroups.name,
        position: pmoLabels.position,
        isBuiltin: pmoLabels.isBuiltin,
        createdAt: pmoLabels.createdAt,
      })
      .from(pmoLabels)
      .leftJoin(pmoLabelGroups, eq(pmoLabels.groupId, pmoLabelGroups.id))
      .where(eq(pmoLabels.id, id))
      .get()
    return row ? rowToLabel(row) : null
  }

  async getLabelByName(name: string, groupId?: string): Promise<Label | null> {
    let query = this.ctx.drizzle
      .select({
        id: pmoLabels.id,
        name: pmoLabels.name,
        color: pmoLabels.color,
        description: pmoLabels.description,
        groupId: pmoLabels.groupId,
        groupName: pmoLabelGroups.name,
        position: pmoLabels.position,
        isBuiltin: pmoLabels.isBuiltin,
        createdAt: pmoLabels.createdAt,
      })
      .from(pmoLabels)
      .leftJoin(pmoLabelGroups, eq(pmoLabels.groupId, pmoLabelGroups.id))
      .$dynamic()

    const conditions = [
      sql`LOWER(${pmoLabels.name}) = LOWER(${name})`
    ]

    if (groupId) {
      conditions.push(eq(pmoLabels.groupId, groupId))
    }

    const row = query
      .where(and(...conditions))
      .get()
    return row ? rowToLabel(row) : null
  }

  async createLabel(label: Partial<Label> & { name: string }): Promise<Label> {
    const id = label.id || slugify(label.name)

    // Validate group if provided
    if (label.groupId) {
      const group = await this.getLabelGroup(label.groupId)
      if (!group) {
        throw new PMOError('NOT_FOUND', `Label group not found: ${label.groupId}`)
      }
    }

    // Get next position within group
    let maxPos: { maxPos: number }
    if (label.groupId) {
      maxPos = this.ctx.drizzle
        .select({ maxPos: sql<number>`COALESCE(MAX(${pmoLabels.position}), -1)` })
        .from(pmoLabels)
        .where(eq(pmoLabels.groupId, label.groupId))
        .get() as { maxPos: number }
    } else {
      maxPos = this.ctx.drizzle
        .select({ maxPos: sql<number>`COALESCE(MAX(${pmoLabels.position}), -1)` })
        .from(pmoLabels)
        .where(isNull(pmoLabels.groupId))
        .get() as { maxPos: number }
    }

    const now = new Date().toISOString()
    try {
      this.ctx.drizzle.insert(pmoLabels).values({
        id,
        name: label.name,
        color: label.color || null,
        description: label.description || null,
        groupId: label.groupId || null,
        position: label.position ?? maxPos.maxPos + 1,
        isBuiltin: label.isBuiltin || false,
        createdAt: now,
      }).run()
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
        throw new PMOError('CONFLICT', `Label "${label.name}" already exists in this group`)
      }
      throw err
    }

    return (await this.getLabel(id))!
  }

  async updateLabel(id: string, changes: Partial<Label>): Promise<Label> {
    const existing = await this.getLabel(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Label not found: ${id}`)
    }

    const updates: Partial<typeof pmoLabels.$inferInsert> = {}

    if (changes.name !== undefined) {
      updates.name = changes.name
    }
    if (changes.color !== undefined) {
      updates.color = changes.color
    }
    if (changes.description !== undefined) {
      updates.description = changes.description
    }
    if (changes.groupId !== undefined) {
      updates.groupId = changes.groupId
    }
    if (changes.position !== undefined) {
      updates.position = changes.position
    }

    if (Object.keys(updates).length > 0) {
      this.ctx.drizzle
        .update(pmoLabels)
        .set(updates)
        .where(eq(pmoLabels.id, id))
        .run()
    }

    return (await this.getLabel(id))!
  }

  async deleteLabel(id: string): Promise<void> {
    const existing = await this.getLabel(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Label not found: ${id}`)
    }

    // ticket_labels rows cascade on delete
    this.ctx.drizzle
      .delete(pmoLabels)
      .where(eq(pmoLabels.id, id))
      .run()
  }

  // ===========================================================================
  // Ticket-Label Association Operations
  // ===========================================================================

  /**
   * Add a label to a ticket.
   * Enforces group exclusivity: if the label belongs to an exclusive group,
   * removes any existing label from the same group first.
   */
  async addLabelToTicket(ticketId: string, labelId: string): Promise<void> {
    // Validate ticket exists
    const ticket = this.ctx.drizzle
      .select({ id: pmoTickets.id })
      .from(pmoTickets)
      .where(eq(pmoTickets.id, ticketId))
      .get()
    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`)
    }

    // Get the label and its group info
    const label = await this.getLabel(labelId)
    if (!label) {
      throw new PMOError('NOT_FOUND', `Label not found: ${labelId}`)
    }

    // If label belongs to an exclusive group, enforce exclusivity
    if (label.groupId) {
      const group = await this.getLabelGroup(label.groupId)
      if (group?.isExclusive) {
        // Remove any existing labels from this group on this ticket
        // Use raw sql for the subquery
        this.ctx.drizzle.run(
          sql`DELETE FROM ${pmoTicketLabels}
            WHERE ${pmoTicketLabels.ticketId} = ${ticketId}
            AND ${pmoTicketLabels.labelId} IN (
              SELECT ${pmoLabels.id} FROM ${pmoLabels} WHERE ${pmoLabels.groupId} = ${label.groupId}
            )`
        )
      }
    }

    // Add the label (ignore if already exists)
    this.ctx.drizzle.run(
      sql`INSERT OR IGNORE INTO ${pmoTicketLabels} (ticket_id, label_id) VALUES (${ticketId}, ${labelId})`
    )
  }

  /**
   * Remove a label from a ticket.
   */
  async removeLabelFromTicket(ticketId: string, labelId: string): Promise<void> {
    const result = this.ctx.drizzle
      .delete(pmoTicketLabels)
      .where(and(
        eq(pmoTicketLabels.ticketId, ticketId),
        eq(pmoTicketLabels.labelId, labelId)
      ))
      .run()

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Label ${labelId} is not applied to ticket ${ticketId}`)
    }
  }

  /**
   * Get all labels for a ticket.
   */
  async getLabelsForTicket(ticketId: string): Promise<Label[]> {
    const rows = this.ctx.drizzle
      .select({
        id: pmoLabels.id,
        name: pmoLabels.name,
        color: pmoLabels.color,
        description: pmoLabels.description,
        groupId: pmoLabels.groupId,
        groupName: pmoLabelGroups.name,
        position: pmoLabels.position,
        isBuiltin: pmoLabels.isBuiltin,
        createdAt: pmoLabels.createdAt,
      })
      .from(pmoTicketLabels)
      .innerJoin(pmoLabels, eq(pmoTicketLabels.labelId, pmoLabels.id))
      .leftJoin(pmoLabelGroups, eq(pmoLabels.groupId, pmoLabelGroups.id))
      .where(eq(pmoTicketLabels.ticketId, ticketId))
      .orderBy(asc(pmoLabelGroups.position), asc(pmoLabels.position))
      .all()

    return rows.map(rowToLabel)
  }

  /**
   * Add a label to a ticket by name.
   * Resolves the label name to an ID first.
   * If the label name matches a group:label pattern, resolves within that group.
   */
  async addLabelToTicketByName(ticketId: string, labelName: string): Promise<void> {
    const label = await this.resolveLabelByName(labelName)
    if (!label) {
      throw new PMOError('NOT_FOUND', `Label not found: "${labelName}"`)
    }
    return this.addLabelToTicket(ticketId, label.id)
  }

  /**
   * Remove a label from a ticket by name.
   */
  async removeLabelFromTicketByName(ticketId: string, labelName: string): Promise<void> {
    const label = await this.resolveLabelByName(labelName)
    if (!label) {
      throw new PMOError('NOT_FOUND', `Label not found: "${labelName}"`)
    }
    return this.removeLabelFromTicket(ticketId, label.id)
  }

  /**
   * Resolve a label by name or group:name pattern.
   */
  private async resolveLabelByName(nameOrPattern: string): Promise<Label | null> {
    // Check for group:label pattern
    if (nameOrPattern.includes(':')) {
      const [groupName, labelName] = nameOrPattern.split(':', 2)
      const group = await this.getLabelGroupByName(groupName)
      if (group) {
        return this.getLabelByName(labelName, group.id)
      }
    }

    // Try direct name lookup
    return this.getLabelByName(nameOrPattern)
  }
}

// ===========================================================================
// Row Converters
// ===========================================================================

function rowToLabelGroup(row: {
  id: string
  name: string
  description: string | null
  isExclusive: boolean | null
  isRequired: boolean | null
  position: number
  createdAt: string | null
}): LabelGroup {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    isExclusive: row.isExclusive ?? true,
    isRequired: row.isRequired ?? false,
    position: row.position,
    createdAt: new Date(row.createdAt || Date.now()),
  }
}

function rowToLabel(row: {
  id: string
  name: string
  color: string | null
  description: string | null
  groupId: string | null
  groupName: string | null
  position: number
  isBuiltin: boolean | null
  createdAt: string | null
}): Label {
  return {
    id: row.id,
    name: row.name,
    color: row.color || undefined,
    description: row.description || undefined,
    groupId: row.groupId || undefined,
    groupName: row.groupName || undefined,
    position: row.position,
    isBuiltin: row.isBuiltin ?? false,
    createdAt: new Date(row.createdAt || Date.now()),
  }
}
