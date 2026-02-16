/**
 * Label storage operations for PMO.
 * Handles CRUD for labels, label groups, and ticket-label associations.
 * Enforces group exclusivity constraints.
 */

import { PMO_TABLES } from '../schema.js'
import { Label, LabelFilter, LabelGroup, LabelGroupFilter, PMOError } from '../types.js'
import { slugify } from '../utils.js'
import { StorageContext, LabelGroupRow, LabelRow } from './types.js'

const T = PMO_TABLES

export class LabelStorage {
  constructor(private ctx: StorageContext) {}

  // ===========================================================================
  // Label Group Operations
  // ===========================================================================

  async listLabelGroups(filter?: LabelGroupFilter): Promise<LabelGroup[]> {
    let query = `SELECT * FROM ${T.label_groups} WHERE 1=1`
    const params: unknown[] = []

    if (filter?.search) {
      query += ' AND (name LIKE ? OR description LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }

    query += ' ORDER BY position ASC, name ASC'

    const rows = this.ctx.db.prepare(query).all(...params) as LabelGroupRow[]
    return rows.map(rowToLabelGroup)
  }

  async getLabelGroup(id: string): Promise<LabelGroup | null> {
    const row = this.ctx.db.prepare(
      `SELECT * FROM ${T.label_groups} WHERE id = ?`
    ).get(id) as LabelGroupRow | undefined
    return row ? rowToLabelGroup(row) : null
  }

  async getLabelGroupByName(name: string): Promise<LabelGroup | null> {
    const row = this.ctx.db.prepare(
      `SELECT * FROM ${T.label_groups} WHERE LOWER(name) = LOWER(?)`
    ).get(name) as LabelGroupRow | undefined
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
    const maxPos = this.ctx.db.prepare(
      `SELECT COALESCE(MAX(position), -1) as max_pos FROM ${T.label_groups}`
    ).get() as { max_pos: number }

    const now = new Date().toISOString()
    this.ctx.db.prepare(`
      INSERT INTO ${T.label_groups} (id, name, description, is_exclusive, is_required, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      group.name,
      group.description || null,
      group.isExclusive !== undefined ? (group.isExclusive ? 1 : 0) : 1,
      group.isRequired !== undefined ? (group.isRequired ? 1 : 0) : 0,
      group.position ?? maxPos.max_pos + 1,
      now
    )

    return (await this.getLabelGroup(id))!
  }

  async updateLabelGroup(id: string, changes: Partial<LabelGroup>): Promise<LabelGroup> {
    const existing = await this.getLabelGroup(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Label group not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description)
    }
    if (changes.isExclusive !== undefined) {
      updates.push('is_exclusive = ?')
      params.push(changes.isExclusive ? 1 : 0)
    }
    if (changes.isRequired !== undefined) {
      updates.push('is_required = ?')
      params.push(changes.isRequired ? 1 : 0)
    }
    if (changes.position !== undefined) {
      updates.push('position = ?')
      params.push(changes.position)
    }

    if (updates.length > 0) {
      params.push(id)
      this.ctx.db.prepare(
        `UPDATE ${T.label_groups} SET ${updates.join(', ')} WHERE id = ?`
      ).run(...params)
    }

    return (await this.getLabelGroup(id))!
  }

  async deleteLabelGroup(id: string): Promise<void> {
    const existing = await this.getLabelGroup(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Label group not found: ${id}`)
    }

    // Labels in this group will have group_id set to NULL (ON DELETE SET NULL)
    this.ctx.db.prepare(`DELETE FROM ${T.label_groups} WHERE id = ?`).run(id)
  }

  // ===========================================================================
  // Label Operations
  // ===========================================================================

  async listLabels(filter?: LabelFilter): Promise<Label[]> {
    let query = `
      SELECT l.*, lg.name as group_name
      FROM ${T.labels} l
      LEFT JOIN ${T.label_groups} lg ON l.group_id = lg.id
      WHERE 1=1
    `
    const params: unknown[] = []

    if (filter?.groupId) {
      query += ' AND l.group_id = ?'
      params.push(filter.groupId)
    }
    if (filter?.search) {
      query += ' AND (l.name LIKE ? OR l.description LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }
    if (filter?.isBuiltin !== undefined) {
      query += ' AND l.is_builtin = ?'
      params.push(filter.isBuiltin ? 1 : 0)
    }

    query += ' ORDER BY lg.position ASC, l.position ASC, l.name ASC'

    const rows = this.ctx.db.prepare(query).all(...params) as LabelRow[]
    return rows.map(rowToLabel)
  }

  async getLabel(id: string): Promise<Label | null> {
    const row = this.ctx.db.prepare(`
      SELECT l.*, lg.name as group_name
      FROM ${T.labels} l
      LEFT JOIN ${T.label_groups} lg ON l.group_id = lg.id
      WHERE l.id = ?
    `).get(id) as LabelRow | undefined
    return row ? rowToLabel(row) : null
  }

  async getLabelByName(name: string, groupId?: string): Promise<Label | null> {
    let query = `
      SELECT l.*, lg.name as group_name
      FROM ${T.labels} l
      LEFT JOIN ${T.label_groups} lg ON l.group_id = lg.id
      WHERE LOWER(l.name) = LOWER(?)
    `
    const params: unknown[] = [name]

    if (groupId) {
      query += ' AND l.group_id = ?'
      params.push(groupId)
    }

    const row = this.ctx.db.prepare(query).get(...params) as LabelRow | undefined
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
    let maxPos: { max_pos: number }
    if (label.groupId) {
      maxPos = this.ctx.db.prepare(
        `SELECT COALESCE(MAX(position), -1) as max_pos FROM ${T.labels} WHERE group_id = ?`
      ).get(label.groupId) as { max_pos: number }
    } else {
      maxPos = this.ctx.db.prepare(
        `SELECT COALESCE(MAX(position), -1) as max_pos FROM ${T.labels} WHERE group_id IS NULL`
      ).get() as { max_pos: number }
    }

    const now = new Date().toISOString()
    try {
      this.ctx.db.prepare(`
        INSERT INTO ${T.labels} (id, name, color, description, group_id, position, is_builtin, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        label.name,
        label.color || null,
        label.description || null,
        label.groupId || null,
        label.position ?? maxPos.max_pos + 1,
        label.isBuiltin ? 1 : 0,
        now
      )
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

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.color !== undefined) {
      updates.push('color = ?')
      params.push(changes.color)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description)
    }
    if (changes.groupId !== undefined) {
      updates.push('group_id = ?')
      params.push(changes.groupId)
    }
    if (changes.position !== undefined) {
      updates.push('position = ?')
      params.push(changes.position)
    }

    if (updates.length > 0) {
      params.push(id)
      this.ctx.db.prepare(
        `UPDATE ${T.labels} SET ${updates.join(', ')} WHERE id = ?`
      ).run(...params)
    }

    return (await this.getLabel(id))!
  }

  async deleteLabel(id: string): Promise<void> {
    const existing = await this.getLabel(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Label not found: ${id}`)
    }

    // ticket_labels rows cascade on delete
    this.ctx.db.prepare(`DELETE FROM ${T.labels} WHERE id = ?`).run(id)
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
    const ticket = this.ctx.db.prepare(
      `SELECT id FROM ${T.tickets} WHERE id = ?`
    ).get(ticketId) as { id: string } | undefined
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
        this.ctx.db.prepare(`
          DELETE FROM ${T.ticket_labels}
          WHERE ticket_id = ? AND label_id IN (
            SELECT id FROM ${T.labels} WHERE group_id = ?
          )
        `).run(ticketId, label.groupId)
      }
    }

    // Add the label (ignore if already exists)
    this.ctx.db.prepare(`
      INSERT OR IGNORE INTO ${T.ticket_labels} (ticket_id, label_id)
      VALUES (?, ?)
    `).run(ticketId, labelId)
  }

  /**
   * Remove a label from a ticket.
   */
  async removeLabelFromTicket(ticketId: string, labelId: string): Promise<void> {
    const result = this.ctx.db.prepare(`
      DELETE FROM ${T.ticket_labels}
      WHERE ticket_id = ? AND label_id = ?
    `).run(ticketId, labelId)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Label ${labelId} is not applied to ticket ${ticketId}`)
    }
  }

  /**
   * Get all labels for a ticket.
   */
  async getLabelsForTicket(ticketId: string): Promise<Label[]> {
    const rows = this.ctx.db.prepare(`
      SELECT l.*, lg.name as group_name
      FROM ${T.ticket_labels} tl
      JOIN ${T.labels} l ON tl.label_id = l.id
      LEFT JOIN ${T.label_groups} lg ON l.group_id = lg.id
      WHERE tl.ticket_id = ?
      ORDER BY lg.position ASC, l.position ASC
    `).all(ticketId) as LabelRow[]

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

function rowToLabelGroup(row: LabelGroupRow): LabelGroup {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    isExclusive: row.is_exclusive === 1,
    isRequired: row.is_required === 1,
    position: row.position,
    createdAt: new Date(row.created_at),
  }
}

function rowToLabel(row: LabelRow): Label {
  return {
    id: row.id,
    name: row.name,
    color: row.color || undefined,
    description: row.description || undefined,
    groupId: row.group_id || undefined,
    groupName: row.group_name || undefined,
    position: row.position,
    isBuiltin: row.is_builtin === 1,
    createdAt: new Date(row.created_at),
  }
}
