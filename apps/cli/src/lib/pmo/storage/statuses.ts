/**
 * Workflow status operations.
 * Statuses belong to workflows (not projects directly).
 * Projects reference workflows via workflow_id.
 */

import { PMO_TABLES } from '../schema.js'
import { PMOError, StateCategory, STATE_CATEGORY_ORDER, Workflow, WorkflowStatus, WorkflowFilter } from '../types.js'
import { slugify } from '../utils.js'
import { StorageContext, WorkflowStatusRow, WorkflowRow } from './types.js'

const T = PMO_TABLES

/**
 * Convert database row to Workflow object.
 */
function rowToWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    isBuiltin: !!row.is_builtin,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

/**
 * Convert database row to WorkflowStatus object.
 */
function rowToWorkflowStatus(row: WorkflowStatusRow): WorkflowStatus {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    name: row.name,
    category: row.category as StateCategory,
    position: row.position,
    color: row.color || undefined,
    description: row.description || undefined,
    isDefault: !!row.is_default,
    createdAt: new Date(row.created_at),
  }
}

export class StatusStorage {
  constructor(private ctx: StorageContext) {}

  // ============================================================================
  // Workflow Operations
  // ============================================================================

  /**
   * List all workflows.
   */
  async listWorkflows(filter?: WorkflowFilter): Promise<Workflow[]> {
    let sql = `SELECT * FROM ${T.workflows} WHERE 1=1`
    const params: unknown[] = []

    if (filter?.isBuiltin !== undefined) {
      sql += ' AND is_builtin = ?'
      params.push(filter.isBuiltin ? 1 : 0)
    }
    if (filter?.search) {
      sql += ' AND (name LIKE ? OR description LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }

    sql += ' ORDER BY is_builtin DESC, name'

    const rows = this.ctx.db.prepare(sql).all(...params) as WorkflowRow[]
    return rows.map(rowToWorkflow)
  }

  /**
   * Get a workflow by ID.
   */
  async getWorkflow(id: string): Promise<Workflow | null> {
    const row = this.ctx.db.prepare(`
      SELECT * FROM ${T.workflows} WHERE id = ?
    `).get(id) as WorkflowRow | undefined

    if (!row) return null
    return rowToWorkflow(row)
  }

  /**
   * Create a new workflow.
   */
  async createWorkflow(workflow: Partial<Workflow>): Promise<Workflow> {
    const id = workflow.id || slugify(workflow.name || 'workflow')
    const now = new Date().toISOString()

    // Check for duplicate name
    const existing = this.ctx.db.prepare(`
      SELECT id FROM ${T.workflows}
      WHERE LOWER(name) = LOWER(?)
    `).get(workflow.name) as { id: string } | undefined
    if (existing) {
      throw new PMOError('CONFLICT', `Workflow with name "${workflow.name}" already exists`)
    }

    this.ctx.db.prepare(`
      INSERT INTO ${T.workflows} (id, name, description, is_builtin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      workflow.name || 'New Workflow',
      workflow.description || null,
      workflow.isBuiltin ? 1 : 0,
      now,
      now
    )

    return {
      id,
      name: workflow.name || 'New Workflow',
      description: workflow.description,
      isBuiltin: workflow.isBuiltin || false,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  }

  /**
   * Update a workflow.
   */
  async updateWorkflow(id: string, changes: Partial<Workflow>): Promise<Workflow> {
    const existing = await this.getWorkflow(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Workflow not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      // Check for duplicate name
      const duplicate = this.ctx.db.prepare(`
        SELECT id FROM ${T.workflows}
        WHERE LOWER(name) = LOWER(?) AND id != ?
      `).get(changes.name, id) as { id: string } | undefined
      if (duplicate) {
        throw new PMOError('CONFLICT', `Workflow with name "${changes.name}" already exists`)
      }
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description || null)
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(new Date().toISOString())
      params.push(id)
      this.ctx.db.prepare(`UPDATE ${T.workflows} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    return (await this.getWorkflow(id)) as Workflow
  }

  /**
   * Delete a workflow.
   */
  async deleteWorkflow(id: string): Promise<void> {
    const existing = await this.getWorkflow(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Workflow not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', `Cannot delete built-in workflow: ${existing.name}`)
    }

    // Check if any projects use this workflow
    const projectCount = this.ctx.db.prepare(`
      SELECT COUNT(*) as count FROM ${T.projects}
      WHERE workflow_id = ?
    `).get(id) as { count: number }

    if (projectCount.count > 0) {
      throw new PMOError(
        'CONFLICT',
        `Cannot delete workflow: ${projectCount.count} project(s) are using it`
      )
    }

    // Delete associated statuses first (cascaded by FK, but explicit for safety)
    this.ctx.db.prepare(`DELETE FROM ${T.workflow_statuses} WHERE workflow_id = ?`).run(id)
    this.ctx.db.prepare(`DELETE FROM ${T.workflows} WHERE id = ?`).run(id)
  }

  /**
   * Get the workflow for a project.
   */
  async getProjectWorkflow(projectId: string): Promise<Workflow | null> {
    const row = this.ctx.db.prepare(`
      SELECT w.* FROM ${T.workflows} w
      JOIN ${T.projects} p ON p.workflow_id = w.id
      WHERE p.id = ?
    `).get(projectId) as WorkflowRow | undefined

    if (!row) return null
    return rowToWorkflow(row)
  }

  // ============================================================================
  // Workflow Status Operations
  // ============================================================================

  /**
   * List statuses for a workflow.
   */
  async listStatuses(workflowId: string): Promise<WorkflowStatus[]> {
    const rows = this.ctx.db.prepare(`
      SELECT * FROM ${T.workflow_statuses}
      WHERE workflow_id = ?
      ORDER BY position
    `).all(workflowId) as WorkflowStatusRow[]

    return rows.map(rowToWorkflowStatus)
  }

  /**
   * Get a status by ID.
   */
  async getStatus(id: string): Promise<WorkflowStatus | null> {
    const row = this.ctx.db.prepare(`
      SELECT * FROM ${T.workflow_statuses} WHERE id = ?
    `).get(id) as WorkflowStatusRow | undefined

    if (!row) return null
    return rowToWorkflowStatus(row)
  }

  /**
   * Create a new status in a workflow.
   */
  async createStatus(workflowId: string, status: Partial<WorkflowStatus>): Promise<WorkflowStatus> {
    const id = status.id || `${workflowId}-${slugify(status.name || 'status')}`
    const category = status.category || 'backlog'
    const now = new Date().toISOString()

    // Validate workflow exists
    const workflow = await this.getWorkflow(workflowId)
    if (!workflow) {
      throw new PMOError('NOT_FOUND', `Workflow not found: ${workflowId}`)
    }

    // Validate category
    if (!STATE_CATEGORY_ORDER.includes(category)) {
      throw new PMOError(
        'INVALID',
        `Invalid category: ${category}. Must be one of: ${STATE_CATEGORY_ORDER.join(', ')}`
      )
    }

    // Get next position if not specified
    let position = status.position
    if (position === undefined) {
      const maxPos = this.ctx.db.prepare(`
        SELECT COALESCE(MAX(position), -1) as max_pos
        FROM ${T.workflow_statuses}
        WHERE workflow_id = ?
      `).get(workflowId) as { max_pos: number }
      position = maxPos.max_pos + 1
    }

    // Check for duplicate name in workflow
    const existing = this.ctx.db.prepare(`
      SELECT id FROM ${T.workflow_statuses}
      WHERE workflow_id = ? AND LOWER(name) = LOWER(?)
    `).get(workflowId, status.name) as { id: string } | undefined
    if (existing) {
      throw new PMOError(
        'CONFLICT',
        `Status with name "${status.name}" already exists in this workflow`
      )
    }

    // If this is the default, unset other defaults in the workflow
    if (status.isDefault) {
      this.ctx.db.prepare(`
        UPDATE ${T.workflow_statuses}
        SET is_default = 0
        WHERE workflow_id = ?
      `).run(workflowId)
    }

    this.ctx.db.prepare(`
      INSERT INTO ${T.workflow_statuses} (id, workflow_id, name, category, position, color, description, is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      workflowId,
      status.name || 'New Status',
      category,
      position,
      status.color || null,
      status.description || null,
      status.isDefault ? 1 : 0,
      now
    )

    // Update workflow's updated_at timestamp
    this.ctx.db.prepare(`UPDATE ${T.workflows} SET updated_at = ? WHERE id = ?`).run(now, workflowId)

    return {
      id,
      workflowId,
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
        SELECT id FROM ${T.workflow_statuses}
        WHERE workflow_id = ? AND LOWER(name) = LOWER(?) AND id != ?
      `).get(existing.workflowId, changes.name, id) as { id: string } | undefined
      if (duplicate) {
        throw new PMOError(
          'CONFLICT',
          `Status with name "${changes.name}" already exists in this workflow`
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
          UPDATE ${T.workflow_statuses}
          SET is_default = 0
          WHERE workflow_id = ?
        `).run(existing.workflowId)
      }
      updates.push('is_default = ?')
      params.push(changes.isDefault ? 1 : 0)
    }

    if (updates.length > 0) {
      params.push(id)
      this.ctx.db.prepare(`UPDATE ${T.workflow_statuses} SET ${updates.join(', ')} WHERE id = ?`).run(
        ...params
      )

      // Update workflow's updated_at timestamp
      this.ctx.db.prepare(`UPDATE ${T.workflows} SET updated_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        existing.workflowId
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

    this.ctx.db.prepare(`DELETE FROM ${T.workflow_statuses} WHERE id = ?`).run(id)

    // Reorder remaining statuses
    this.ctx.db.prepare(`
      UPDATE ${T.workflow_statuses}
      SET position = position - 1
      WHERE workflow_id = ? AND position > ?
    `).run(existing.workflowId, existing.position)

    // Update workflow's updated_at timestamp
    this.ctx.db.prepare(`UPDATE ${T.workflows} SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      existing.workflowId
    )
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

    // Shift other statuses
    if (newPosition < oldPosition) {
      this.ctx.db.prepare(`
        UPDATE ${T.workflow_statuses}
        SET position = position + 1
        WHERE workflow_id = ? AND position >= ? AND position < ?
      `).run(existing.workflowId, newPosition, oldPosition)
    } else {
      this.ctx.db.prepare(`
        UPDATE ${T.workflow_statuses}
        SET position = position - 1
        WHERE workflow_id = ? AND position > ? AND position <= ?
      `).run(existing.workflowId, oldPosition, newPosition)
    }

    // Update the status's position
    this.ctx.db.prepare(`
      UPDATE ${T.workflow_statuses}
      SET position = ?
      WHERE id = ?
    `).run(newPosition, id)

    // Update workflow's updated_at timestamp
    this.ctx.db.prepare(`UPDATE ${T.workflows} SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      existing.workflowId
    )

    return (await this.getStatus(id)) as WorkflowStatus
  }

  /**
   * Get the default status for a workflow.
   */
  async getDefaultStatus(workflowId: string): Promise<WorkflowStatus | null> {
    const row = this.ctx.db.prepare(`
      SELECT * FROM ${T.workflow_statuses}
      WHERE workflow_id = ? AND is_default = 1
    `).get(workflowId) as WorkflowStatusRow | undefined

    if (!row) {
      // If no explicit default, return first status (by position)
      const fallback = this.ctx.db.prepare(`
        SELECT * FROM ${T.workflow_statuses}
        WHERE workflow_id = ?
        ORDER BY position
        LIMIT 1
      `).get(workflowId) as WorkflowStatusRow | undefined

      if (!fallback) return null
      return rowToWorkflowStatus(fallback)
    }

    return rowToWorkflowStatus(row)
  }
}
