/**
 * Workflow Repository
 *
 * Typed data access for work actions, workflow rules, and work hooks.
 *
 * PRLT-1303: Data access layer — typed repository pattern.
 */

import { eq, and, or, like, isNull, asc, desc, sql } from 'drizzle-orm'
import {
  pmoActions as actionsTable,
  pmoWorkflowRules as workflowRulesTable,
  pmoWorkHooks as workHooksTable,
} from '../drizzle-schema.js'
import type {
  RepositoryContext,
  ActionRecord,
  CreateActionInput,
  UpdateActionInput,
  ActionFilter,
  WorkflowRuleRecord,
  CreateWorkflowRuleInput,
  UpdateWorkflowRuleInput,
  WorkflowRuleFilter,
  WorkHookRecord,
} from './types.js'

// =============================================================================
// Row Mapping
// =============================================================================

function toActionRecord(row: typeof actionsTable.$inferSelect): ActionRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    endPrompt: row.endPrompt,
    fromIntent: row.fromIntent,
    toIntent: row.toIntent,
    executor: row.executor,
    environment: row.environment,
    permissionMode: row.permissionMode,
    timeout: row.timeout,
    model: row.model,
    reviewGate: row.reviewGate,
    networkAllowlist: row.networkAllowlist,
    modifiesCode: row.modifiesCode === true,
    isDefault: row.isDefault === true,
    isBuiltin: row.isBuiltin === true,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toWorkflowRuleRecord(row: typeof workflowRulesTable.$inferSelect): WorkflowRuleRecord {
  return {
    id: row.id,
    fromIntent: row.fromIntent,
    toIntent: row.toIntent,
    actionId: row.actionId,
    trigger: row.trigger,
    enabled: row.enabled === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toWorkHookRecord(row: typeof workHooksTable.$inferSelect): WorkHookRecord {
  return {
    id: row.id,
    name: row.name,
    event: row.event,
    actionType: row.actionType,
    actionValue: row.actionValue,
    enabled: row.enabled === true,
    description: row.description,
    createdAt: row.createdAt,
  }
}

// =============================================================================
// WorkflowRepository
// =============================================================================

export interface IWorkflowRepository {
  // Actions
  findActionById(id: string): ActionRecord | null
  listActions(filter?: ActionFilter): ActionRecord[]
  createAction(input: CreateActionInput): ActionRecord
  updateAction(id: string, input: UpdateActionInput): ActionRecord
  deleteAction(id: string): void
  getSuggestedAction(intentOrStateName: string): ActionRecord | null

  // Workflow Rules
  findWorkflowRuleById(id: string): WorkflowRuleRecord | null
  listWorkflowRules(filter?: WorkflowRuleFilter): WorkflowRuleRecord[]
  createWorkflowRule(input: CreateWorkflowRuleInput): WorkflowRuleRecord
  updateWorkflowRule(id: string, input: UpdateWorkflowRuleInput): WorkflowRuleRecord
  deleteWorkflowRule(id: string): void
  getWorkflowRulesForIntent(toIntent: string): WorkflowRuleRecord[]

  // Work Hooks
  listWorkHooks(event?: string): WorkHookRecord[]
  findWorkHookById(id: string): WorkHookRecord | null
}

export class WorkflowRepository implements IWorkflowRepository {
  constructor(private ctx: RepositoryContext) {}

  // ===========================================================================
  // Actions
  // ===========================================================================

  findActionById(id: string): ActionRecord | null {
    const row = this.ctx.drizzle
      .select()
      .from(actionsTable)
      .where(eq(actionsTable.id, id))
      .get()
    return row ? toActionRecord(row) : null
  }

  listActions(filter?: ActionFilter): ActionRecord[] {
    const conditions = []

    if (filter?.isBuiltin !== undefined) {
      conditions.push(eq(actionsTable.isBuiltin, filter.isBuiltin))
    }

    if (filter?.fromIntent) {
      conditions.push(or(
        eq(actionsTable.fromIntent, filter.fromIntent),
        isNull(actionsTable.fromIntent),
      ))
    }

    if (filter?.search) {
      conditions.push(or(
        like(actionsTable.name, `%${filter.search}%`),
        like(actionsTable.description, `%${filter.search}%`),
      ))
    }

    const rows = this.ctx.drizzle
      .select()
      .from(actionsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        desc(actionsTable.isBuiltin),
        desc(actionsTable.isDefault),
        asc(actionsTable.position),
        asc(actionsTable.name),
      )
      .all()

    return rows.map(toActionRecord)
  }

  createAction(input: CreateActionInput): ActionRecord {
    const now = new Date().toISOString()
    const id = input.id || slugify(input.name)

    this.ctx.drizzle
      .insert(actionsTable)
      .values({
        id,
        name: input.name,
        description: input.description ?? null,
        prompt: input.prompt,
        endPrompt: input.endPrompt ?? null,
        fromIntent: input.fromIntent ?? null,
        toIntent: input.toIntent ?? null,
        executor: input.executor ?? null,
        environment: input.environment ?? null,
        permissionMode: input.permissionMode ?? null,
        timeout: input.timeout ?? null,
        model: input.model ?? null,
        reviewGate: input.reviewGate ?? null,
        networkAllowlist: input.networkAllowlist ?? null,
        modifiesCode: input.modifiesCode !== false,
        isDefault: input.isDefault ?? false,
        isBuiltin: input.isBuiltin ?? false,
        position: input.position ?? 0,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    return this.findActionById(id)!
  }

  updateAction(id: string, input: UpdateActionInput): ActionRecord {
    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() }

    if (input.name !== undefined) update.name = input.name
    if (input.description !== undefined) update.description = input.description
    if (input.prompt !== undefined) update.prompt = input.prompt
    if (input.endPrompt !== undefined) update.endPrompt = input.endPrompt
    if (input.fromIntent !== undefined) update.fromIntent = input.fromIntent
    if (input.toIntent !== undefined) update.toIntent = input.toIntent
    if (input.executor !== undefined) update.executor = input.executor
    if (input.environment !== undefined) update.environment = input.environment
    if (input.permissionMode !== undefined) update.permissionMode = input.permissionMode
    if (input.timeout !== undefined) update.timeout = input.timeout
    if (input.model !== undefined) update.model = input.model
    if (input.reviewGate !== undefined) update.reviewGate = input.reviewGate
    if (input.networkAllowlist !== undefined) update.networkAllowlist = input.networkAllowlist
    if (input.modifiesCode !== undefined) update.modifiesCode = input.modifiesCode
    if (input.isDefault !== undefined) update.isDefault = input.isDefault
    if (input.position !== undefined) update.position = input.position

    this.ctx.drizzle
      .update(actionsTable)
      .set(update)
      .where(eq(actionsTable.id, id))
      .run()

    return this.findActionById(id)!
  }

  deleteAction(id: string): void {
    this.ctx.drizzle
      .delete(actionsTable)
      .where(eq(actionsTable.id, id))
      .run()
  }

  getSuggestedAction(intentOrStateName: string): ActionRecord | null {
    // First try exact match with is_default=true
    const exactMatch = this.ctx.drizzle
      .select()
      .from(actionsTable)
      .where(and(
        eq(actionsTable.fromIntent, intentOrStateName),
        eq(actionsTable.isDefault, true),
      ))
      .orderBy(asc(actionsTable.position))
      .limit(1)
      .get()

    if (exactMatch) return toActionRecord(exactMatch)

    // Fall back to any action matching this intent
    const anyMatch = this.ctx.drizzle
      .select()
      .from(actionsTable)
      .where(or(
        eq(actionsTable.fromIntent, intentOrStateName),
        isNull(actionsTable.fromIntent),
      ))
      .orderBy(
        sql`CASE WHEN ${actionsTable.fromIntent} = ${intentOrStateName} THEN 0 ELSE 1 END`,
        desc(actionsTable.isDefault),
        asc(actionsTable.position),
      )
      .limit(1)
      .get()

    return anyMatch ? toActionRecord(anyMatch) : null
  }

  // ===========================================================================
  // Workflow Rules
  // ===========================================================================

  findWorkflowRuleById(id: string): WorkflowRuleRecord | null {
    const row = this.ctx.drizzle
      .select()
      .from(workflowRulesTable)
      .where(eq(workflowRulesTable.id, id))
      .get()
    return row ? toWorkflowRuleRecord(row) : null
  }

  listWorkflowRules(filter?: WorkflowRuleFilter): WorkflowRuleRecord[] {
    const conditions = []

    if (filter?.toIntent) {
      conditions.push(eq(workflowRulesTable.toIntent, filter.toIntent))
    }
    if (filter?.fromIntent) {
      conditions.push(or(
        eq(workflowRulesTable.fromIntent, filter.fromIntent),
        isNull(workflowRulesTable.fromIntent),
      ))
    }
    if (filter?.actionId) {
      conditions.push(eq(workflowRulesTable.actionId, filter.actionId))
    }
    if (filter?.trigger) {
      conditions.push(eq(workflowRulesTable.trigger, filter.trigger))
    }
    if (filter?.enabled !== undefined) {
      conditions.push(eq(workflowRulesTable.enabled, filter.enabled))
    }

    const rows = this.ctx.drizzle
      .select()
      .from(workflowRulesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(workflowRulesTable.toIntent), asc(workflowRulesTable.fromIntent))
      .all()

    return rows.map(toWorkflowRuleRecord)
  }

  createWorkflowRule(input: CreateWorkflowRuleInput): WorkflowRuleRecord {
    const now = new Date().toISOString()
    const id = input.id || slugify(`${input.fromIntent || 'any'}-to-${input.toIntent}-${input.actionId}`)

    this.ctx.drizzle
      .insert(workflowRulesTable)
      .values({
        id,
        fromIntent: input.fromIntent ?? null,
        toIntent: input.toIntent,
        actionId: input.actionId,
        trigger: input.trigger ?? 'manual',
        enabled: input.enabled !== false,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    return this.findWorkflowRuleById(id)!
  }

  updateWorkflowRule(id: string, input: UpdateWorkflowRuleInput): WorkflowRuleRecord {
    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() }

    if (input.fromIntent !== undefined) update.fromIntent = input.fromIntent
    if (input.toIntent !== undefined) update.toIntent = input.toIntent
    if (input.actionId !== undefined) update.actionId = input.actionId
    if (input.trigger !== undefined) update.trigger = input.trigger
    if (input.enabled !== undefined) update.enabled = input.enabled

    this.ctx.drizzle
      .update(workflowRulesTable)
      .set(update)
      .where(eq(workflowRulesTable.id, id))
      .run()

    return this.findWorkflowRuleById(id)!
  }

  deleteWorkflowRule(id: string): void {
    this.ctx.drizzle
      .delete(workflowRulesTable)
      .where(eq(workflowRulesTable.id, id))
      .run()
  }

  getWorkflowRulesForIntent(toIntent: string): WorkflowRuleRecord[] {
    const rows = this.ctx.drizzle
      .select()
      .from(workflowRulesTable)
      .where(and(
        eq(workflowRulesTable.toIntent, toIntent),
        eq(workflowRulesTable.enabled, true),
      ))
      .orderBy(
        sql`CASE WHEN ${workflowRulesTable.fromIntent} IS NOT NULL THEN 0 ELSE 1 END`,
        asc(workflowRulesTable.fromIntent),
      )
      .all()

    return rows.map(toWorkflowRuleRecord)
  }

  // ===========================================================================
  // Work Hooks
  // ===========================================================================

  listWorkHooks(event?: string): WorkHookRecord[] {
    const conditions = []
    if (event) {
      conditions.push(eq(workHooksTable.event, event))
    }

    const rows = this.ctx.drizzle
      .select()
      .from(workHooksTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .all()

    return rows.map(toWorkHookRecord)
  }

  findWorkHookById(id: string): WorkHookRecord | null {
    const row = this.ctx.drizzle
      .select()
      .from(workHooksTable)
      .where(eq(workHooksTable.id, id))
      .get()
    return row ? toWorkHookRecord(row) : null
  }
}

// =============================================================================
// Utility
// =============================================================================

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
