/**
 * Workflow status operations.
 */

import { PMO_TABLES } from '../schema.js'
import { PMOError, StateCategory, STATE_CATEGORY_ORDER, WorkflowStatus } from '../types.js'
import { slugify } from '../utils.js'
import { StorageContext, StatusRow } from './types.js'
import { rowToStatus } from './helpers.js'

const T = PMO_TABLES

export class StatusStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * List statuses for a project.
   */
  async listStatuses(projectId: string): Promise<WorkflowStatus[]> {
    const rows = this.ctx.db.prepare(`
      SELECT * FROM ${T.statuses}
      WHERE project_id = ?
      ORDER BY
        CASE category
          WHEN 'backlog' THEN 0
          WHEN 'unstarted' THEN 1
          WHEN 'started' THEN 2
          WHEN 'completed' THEN 3
          WHEN 'canceled' THEN 4
        END,
        position
    `).all(projectId) as StatusRow[]

    return rows.map(rowToStatus)
  }

  /**
   * Get a status by ID.
   */
  async getStatus(id: string): Promise<WorkflowStatus | null> {
    const row = this.ctx.db.prepare(`
      SELECT * FROM ${T.statuses} WHERE id = ?
    `).get(id) as StatusRow | undefined

    if (!row) return null

    return rowToStatus(row)
  }

  /**
   * Create a new status.
   */
  async createStatus(projectId: string, status: Partial<WorkflowStatus>): Promise<WorkflowStatus> {
    const id = status.id || slugify(status.name || 'status')
    const category = status.category || 'backlog'
    const now = new Date().toISOString()

    // Validate category
    if (!STATE_CATEGORY_ORDER.includes(category)) {
      throw new PMOError(
        'INVALID',
        `Invalid category: ${category}. Must be one of: ${STATE_CATEGORY_ORDER.join(', ')}`
      )
    }

    // Get next position within category if not specified
    let position = status.position
    if (position === undefined) {
      const maxPos = this.ctx.db.prepare(`
        SELECT COALESCE(MAX(position), -1) as max_pos
        FROM ${T.statuses}
        WHERE project_id = ? AND category = ?
      `).get(projectId, category) as { max_pos: number }
      position = maxPos.max_pos + 1
    }

    // Check for duplicate name in project
    const existing = this.ctx.db.prepare(`
      SELECT id FROM ${T.statuses}
      WHERE project_id = ? AND LOWER(name) = LOWER(?)
    `).get(projectId, status.name) as { id: string } | undefined
    if (existing) {
      throw new PMOError(
        'CONFLICT',
        `Status with name "${status.name}" already exists in this project`
      )
    }

    // If this is the default, unset other defaults in the project
    if (status.isDefault) {
      this.ctx.db.prepare(`
        UPDATE ${T.statuses}
        SET is_default = 0
        WHERE project_id = ?
      `).run(projectId)
    }

    this.ctx.db.prepare(`
      INSERT INTO ${T.statuses} (id, project_id, name, category, position, color, description, is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      status.name || 'New Status',
      category,
      position,
      status.color || null,
      status.description || null,
      status.isDefault ? 1 : 0,
      now
    )

    return {
      id,
      projectId,
      name: status.name || 'New Status',
      category,
      position,
      color: status.color,
      description: status.description,
      isDefault: status.isDefault || false,
      createdAt: new Date(now),
    }
  }

  /**
   * Update a status.
   */
  async updateStatus(id: string, changes: Partial<WorkflowStatus>): Promise<WorkflowStatus> {
    const existing = await this.getStatus(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Status not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      // Check for duplicate name
      const duplicate = this.ctx.db.prepare(`
        SELECT id FROM ${T.statuses}
        WHERE project_id = ? AND LOWER(name) = LOWER(?) AND id != ?
      `).get(existing.projectId, changes.name, id) as { id: string } | undefined
      if (duplicate) {
        throw new PMOError(
          'CONFLICT',
          `Status with name "${changes.name}" already exists in this project`
        )
      }
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.category !== undefined) {
      if (!STATE_CATEGORY_ORDER.includes(changes.category)) {
        throw new PMOError('INVALID', `Invalid category: ${changes.category}`)
      }
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
      if (changes.isDefault) {
        // Unset other defaults
        this.ctx.db.prepare(`
          UPDATE ${T.statuses}
          SET is_default = 0
          WHERE project_id = ?
        `).run(existing.projectId)
      }
      updates.push('is_default = ?')
      params.push(changes.isDefault ? 1 : 0)
    }

    if (updates.length > 0) {
      params.push(id)
      this.ctx.db.prepare(`UPDATE ${T.statuses} SET ${updates.join(', ')} WHERE id = ?`).run(
        ...params
      )
    }

    return (await this.getStatus(id)) as WorkflowStatus
  }

  /**
   * Delete a status.
   */
  async deleteStatus(id: string): Promise<void> {
    const existing = await this.getStatus(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Status not found: ${id}`)
    }

    // Check if any tickets use this status
    const ticketCount = this.ctx.db.prepare(`
      SELECT COUNT(*) as count FROM ${T.tickets}
      WHERE status_id = ?
    `).get(id) as { count: number }

    if (ticketCount.count > 0) {
      throw new PMOError(
        'CONFLICT',
        `Cannot delete status: ${ticketCount.count} ticket(s) are using it`
      )
    }

    this.ctx.db.prepare(`DELETE FROM ${T.statuses} WHERE id = ?`).run(id)

    // Reorder remaining statuses in the same category
    this.ctx.db.prepare(`
      UPDATE ${T.statuses}
      SET position = position - 1
      WHERE project_id = ? AND category = ? AND position > ?
    `).run(existing.projectId, existing.category, existing.position)
  }

  /**
   * Reorder a status to a new position.
   */
  async reorderStatus(id: string, newPosition: number): Promise<WorkflowStatus> {
    const existing = await this.getStatus(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Status not found: ${id}`)
    }

    const oldPosition = existing.position
    if (oldPosition === newPosition) {
      return existing
    }

    // Shift other statuses within the same category
    if (newPosition < oldPosition) {
      this.ctx.db.prepare(`
        UPDATE ${T.statuses}
        SET position = position + 1
        WHERE project_id = ? AND category = ? AND position >= ? AND position < ?
      `).run(existing.projectId, existing.category, newPosition, oldPosition)
    } else {
      this.ctx.db.prepare(`
        UPDATE ${T.statuses}
        SET position = position - 1
        WHERE project_id = ? AND category = ? AND position > ? AND position <= ?
      `).run(existing.projectId, existing.category, oldPosition, newPosition)
    }

    // Update the status's position
    this.ctx.db.prepare(`
      UPDATE ${T.statuses}
      SET position = ?
      WHERE id = ?
    `).run(newPosition, id)

    return (await this.getStatus(id)) as WorkflowStatus
  }

  /**
   * Get the default status for a project.
   */
  async getDefaultStatus(projectId: string): Promise<WorkflowStatus | null> {
    const row = this.ctx.db.prepare(`
      SELECT * FROM ${T.statuses}
      WHERE project_id = ? AND is_default = 1
    `).get(projectId) as StatusRow | undefined

    if (!row) {
      // If no explicit default, return first status in backlog category
      const fallback = this.ctx.db.prepare(`
        SELECT * FROM ${T.statuses}
        WHERE project_id = ?
        ORDER BY
          CASE category
            WHEN 'backlog' THEN 0
            WHEN 'unstarted' THEN 1
            WHEN 'started' THEN 2
            WHEN 'completed' THEN 3
            WHEN 'canceled' THEN 4
          END,
          position
        LIMIT 1
      `).get(projectId) as StatusRow | undefined

      if (!fallback) return null
      return rowToStatus(fallback)
    }

    return rowToStatus(row)
  }
}
