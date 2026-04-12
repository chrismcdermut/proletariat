/**
 * Workflow rule operations.
 */

import { PMO_TABLES } from '../schema.js'
import { PMOError, WorkflowRule, WorkflowRuleFilter, WorkflowRuleTrigger } from '../types.js'
import { slugify } from '../utils.js'
import { StorageContext, WorkflowRuleRow } from './types.js'

const T = PMO_TABLES

export class WorkflowRuleStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * List workflow rules.
   */
  async listWorkflowRules(filter?: WorkflowRuleFilter): Promise<WorkflowRule[]> {
    let sql = `SELECT * FROM ${T.workflow_rules}`
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter?.toIntent) {
      conditions.push('to_intent = ?')
      params.push(filter.toIntent)
    }

    if (filter?.fromIntent) {
      conditions.push('(from_intent = ? OR from_intent IS NULL)')
      params.push(filter.fromIntent)
    }

    if (filter?.actionId) {
      conditions.push('action_id = ?')
      params.push(filter.actionId)
    }

    if (filter?.trigger) {
      conditions.push('trigger = ?')
      params.push(filter.trigger)
    }

    if (filter?.enabled !== undefined) {
      conditions.push('enabled = ?')
      params.push(filter.enabled ? 1 : 0)
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }

    sql += ' ORDER BY to_intent ASC, from_intent ASC'

    const rows = this.ctx.db.prepare(sql).all(...params) as WorkflowRuleRow[]

    return rows.map((row) => this.rowToRule(row))
  }

  /**
   * Get a workflow rule by ID.
   */
  async getWorkflowRule(id: string): Promise<WorkflowRule | null> {
    const row = this.ctx.db.prepare(`SELECT * FROM ${T.workflow_rules} WHERE id = ?`).get(
      id
    ) as WorkflowRuleRow | undefined

    if (!row) return null

    return this.rowToRule(row)
  }

  /**
   * Create a new workflow rule.
   */
  async createWorkflowRule(rule: Partial<WorkflowRule>): Promise<WorkflowRule> {
    if (!rule.toIntent) {
      throw new PMOError('INVALID', 'to_intent is required')
    }
    if (!rule.actionId) {
      throw new PMOError('INVALID', 'action_id is required')
    }

    // Verify action exists
    const actionExists = this.ctx.db.prepare(`
      SELECT id FROM ${T.actions} WHERE id = ?
    `).get(rule.actionId)
    if (!actionExists) {
      throw new PMOError('NOT_FOUND', `Action not found: ${rule.actionId}`)
    }

    const id = rule.id || slugify(`${rule.fromIntent || 'any'}-to-${rule.toIntent}-${rule.actionId}`)

    // Check for duplicate
    const existing = this.ctx.db.prepare(`
      SELECT id FROM ${T.workflow_rules} WHERE id = ?
    `).get(id)
    if (existing) {
      throw new PMOError('CONFLICT', `Workflow rule with id "${id}" already exists`)
    }

    const now = new Date().toISOString()
    const trigger = rule.trigger || 'manual'
    const enabled = rule.enabled !== false

    this.ctx.db.prepare(`
      INSERT INTO ${T.workflow_rules} (id, from_intent, to_intent, action_id, trigger, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      rule.fromIntent || null,
      rule.toIntent,
      rule.actionId,
      trigger,
      enabled ? 1 : 0,
      now,
      now
    )

    return {
      id,
      fromIntent: rule.fromIntent,
      toIntent: rule.toIntent,
      actionId: rule.actionId,
      trigger,
      enabled,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  }

  /**
   * Update a workflow rule.
   */
  async updateWorkflowRule(id: string, changes: Partial<WorkflowRule>): Promise<WorkflowRule> {
    const existing = await this.getWorkflowRule(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Workflow rule not found: ${id}`)
    }

    // If changing action_id, verify new action exists
    if (changes.actionId) {
      const actionExists = this.ctx.db.prepare(`
        SELECT id FROM ${T.actions} WHERE id = ?
      `).get(changes.actionId)
      if (!actionExists) {
        throw new PMOError('NOT_FOUND', `Action not found: ${changes.actionId}`)
      }
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.fromIntent !== undefined) {
      updates.push('from_intent = ?')
      params.push(changes.fromIntent || null)
    }
    if (changes.toIntent !== undefined) {
      updates.push('to_intent = ?')
      params.push(changes.toIntent)
    }
    if (changes.actionId !== undefined) {
      updates.push('action_id = ?')
      params.push(changes.actionId)
    }
    if (changes.trigger !== undefined) {
      updates.push('trigger = ?')
      params.push(changes.trigger)
    }
    if (changes.enabled !== undefined) {
      updates.push('enabled = ?')
      params.push(changes.enabled ? 1 : 0)
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(new Date().toISOString())
      params.push(id)
      this.ctx.db.prepare(`UPDATE ${T.workflow_rules} SET ${updates.join(', ')} WHERE id = ?`).run(
        ...params
      )
    }

    return (await this.getWorkflowRule(id))!
  }

  /**
   * Delete a workflow rule.
   */
  async deleteWorkflowRule(id: string): Promise<void> {
    const existing = await this.getWorkflowRule(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Workflow rule not found: ${id}`)
    }

    this.ctx.db.prepare(`DELETE FROM ${T.workflow_rules} WHERE id = ?`).run(id)
  }

  /**
   * Get all enabled workflow rules that match a target intent.
   * Used when a ticket transitions to a new state (resolved to intent).
   */
  async getWorkflowRulesForIntent(toIntent: string): Promise<WorkflowRule[]> {
    const rows = this.ctx.db.prepare(`
      SELECT * FROM ${T.workflow_rules}
      WHERE to_intent = ? AND enabled = 1
      ORDER BY
        CASE WHEN from_intent IS NOT NULL THEN 0 ELSE 1 END,
        from_intent ASC
    `).all(toIntent) as WorkflowRuleRow[]

    return rows.map((row) => this.rowToRule(row))
  }

  private rowToRule(row: WorkflowRuleRow): WorkflowRule {
    return {
      id: row.id,
      fromIntent: row.from_intent || undefined,
      toIntent: row.to_intent,
      actionId: row.action_id,
      trigger: row.trigger as WorkflowRuleTrigger,
      enabled: row.enabled === 1,
      createdAt: new Date(row.created_at),
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
    }
  }
}
