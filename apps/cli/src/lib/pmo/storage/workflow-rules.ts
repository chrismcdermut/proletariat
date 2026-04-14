/**
 * Workflow rule operations.
 *
 * Rules use intent-based wiring (from_intent/to_intent) instead of
 * provider-specific state names.
 */

import { eq, and, or, isNull, asc, sql } from 'drizzle-orm'
import { pmoActions, pmoWorkflowRules } from '../../database/drizzle-schema.js'
import { PMOError, WorkflowRule, WorkflowRuleFilter, WorkflowRuleTrigger } from '../types.js'
import { slugify } from '../../utils/text.js'
import { StorageContext } from './types.js'

export class WorkflowRuleStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * List workflow rules.
   */
  async listWorkflowRules(filter?: WorkflowRuleFilter): Promise<WorkflowRule[]> {
    const conditions = []

    // Support both new intent and deprecated state filters
    const toFilter = filter?.toIntent || filter?.toState
    if (toFilter) {
      conditions.push(eq(pmoWorkflowRules.toIntent, toFilter))
    }

    const fromFilter = filter?.fromIntent || filter?.fromState
    if (fromFilter) {
      conditions.push(or(
        eq(pmoWorkflowRules.fromIntent, fromFilter),
        isNull(pmoWorkflowRules.fromIntent)
      ))
    }

    if (filter?.actionId) {
      conditions.push(eq(pmoWorkflowRules.actionId, filter.actionId))
    }

    if (filter?.trigger) {
      conditions.push(eq(pmoWorkflowRules.trigger, filter.trigger))
    }

    if (filter?.enabled !== undefined) {
      conditions.push(eq(pmoWorkflowRules.enabled, filter.enabled))
    }

    const rows = this.ctx.drizzle
      .select()
      .from(pmoWorkflowRules)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(pmoWorkflowRules.toIntent), asc(pmoWorkflowRules.fromIntent))
      .all()

    return rows.map((row) => this.rowToRule(row))
  }

  /**
   * Get a workflow rule by ID.
   */
  async getWorkflowRule(id: string): Promise<WorkflowRule | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoWorkflowRules)
      .where(eq(pmoWorkflowRules.id, id))
      .get()

    if (!row) return null

    return this.rowToRule(row)
  }

  /**
   * Create a new workflow rule.
   */
  async createWorkflowRule(rule: Partial<WorkflowRule>): Promise<WorkflowRule> {
    // Support both new intent and deprecated state fields
    const toIntent = rule.toIntent || rule.toState
    const fromIntent = rule.fromIntent ?? rule.fromState

    if (!toIntent) {
      throw new PMOError('INVALID', 'to_intent is required')
    }
    if (!rule.actionId) {
      throw new PMOError('INVALID', 'action_id is required')
    }

    // Verify action exists
    const actionExists = this.ctx.drizzle
      .select({ id: pmoActions.id })
      .from(pmoActions)
      .where(eq(pmoActions.id, rule.actionId))
      .get()
    if (!actionExists) {
      throw new PMOError('NOT_FOUND', `Action not found: ${rule.actionId}`)
    }

    const id = rule.id || slugify(`${fromIntent || 'any'}-to-${toIntent}-${rule.actionId}`)

    // Check for duplicate
    const existing = this.ctx.drizzle
      .select({ id: pmoWorkflowRules.id })
      .from(pmoWorkflowRules)
      .where(eq(pmoWorkflowRules.id, id))
      .get()
    if (existing) {
      throw new PMOError('CONFLICT', `Workflow rule with id "${id}" already exists`)
    }

    const now = new Date().toISOString()
    const trigger = rule.trigger || 'manual'
    const enabled = rule.enabled !== false

    this.ctx.drizzle
      .insert(pmoWorkflowRules)
      .values({
        id,
        fromIntent: fromIntent || null,
        toIntent,
        actionId: rule.actionId,
        trigger,
        enabled,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    return {
      id,
      fromIntent: fromIntent || undefined,
      toIntent,
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
      const actionExists = this.ctx.drizzle
        .select({ id: pmoActions.id })
        .from(pmoActions)
        .where(eq(pmoActions.id, changes.actionId))
        .get()
      if (!actionExists) {
        throw new PMOError('NOT_FOUND', `Action not found: ${changes.actionId}`)
      }
    }

    const updateValues: Record<string, unknown> = {}

    if (changes.fromIntent !== undefined || changes.fromState !== undefined) {
      updateValues.fromIntent = changes.fromIntent ?? changes.fromState ?? null
    }
    if (changes.toIntent !== undefined || changes.toState !== undefined) {
      updateValues.toIntent = changes.toIntent ?? changes.toState ?? null
    }
    if (changes.actionId !== undefined) updateValues.actionId = changes.actionId
    if (changes.trigger !== undefined) updateValues.trigger = changes.trigger
    if (changes.enabled !== undefined) updateValues.enabled = changes.enabled

    if (Object.keys(updateValues).length > 0) {
      updateValues.updatedAt = new Date().toISOString()
      this.ctx.drizzle
        .update(pmoWorkflowRules)
        .set(updateValues)
        .where(eq(pmoWorkflowRules.id, id))
        .run()
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

    this.ctx.drizzle
      .delete(pmoWorkflowRules)
      .where(eq(pmoWorkflowRules.id, id))
      .run()
  }

  /**
   * Get all enabled workflow rules that match a target intent.
   * Used when a ticket transitions to a new intent state.
   */
  async getWorkflowRulesForIntent(toIntent: string): Promise<WorkflowRule[]> {
    const rows = this.ctx.drizzle
      .select()
      .from(pmoWorkflowRules)
      .where(and(
        eq(pmoWorkflowRules.toIntent, toIntent),
        eq(pmoWorkflowRules.enabled, true)
      ))
      .orderBy(
        sql`CASE WHEN ${pmoWorkflowRules.fromIntent} IS NOT NULL THEN 0 ELSE 1 END`,
        asc(pmoWorkflowRules.fromIntent)
      )
      .all()

    return rows.map((row) => this.rowToRule(row))
  }

  /** @deprecated Use getWorkflowRulesForIntent instead */
  async getWorkflowRulesForState(toState: string): Promise<WorkflowRule[]> {
    return this.getWorkflowRulesForIntent(toState)
  }

  private rowToRule(row: typeof pmoWorkflowRules.$inferSelect): WorkflowRule {
    return {
      id: row.id,
      fromIntent: row.fromIntent || undefined,
      toIntent: row.toIntent,
      // Deprecated compat aliases
      fromState: row.fromIntent || undefined,
      toState: row.toIntent,
      actionId: row.actionId,
      trigger: row.trigger as WorkflowRuleTrigger,
      enabled: row.enabled === true,
      createdAt: new Date(row.createdAt!),
      updatedAt: row.updatedAt ? new Date(row.updatedAt) : undefined,
    }
  }
}
