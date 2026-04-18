/**
 * Action-Level Guardrails
 *
 * Validates that a ticket is in an allowed state before an action runs.
 * Enforcement is consistent across all callers: work verbs, action run,
 * workflow rule hooks, SDK, and the orchestrator.
 *
 * PRLT-1317: Action-level guardrails — validate invocation state regardless of caller.
 */

import type { WorkAction, StateCategory } from '../pmo/types.js'
import { DEFAULT_INTENTS } from '../providers/state-intents.js'

// =============================================================================
// Intent Resolution
// =============================================================================

/**
 * Map StateCategory values to canonical TransitionIntent names.
 * StateCategory and TransitionIntent overlap but aren't 1:1:
 *   triage     → backlog  (closest intent)
 *   backlog    → backlog
 *   unstarted  → ready
 *   started    → started  (may also be needs_review — resolved by alias match)
 *   completed  → completed
 *   canceled   → dropped
 */
const CATEGORY_TO_INTENT: Record<string, string> = {
  triage: 'backlog',
  backlog: 'backlog',
  unstarted: 'ready',
  started: 'started',
  completed: 'completed',
  canceled: 'dropped',
}

/**
 * Resolve a ticket's current state to a canonical intent name.
 *
 * Resolution order:
 * 1. Match statusName against DEFAULT_INTENTS aliases (most accurate)
 * 2. Map statusCategory to intent via CATEGORY_TO_INTENT
 * 3. Return statusCategory as-is (fallback)
 */
export function resolveTicketIntent(
  statusName: string | undefined,
  statusCategory: StateCategory | string | undefined,
): string | null {
  // 1. Try alias match on status name
  if (statusName) {
    const lower = statusName.toLowerCase()
    for (const intent of DEFAULT_INTENTS) {
      if (intent.aliases.some(a => a.toLowerCase() === lower)) {
        return intent.name
      }
    }
    // Also check direct intent name match (e.g. statusName is already "needs_review")
    const directMatch = DEFAULT_INTENTS.find(i => i.name === lower || i.name === statusName)
    if (directMatch) return directMatch.name
  }

  // 2. Map from statusCategory
  if (statusCategory) {
    const mapped = CATEGORY_TO_INTENT[statusCategory]
    if (mapped) return mapped
    return statusCategory
  }

  return null
}

// =============================================================================
// Validation
// =============================================================================

export interface GuardrailResult {
  allowed: boolean
  reason?: string
}

/**
 * Validate that an action is allowed to run given the ticket's current state.
 *
 * Rules:
 * - If action has no validFrom (empty or undefined), allow from any state.
 * - If the ticket's resolved intent matches any entry in validFrom, allow.
 * - Otherwise, refuse with a descriptive message.
 * - The `force` flag bypasses all checks.
 */
export function validateActionState(
  action: WorkAction,
  statusName: string | undefined,
  statusCategory: StateCategory | string | undefined,
  force?: boolean,
): GuardrailResult {
  // --force bypasses all guardrails
  if (force) {
    return { allowed: true }
  }

  // No valid_from constraint → any state is allowed
  if (!action.validFrom || action.validFrom.length === 0) {
    return { allowed: true }
  }

  const currentIntent = resolveTicketIntent(statusName, statusCategory)

  if (!currentIntent) {
    // Can't determine current state — allow (don't block on unknown state)
    return { allowed: true }
  }

  if (action.validFrom.includes(currentIntent)) {
    return { allowed: true }
  }

  return {
    allowed: false,
    reason:
      `Action "${action.name}" can only run from state [${action.validFrom.join(', ')}], ` +
      `but ticket is in "${statusName || currentIntent}". ` +
      `Use --force to override.`,
  }
}
