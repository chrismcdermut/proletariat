/**
 * Workflow status operations.
 * Statuses belong to workflows (not projects directly).
 * Projects reference workflows via workflow_id.
 *
 * This module uses Drizzle ORM for type-safe database queries.
 */

import { eq, and, like, or, desc, asc, sql } from 'drizzle-orm'
import {
  pmoWorkflows,
  pmoWorkflowStatuses,
  pmoProjects,
  pmoTickets,
} from '../../database/drizzle-schema.js'
import { PMOError, StateCategory, STATE_CATEGORY_ORDER, Workflow, WorkflowStatus, WorkflowFilter } from '../types.js'
import { slugify } from '../utils.js'
import { StorageContext } from './types.js'
import { wrapSqliteError } from './helpers.js'

/**
 * Convert Drizzle row to Workflow object.
 */
function rowToWorkflow(row: {
  id: string
  name: string
  description: string | null
  isBuiltin: boolean | null
  createdAt: string | null
  updatedAt: string | null
}): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    isBuiltin: row.isBuiltin ?? false,
    createdAt: new Date(row.createdAt || Date.now()),
    updatedAt: new Date(row.updatedAt || Date.now()),
  }
}

/**
 * Convert Drizzle row to WorkflowStatus object.
 */
function rowToWorkflowStatus(row: {
  id: string
  workflowId: string
  name: string
  category: string
  position: number
  color: string | null
  description: string | null
  isDefault: boolean | null
  createdAt: string | null
}): WorkflowStatus {
  return {
    id: row.id,
    workflowId: row.workflowId,
    name: row.name,
    category: row.category as StateCategory,
    position: row.position,
    color: row.color || undefined,
    description: row.description || undefined,
    isDefault: row.isDefault ?? false,
    createdAt: new Date(row.createdAt || Date.now()),
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
    let query = this.ctx.drizzle
      .select()
      .from(pmoWorkflows)
      .$dynamic()

    const conditions = []

    if (filter?.isBuiltin !== undefined) {
      conditions.push(eq(pmoWorkflows.isBuiltin, filter.isBuiltin))
    }
    if (filter?.search) {
      conditions.push(
        or(
          like(pmoWorkflows.name, `%${filter.search}%`),
          like(pmoWorkflows.description, `%${filter.search}%`)
        )
      )
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions))
    }

    const rows = query
      .orderBy(desc(pmoWorkflows.isBuiltin), asc(pmoWorkflows.name))
      .all()

    return rows.map(rowToWorkflow)
  }

  /**
   * Get a workflow by ID.
   */
  async getWorkflow(id: string): Promise<Workflow | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoWorkflows)
      .where(eq(pmoWorkflows.id, id))
      .get()

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
    const existing = this.ctx.drizzle
      .select({ id: pmoWorkflows.id })
      .from(pmoWorkflows)
      .where(sql`LOWER(${pmoWorkflows.name}) = LOWER(${workflow.name})`)
      .get()
    if (existing) {
      throw new PMOError('CONFLICT', `Workflow with name "${workflow.name}" already exists`)
    }

    try {
      this.ctx.drizzle.insert(pmoWorkflows).values({
        id,
        name: workflow.name || 'New Workflow',
        description: workflow.description || null,
        isBuiltin: workflow.isBuiltin || false,
        createdAt: now,
        updatedAt: now,
      }).run()
    } catch (err) {
      wrapSqliteError('Workflow', 'create', err)
    }

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

    const updates: Partial<typeof pmoWorkflows.$inferInsert> = {}

    if (changes.name !== undefined) {
      // Check for duplicate name
      const duplicate = this.ctx.drizzle
        .select({ id: pmoWorkflows.id })
        .from(pmoWorkflows)
        .where(and(
          sql`LOWER(${pmoWorkflows.name}) = LOWER(${changes.name})`,
          sql`${pmoWorkflows.id} != ${id}`
        ))
        .get()
      if (duplicate) {
        throw new PMOError('CONFLICT', `Workflow with name "${changes.name}" already exists`)
      }
      updates.name = changes.name
    }
    if (changes.description !== undefined) {
      updates.description = changes.description || null
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date().toISOString()
      this.ctx.drizzle
        .update(pmoWorkflows)
        .set(updates)
        .where(eq(pmoWorkflows.id, id))
        .run()
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
    const projectCount = this.ctx.drizzle
      .select({ count: sql<number>`COUNT(*)` })
      .from(pmoProjects)
      .where(eq(pmoProjects.workflowId, id))
      .get()

    if (projectCount && projectCount.count > 0) {
      throw new PMOError(
        'CONFLICT',
        `Cannot delete workflow: ${projectCount.count} project(s) are using it`
      )
    }

    try {
      // Delete associated statuses first (cascaded by FK, but explicit for safety)
      this.ctx.drizzle
        .delete(pmoWorkflowStatuses)
        .where(eq(pmoWorkflowStatuses.workflowId, id))
        .run()
      this.ctx.drizzle
        .delete(pmoWorkflows)
        .where(eq(pmoWorkflows.id, id))
        .run()
    } catch (err) {
      wrapSqliteError('Workflow', 'delete', err)
    }
  }

  /**
   * Get the workflow for a project.
   */
  async getProjectWorkflow(projectId: string): Promise<Workflow | null> {
    const row = this.ctx.drizzle
      .select({
        id: pmoWorkflows.id,
        name: pmoWorkflows.name,
        description: pmoWorkflows.description,
        isBuiltin: pmoWorkflows.isBuiltin,
        createdAt: pmoWorkflows.createdAt,
        updatedAt: pmoWorkflows.updatedAt,
      })
      .from(pmoWorkflows)
      .innerJoin(pmoProjects, eq(pmoProjects.workflowId, pmoWorkflows.id))
      .where(eq(pmoProjects.id, projectId))
      .get()

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
    const rows = this.ctx.drizzle
      .select()
      .from(pmoWorkflowStatuses)
      .where(eq(pmoWorkflowStatuses.workflowId, workflowId))
      .orderBy(asc(pmoWorkflowStatuses.position))
      .all()

    return rows.map(rowToWorkflowStatus)
  }

  /**
   * Get a status by ID.
   */
  async getStatus(id: string): Promise<WorkflowStatus | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoWorkflowStatuses)
      .where(eq(pmoWorkflowStatuses.id, id))
      .get()

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
      const maxPos = this.ctx.drizzle
        .select({ maxPos: sql<number>`COALESCE(MAX(${pmoWorkflowStatuses.position}), -1)` })
        .from(pmoWorkflowStatuses)
        .where(eq(pmoWorkflowStatuses.workflowId, workflowId))
        .get()
      position = (maxPos?.maxPos ?? -1) + 1
    }

    // Check for duplicate name in workflow
    const existing = this.ctx.drizzle
      .select({ id: pmoWorkflowStatuses.id })
      .from(pmoWorkflowStatuses)
      .where(and(
        eq(pmoWorkflowStatuses.workflowId, workflowId),
        sql`LOWER(${pmoWorkflowStatuses.name}) = LOWER(${status.name})`
      ))
      .get()
    if (existing) {
      throw new PMOError(
        'CONFLICT',
        `Status with name "${status.name}" already exists in this workflow`
      )
    }

    // If this is the default, unset other defaults in the workflow
    if (status.isDefault) {
      this.ctx.drizzle
        .update(pmoWorkflowStatuses)
        .set({ isDefault: false })
        .where(eq(pmoWorkflowStatuses.workflowId, workflowId))
        .run()
    }

    try {
      this.ctx.drizzle.insert(pmoWorkflowStatuses).values({
        id,
        workflowId,
        name: status.name || 'New Status',
        category,
        position,
        color: status.color || null,
        description: status.description || null,
        isDefault: status.isDefault || false,
        createdAt: now,
      }).run()
    } catch (err) {
      wrapSqliteError('Status', 'create', err)
    }

    // Update workflow's updated_at timestamp
    this.ctx.drizzle
      .update(pmoWorkflows)
      .set({ updatedAt: now })
      .where(eq(pmoWorkflows.id, workflowId))
      .run()

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

    const updates: Partial<typeof pmoWorkflowStatuses.$inferInsert> = {}

    if (changes.name !== undefined) {
      // Check for duplicate name
      const duplicate = this.ctx.drizzle
        .select({ id: pmoWorkflowStatuses.id })
        .from(pmoWorkflowStatuses)
        .where(and(
          eq(pmoWorkflowStatuses.workflowId, existing.workflowId),
          sql`LOWER(${pmoWorkflowStatuses.name}) = LOWER(${changes.name})`,
          sql`${pmoWorkflowStatuses.id} != ${id}`
        ))
        .get()
      if (duplicate) {
        throw new PMOError(
          'CONFLICT',
          `Status with name "${changes.name}" already exists in this workflow`
        )
      }
      updates.name = changes.name
    }
    if (changes.category !== undefined) {
      if (!STATE_CATEGORY_ORDER.includes(changes.category)) {
        throw new PMOError('INVALID', `Invalid category: ${changes.category}`)
      }
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
      if (changes.isDefault) {
        // Unset other defaults
        this.ctx.drizzle
          .update(pmoWorkflowStatuses)
          .set({ isDefault: false })
          .where(eq(pmoWorkflowStatuses.workflowId, existing.workflowId))
          .run()
      }
      updates.isDefault = changes.isDefault
    }

    if (Object.keys(updates).length > 0) {
      this.ctx.drizzle
        .update(pmoWorkflowStatuses)
        .set(updates)
        .where(eq(pmoWorkflowStatuses.id, id))
        .run()

      // Update workflow's updated_at timestamp
      this.ctx.drizzle
        .update(pmoWorkflows)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(pmoWorkflows.id, existing.workflowId))
        .run()
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
    const ticketCount = this.ctx.drizzle
      .select({ count: sql<number>`COUNT(*)` })
      .from(pmoTickets)
      .where(eq(pmoTickets.statusId, id))
      .get()

    if (ticketCount && ticketCount.count > 0) {
      throw new PMOError(
        'CONFLICT',
        `Cannot delete status: ${ticketCount.count} ticket(s) are using it`
      )
    }

    try {
      this.ctx.drizzle
        .delete(pmoWorkflowStatuses)
        .where(eq(pmoWorkflowStatuses.id, id))
        .run()

      // Reorder remaining statuses
      this.ctx.drizzle
        .update(pmoWorkflowStatuses)
        .set({ position: sql`${pmoWorkflowStatuses.position} - 1` })
        .where(and(
          eq(pmoWorkflowStatuses.workflowId, existing.workflowId),
          sql`${pmoWorkflowStatuses.position} > ${existing.position}`
        ))
        .run()
    } catch (err) {
      wrapSqliteError('Status', 'delete', err)
    }

    // Update workflow's updated_at timestamp
    this.ctx.drizzle
      .update(pmoWorkflows)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(pmoWorkflows.id, existing.workflowId))
      .run()
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
      this.ctx.drizzle
        .update(pmoWorkflowStatuses)
        .set({ position: sql`${pmoWorkflowStatuses.position} + 1` })
        .where(and(
          eq(pmoWorkflowStatuses.workflowId, existing.workflowId),
          sql`${pmoWorkflowStatuses.position} >= ${newPosition}`,
          sql`${pmoWorkflowStatuses.position} < ${oldPosition}`
        ))
        .run()
    } else {
      this.ctx.drizzle
        .update(pmoWorkflowStatuses)
        .set({ position: sql`${pmoWorkflowStatuses.position} - 1` })
        .where(and(
          eq(pmoWorkflowStatuses.workflowId, existing.workflowId),
          sql`${pmoWorkflowStatuses.position} > ${oldPosition}`,
          sql`${pmoWorkflowStatuses.position} <= ${newPosition}`
        ))
        .run()
    }

    // Update the status's position
    this.ctx.drizzle
      .update(pmoWorkflowStatuses)
      .set({ position: newPosition })
      .where(eq(pmoWorkflowStatuses.id, id))
      .run()

    // Update workflow's updated_at timestamp
    this.ctx.drizzle
      .update(pmoWorkflows)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(pmoWorkflows.id, existing.workflowId))
      .run()

    return (await this.getStatus(id)) as WorkflowStatus
  }

  /**
   * Get the default status for a workflow.
   */
  async getDefaultStatus(workflowId: string): Promise<WorkflowStatus | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoWorkflowStatuses)
      .where(and(
        eq(pmoWorkflowStatuses.workflowId, workflowId),
        eq(pmoWorkflowStatuses.isDefault, true)
      ))
      .get()

    if (!row) {
      // If no explicit default, return first status (by position)
      const fallback = this.ctx.drizzle
        .select()
        .from(pmoWorkflowStatuses)
        .where(eq(pmoWorkflowStatuses.workflowId, workflowId))
        .orderBy(asc(pmoWorkflowStatuses.position))
        .limit(1)
        .get()

      if (!fallback) return null
      return rowToWorkflowStatus(fallback)
    }

    return rowToWorkflowStatus(row)
  }
}
