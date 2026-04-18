/**
 * Work action operations.
 *
 * Actions use intent-based wiring (from_intent/to_intent) instead of
 * provider-specific state names. The transition map resolves intents
 * to provider states at runtime.
 */

import { eq, and, or, like, isNull, asc, desc, sql } from 'drizzle-orm'
import { pmoActions } from '../../database/drizzle-schema.js'
import { PMOError, WorkAction, WorkActionFilter, ActionExecutor, ActionEnvironment, ActionPermissionMode, ReviewGateMode } from '../types.js'
import { slugify } from '../../utils/text.js'
import { StorageContext } from './types.js'

export class ActionStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * List work actions.
   */
  async listActions(filter?: WorkActionFilter): Promise<WorkAction[]> {
    const conditions = []

    if (filter?.isBuiltin !== undefined) {
      conditions.push(eq(pmoActions.isBuiltin, filter.isBuiltin))
    }

    // Support both fromIntent (new) and fromState (deprecated)
    const intentFilter = filter?.fromIntent || filter?.fromState
    if (intentFilter) {
      conditions.push(or(eq(pmoActions.fromIntent, intentFilter), isNull(pmoActions.fromIntent)))
    }

    if (filter?.search) {
      conditions.push(
        or(
          like(pmoActions.name, `%${filter.search}%`),
          like(pmoActions.description, `%${filter.search}%`)
        )
      )
    }

    const rows = this.ctx.drizzle
      .select()
      .from(pmoActions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        desc(pmoActions.isBuiltin),
        desc(pmoActions.isDefault),
        asc(pmoActions.position),
        asc(pmoActions.name)
      )
      .all()

    return rows.map((row) => this.rowToAction(row))
  }

  /**
   * Get a work action by ID.
   */
  async getAction(id: string): Promise<WorkAction | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoActions)
      .where(eq(pmoActions.id, id))
      .get()

    if (!row) return null

    return this.rowToAction(row)
  }

  /**
   * Create a new work action.
   */
  async createAction(action: Partial<WorkAction>): Promise<WorkAction> {
    if (!action.name) {
      throw new PMOError('INVALID', 'Action name is required')
    }
    if (!action.prompt) {
      throw new PMOError('INVALID', 'Action prompt is required')
    }

    const id = action.id || slugify(action.name)

    // Check for duplicate name
    const existing = this.ctx.drizzle
      .select({ id: pmoActions.id })
      .from(pmoActions)
      .where(sql`LOWER(${pmoActions.name}) = LOWER(${action.name})`)
      .get()
    if (existing) {
      throw new PMOError('CONFLICT', `Action with name "${action.name}" already exists`)
    }

    const now = new Date().toISOString()
    const modifiesCode = action.modifiesCode !== false

    // Support both fromIntent (new) and fromState (deprecated)
    const fromIntent = action.fromIntent ?? action.fromState ?? null
    const toIntent = action.toIntent ?? action.toState ?? null
    const validFrom = action.validFrom?.length ? JSON.stringify(action.validFrom) : null

    this.ctx.drizzle
      .insert(pmoActions)
      .values({
        id,
        name: action.name,
        description: action.description || null,
        prompt: action.prompt,
        endPrompt: action.endPrompt || null,
        fromIntent,
        toIntent,
        validFrom,
        executor: action.executor || null,
        environment: action.environment || null,
        permissionMode: action.permissionMode || null,
        timeout: action.timeout || null,
        model: action.model || null,
        reviewGate: action.reviewGate || null,
        networkAllowlist: action.networkAllowlist?.length ? JSON.stringify(action.networkAllowlist) : null,
        modifiesCode,
        isDefault: action.isDefault || false,
        isBuiltin: action.isBuiltin || false,
        position: action.position || 0,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    return {
      id,
      name: action.name,
      description: action.description,
      prompt: action.prompt,
      endPrompt: action.endPrompt,
      fromIntent: fromIntent || undefined,
      toIntent: toIntent || undefined,
      validFrom: action.validFrom,
      executor: action.executor,
      environment: action.environment,
      permissionMode: action.permissionMode,
      timeout: action.timeout,
      model: action.model,
      reviewGate: action.reviewGate,
      networkAllowlist: action.networkAllowlist,
      modifiesCode,
      isDefault: action.isDefault,
      isBuiltin: action.isBuiltin || false,
      position: action.position || 0,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  }

  /**
   * Update a work action.
   */
  async updateAction(id: string, changes: Partial<WorkAction>): Promise<WorkAction> {
    const existing = await this.getAction(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Action not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot modify built-in actions')
    }

    // Check for duplicate name if name is changing
    if (changes.name && changes.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = this.ctx.drizzle
        .select({ id: pmoActions.id })
        .from(pmoActions)
        .where(and(
          sql`LOWER(${pmoActions.name}) = LOWER(${changes.name})`,
          sql`${pmoActions.id} != ${id}`
        ))
        .get()
      if (dup) {
        throw new PMOError('CONFLICT', `Action "${changes.name}" already exists`)
      }
    }

    const updateValues: Record<string, unknown> = {}

    if (changes.name !== undefined) updateValues.name = changes.name
    if (changes.description !== undefined) updateValues.description = changes.description || null
    if (changes.prompt !== undefined) updateValues.prompt = changes.prompt
    if (changes.endPrompt !== undefined) updateValues.endPrompt = changes.endPrompt || null
    // Support both fromIntent (new) and fromState (deprecated)
    if (changes.fromIntent !== undefined || changes.fromState !== undefined) {
      updateValues.fromIntent = changes.fromIntent ?? changes.fromState ?? null
    }
    if (changes.toIntent !== undefined || changes.toState !== undefined) {
      updateValues.toIntent = changes.toIntent ?? changes.toState ?? null
    }
    if (changes.validFrom !== undefined) {
      updateValues.validFrom = changes.validFrom?.length ? JSON.stringify(changes.validFrom) : null
    }
    if (changes.executor !== undefined) updateValues.executor = changes.executor || null
    if (changes.environment !== undefined) updateValues.environment = changes.environment || null
    if (changes.permissionMode !== undefined) updateValues.permissionMode = changes.permissionMode || null
    if (changes.timeout !== undefined) updateValues.timeout = changes.timeout || null
    if (changes.model !== undefined) updateValues.model = changes.model || null
    if (changes.reviewGate !== undefined) updateValues.reviewGate = changes.reviewGate || null
    if (changes.networkAllowlist !== undefined) {
      updateValues.networkAllowlist = changes.networkAllowlist?.length ? JSON.stringify(changes.networkAllowlist) : null
    }
    if (changes.modifiesCode !== undefined) updateValues.modifiesCode = changes.modifiesCode
    if (changes.isDefault !== undefined) updateValues.isDefault = changes.isDefault

    if (Object.keys(updateValues).length > 0) {
      updateValues.updatedAt = new Date().toISOString()
      this.ctx.drizzle
        .update(pmoActions)
        .set(updateValues)
        .where(eq(pmoActions.id, id))
        .run()
    }

    return (await this.getAction(id))!
  }

  /**
   * Update a built-in action's prompt and metadata.
   * Built-in actions can be customized (prompt, description, timeout, etc.)
   * but cannot be renamed or deleted.
   */
  async updateBuiltinAction(id: string, changes: Record<string, unknown>): Promise<WorkAction> {
    const existing = await this.getAction(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Action not found: ${id}`)
    }

    if (!existing.isBuiltin) {
      // Non-builtin actions should use updateAction
      return this.updateAction(id, changes as Partial<WorkAction>)
    }

    const updateValues: Record<string, unknown> = {}

    if (changes.prompt !== undefined) updateValues.prompt = changes.prompt
    if (changes.endPrompt !== undefined) updateValues.endPrompt = changes.endPrompt || null
    if (changes.description !== undefined) updateValues.description = changes.description || null
    if (changes.fromIntent !== undefined) updateValues.fromIntent = changes.fromIntent || null
    if (changes.toIntent !== undefined) updateValues.toIntent = changes.toIntent || null
    if (changes.validFrom !== undefined) {
      const vf = changes.validFrom as string[] | undefined
      updateValues.validFrom = vf?.length ? JSON.stringify(vf) : null
    }
    if (changes.executor !== undefined) updateValues.executor = changes.executor || null
    if (changes.timeout !== undefined) updateValues.timeout = changes.timeout || null

    if (Object.keys(updateValues).length > 0) {
      updateValues.updatedAt = new Date().toISOString()
      this.ctx.drizzle
        .update(pmoActions)
        .set(updateValues)
        .where(eq(pmoActions.id, id))
        .run()
    }

    return (await this.getAction(id))!
  }

  /**
   * Delete a work action.
   */
  async deleteAction(id: string): Promise<void> {
    const existing = await this.getAction(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Action not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot delete built-in actions')
    }

    this.ctx.drizzle
      .delete(pmoActions)
      .where(eq(pmoActions.id, id))
      .run()
  }

  /**
   * Get suggested action for an intent name.
   * Matches actions where from_intent equals the given intent, or from_intent is null.
   * Prefers exact from_intent matches with is_default=true, then by position.
   */
  async getSuggestedAction(intentOrStateName: string): Promise<WorkAction | null> {
    // First try to find a default action with exact from_intent match
    const exactMatch = this.ctx.drizzle
      .select()
      .from(pmoActions)
      .where(and(
        eq(pmoActions.fromIntent, intentOrStateName),
        eq(pmoActions.isDefault, true)
      ))
      .orderBy(asc(pmoActions.position))
      .limit(1)
      .get()

    if (exactMatch) {
      return this.rowToAction(exactMatch)
    }

    // Fall back to any action matching this intent (exact match first, then null from_intent)
    const anyMatch = this.ctx.drizzle
      .select()
      .from(pmoActions)
      .where(or(
        eq(pmoActions.fromIntent, intentOrStateName),
        isNull(pmoActions.fromIntent)
      ))
      .orderBy(
        sql`CASE WHEN ${pmoActions.fromIntent} = ${intentOrStateName} THEN 0 ELSE 1 END`,
        desc(pmoActions.isDefault),
        asc(pmoActions.position)
      )
      .limit(1)
      .get()

    if (anyMatch) {
      return this.rowToAction(anyMatch)
    }

    return null
  }

  /**
   * Find the action that should auto-fire for a given from_intent.
   * Used by the hook system to resolve which action to trigger
   * when a ticket reaches a particular intent state.
   */
  async getActionByFromIntent(intent: string): Promise<WorkAction | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoActions)
      .where(eq(pmoActions.fromIntent, intent))
      .orderBy(desc(pmoActions.isDefault), asc(pmoActions.position))
      .limit(1)
      .get()

    if (!row) return null
    return this.rowToAction(row)
  }

  private rowToAction(row: typeof pmoActions.$inferSelect): WorkAction {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      prompt: row.prompt,
      endPrompt: row.endPrompt || undefined,
      fromIntent: row.fromIntent || undefined,
      toIntent: row.toIntent || undefined,
      validFrom: row.validFrom ? JSON.parse(row.validFrom) : undefined,
      // Deprecated compat aliases
      fromState: row.fromIntent || undefined,
      toState: row.toIntent || undefined,
      executor: (row.executor as ActionExecutor) || undefined,
      environment: (row.environment as ActionEnvironment) || undefined,
      permissionMode: (row.permissionMode as ActionPermissionMode) || undefined,
      timeout: row.timeout || undefined,
      model: row.model || undefined,
      reviewGate: (row.reviewGate as ReviewGateMode) || undefined,
      networkAllowlist: row.networkAllowlist ? JSON.parse(row.networkAllowlist) : undefined,
      modifiesCode: row.modifiesCode === true,
      isDefault: row.isDefault === true,
      isBuiltin: row.isBuiltin === true,
      position: row.position,
      createdAt: new Date(row.createdAt!),
      updatedAt: row.updatedAt ? new Date(row.updatedAt) : undefined,
    }
  }
}
