/**
 * Hooks Manager
 *
 * Central registry and executor for event-based hooks.
 * Manages hook registration, event emission, condition evaluation,
 * and action execution.
 */

import {
  Hook,
  HookEventName,
  HookEventPayload,
  HookEventMap,
  HookCondition,
  HookAction,
  HookExecutionResult,
  HookActionResult,
  HookExecutionContext,
  ConditionOperator,
} from './types.js'
import { executeAction } from './actions/index.js'

// =============================================================================
// HooksManager Class
// =============================================================================

export class HooksManager {
  private hooks: Map<string, Hook> = new Map()
  private eventHooks: Map<HookEventName, Set<string>> = new Map()
  private workspacePath: string
  private pmoPath: string
  private log: (message: string) => void
  private enabled: boolean = true

  constructor(options: {
    workspacePath: string
    pmoPath: string
    log?: (message: string) => void
  }) {
    this.workspacePath = options.workspacePath
    this.pmoPath = options.pmoPath
    this.log = options.log || (() => {})
  }

  // ===========================================================================
  // Registration
  // ===========================================================================

  /**
   * Register a hook with the manager
   */
  registerHook(hook: Hook): void {
    // Store hook by ID
    this.hooks.set(hook.id, hook)

    // Index by event for fast lookup
    if (!this.eventHooks.has(hook.event)) {
      this.eventHooks.set(hook.event, new Set())
    }
    this.eventHooks.get(hook.event)!.add(hook.id)
  }

  /**
   * Register multiple hooks at once
   */
  registerHooks(hooks: Hook[]): void {
    for (const hook of hooks) {
      this.registerHook(hook)
    }
  }

  /**
   * Unregister a hook by ID
   */
  unregisterHook(hookId: string): boolean {
    const hook = this.hooks.get(hookId)
    if (!hook) {
      return false
    }

    // Remove from event index
    const eventHooks = this.eventHooks.get(hook.event)
    if (eventHooks) {
      eventHooks.delete(hookId)
    }

    // Remove from registry
    this.hooks.delete(hookId)
    return true
  }

  /**
   * Clear all registered hooks
   */
  clearHooks(): void {
    this.hooks.clear()
    this.eventHooks.clear()
  }

  /**
   * Get all registered hooks
   */
  getHooks(): Hook[] {
    return Array.from(this.hooks.values())
  }

  /**
   * Get a specific hook by ID
   */
  getHook(hookId: string): Hook | undefined {
    return this.hooks.get(hookId)
  }

  /**
   * Get hooks for a specific event
   */
  getHooksForEvent(event: HookEventName): Hook[] {
    const hookIds = this.eventHooks.get(event)
    if (!hookIds) {
      return []
    }
    return Array.from(hookIds)
      .map(id => this.hooks.get(id)!)
      .filter(hook => hook !== undefined)
  }

  // ===========================================================================
  // Global Enable/Disable
  // ===========================================================================

  /**
   * Enable the hooks system globally
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * Disable the hooks system globally
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * Check if hooks are enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  // ===========================================================================
  // Event Emission
  // ===========================================================================

  /**
   * Emit an event and execute matching hooks
   */
  async emit<E extends HookEventName>(
    event: E,
    payload: HookEventMap[E]
  ): Promise<HookExecutionResult[]> {
    // If hooks are disabled globally, return empty results
    if (!this.enabled) {
      return []
    }

    const results: HookExecutionResult[] = []
    const hooks = this.getHooksForEvent(event)

    // Sort by priority (lower = first)
    const sortedHooks = hooks.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))

    for (const hook of sortedHooks) {
      const result = await this.executeHook(hook, event, payload)
      results.push(result)
    }

    return results
  }

  // ===========================================================================
  // Hook Execution
  // ===========================================================================

  /**
   * Execute a single hook
   */
  private async executeHook(
    hook: Hook,
    event: HookEventName,
    payload: HookEventPayload
  ): Promise<HookExecutionResult> {
    const startTime = Date.now()

    // Check if hook is enabled
    if (!hook.enabled) {
      return {
        hook,
        event,
        payload,
        conditionsMatched: false,
        skipped: true,
        actionResults: [],
        success: true,
        duration: Date.now() - startTime,
        executedAt: new Date(),
      }
    }

    // Check if hook is scoped to a specific project
    const eventProjectId = (payload as { projectId?: string }).projectId
    if (hook.projectId && eventProjectId && hook.projectId !== eventProjectId) {
      return {
        hook,
        event,
        payload,
        conditionsMatched: false,
        skipped: true,
        actionResults: [],
        success: true,
        duration: Date.now() - startTime,
        executedAt: new Date(),
      }
    }

    // Evaluate conditions
    const conditionsMatched = this.evaluateConditions(hook.conditions || [], payload)

    if (!conditionsMatched) {
      return {
        hook,
        event,
        payload,
        conditionsMatched: false,
        skipped: true,
        actionResults: [],
        success: true,
        duration: Date.now() - startTime,
        executedAt: new Date(),
      }
    }

    // Execute actions
    const context: HookExecutionContext = {
      event,
      payload,
      hook,
      workspacePath: this.workspacePath,
      pmoPath: this.pmoPath,
      log: this.log,
    }

    const actionResults: HookActionResult[] = []
    let allActionsSucceeded = true

    for (const action of hook.actions) {
      const actionResult = await this.executeAction(action, context)
      actionResults.push(actionResult)
      if (!actionResult.success) {
        allActionsSucceeded = false
      }
    }

    return {
      hook,
      event,
      payload,
      conditionsMatched: true,
      skipped: false,
      actionResults,
      success: allActionsSucceeded,
      duration: Date.now() - startTime,
      executedAt: new Date(),
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction(
    action: HookAction,
    context: HookExecutionContext
  ): Promise<HookActionResult> {
    const startTime = Date.now()

    try {
      const output = await executeAction(action, context)
      return {
        success: true,
        action,
        output,
        duration: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        action,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      }
    }
  }

  // ===========================================================================
  // Condition Evaluation
  // ===========================================================================

  /**
   * Evaluate all conditions against a payload
   * Returns true if ALL conditions match (AND logic)
   */
  evaluateConditions(conditions: HookCondition[], payload: HookEventPayload): boolean {
    if (conditions.length === 0) {
      return true
    }

    for (const condition of conditions) {
      if (!this.evaluateCondition(condition, payload)) {
        return false
      }
    }

    return true
  }

  /**
   * Evaluate a single condition against a payload
   */
  private evaluateCondition(condition: HookCondition, payload: HookEventPayload): boolean {
    const actualValue = this.getFieldValue(condition.field, payload)
    return this.compareValues(actualValue, condition.operator, condition.value)
  }

  /**
   * Get a field value from the payload using dot notation
   * e.g., "ticket.priority" or "toColumn"
   */
  private getFieldValue(field: string, payload: HookEventPayload): unknown {
    const parts = field.split('.')
    let value: unknown = payload

    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined
      }
      value = (value as Record<string, unknown>)[part]
    }

    return value
  }

  /**
   * Compare values using the specified operator
   */
  private compareValues(
    actual: unknown,
    operator: ConditionOperator,
    expected: string | string[] | number | boolean
  ): boolean {
    switch (operator) {
      case 'equals':
        return actual === expected

      case 'not_equals':
        return actual !== expected

      case 'contains':
        if (typeof actual === 'string' && typeof expected === 'string') {
          return actual.includes(expected)
        }
        if (Array.isArray(actual) && (typeof expected === 'string' || typeof expected === 'number' || typeof expected === 'boolean')) {
          return actual.includes(expected)
        }
        return false

      case 'not_contains':
        if (typeof actual === 'string' && typeof expected === 'string') {
          return !actual.includes(expected)
        }
        if (Array.isArray(actual) && (typeof expected === 'string' || typeof expected === 'number' || typeof expected === 'boolean')) {
          return !actual.includes(expected)
        }
        return true

      case 'starts_with':
        if (typeof actual === 'string' && typeof expected === 'string') {
          return actual.startsWith(expected)
        }
        return false

      case 'ends_with':
        if (typeof actual === 'string' && typeof expected === 'string') {
          return actual.endsWith(expected)
        }
        return false

      case 'matches':
        if (typeof actual === 'string' && typeof expected === 'string') {
          try {
            return new RegExp(expected).test(actual)
          } catch {
            return false
          }
        }
        return false

      case 'in':
        if (Array.isArray(expected)) {
          // Cast expected to any[] to allow comparison with any type
          return (expected as unknown[]).includes(actual)
        }
        return false

      case 'not_in':
        if (Array.isArray(expected)) {
          // Cast expected to any[] to allow comparison with any type
          return !(expected as unknown[]).includes(actual)
        }
        return true

      default:
        return false
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let globalHooksManager: HooksManager | null = null

/**
 * Get or create the global hooks manager instance
 */
export function getHooksManager(options?: {
  workspacePath: string
  pmoPath: string
  log?: (message: string) => void
}): HooksManager {
  if (!globalHooksManager && options) {
    globalHooksManager = new HooksManager(options)
  }
  if (!globalHooksManager) {
    throw new Error('HooksManager not initialized. Call with options first.')
  }
  return globalHooksManager
}

/**
 * Reset the global hooks manager (for testing)
 */
export function resetHooksManager(): void {
  globalHooksManager = null
}

/**
 * Check if hooks manager is initialized
 */
export function isHooksManagerInitialized(): boolean {
  return globalHooksManager !== null
}
