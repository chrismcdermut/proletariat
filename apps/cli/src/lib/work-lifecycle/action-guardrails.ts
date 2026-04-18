/**
 * Action-Level Guardrails (PRLT-1317)
 *
 * Validates that an action can be invoked from the ticket's current state.
 * Enforcement is consistent across all callers: work verbs, action run,
 * hooks, action chaining, and SDK.
 *
 * Each action has an optional `valid_from` field — a JSON array of intent
 * names (e.g. ['ready', 'backlog', 'started']). If the array is non-empty,
 * the ticket's current state must match one of the intents for the action
 * to proceed. An empty or null `valid_from` means "any state".
 *
 * The `--force` flag bypasses the check.
 */

import type { WorkAction } from '../pmo/types.js'
import type { StateCategory } from '../pmo/types.js'
import { DEFAULT_INTENTS } from '../providers/state-intents.js'

/**
 * Result of validating an action invocation against the ticket's current state.
 */
export interface ActionGuardrailResult {
  /** Whether the action is allowed to proceed */
  allowed: boolean
  /** If blocked, the reason message */
  message?: string
  /** The resolved intent of the ticket's current state */
  resolvedIntent?: string
}

/**
 * Map from StateCategory to the closest canonical intent name.
 * Used as a fallback when statusName doesn't match any intent alias.
 */
const CATEGORY_TO_INTENT: Partial<Record<StateCategory, string>> = {
  backlog: 'backlog',
  unstarted: 'ready',
  started: 'started',
  completed: 'completed',
  canceled: 'dropped',
  triage: 'backlog',
}

/**
 * Resolve a ticket's current state to an intent name.
 *
 * Resolution order:
 * 1. Match statusName against DEFAULT_INTENTS aliases (case-insensitive)
 * 2. Fall back to CATEGORY_TO_INTENT mapping from statusCategory
 *
 * Returns null if no intent can be resolved.
 */
export function resolveTicketIntent(
  statusName: string | undefined,
  statusCategory: StateCategory | undefined,
): string | null {
  // 1. Try matching statusName against intent aliases
  if (statusName) {
    const lower = statusName.toLowerCase()
    for (const intent of DEFAULT_INTENTS) {
      for (const alias of intent.aliases) {
        if (alias.toLowerCase() === lower) {
          return intent.name
        }
      }
    }
  }

  // 2. Fall back to category mapping
  if (statusCategory) {
    return CATEGORY_TO_INTENT[statusCategory] ?? null
  }

  return null
}

/**
 * Validate whether an action can be invoked given the ticket's current state.
 *
 * @param action - The action to validate
 * @param statusName - The ticket's current status name (e.g. "In Progress", "Review")
 * @param statusCategory - The ticket's current status category (e.g. "started", "backlog")
 * @param force - Whether to bypass the guardrail (--force flag)
 * @returns ActionGuardrailResult indicating whether the action is allowed
 */
export function validateActionState(
  action: WorkAction,
  statusName: string | undefined,
  statusCategory: StateCategory | undefined,
  force: boolean = false,
): ActionGuardrailResult {
  // --force bypasses all guardrails
  if (force) {
    return { allowed: true }
  }

  // No valid_from constraint — action can run from any state
  if (!action.validFrom || action.validFrom.length === 0) {
    return { allowed: true }
  }

  // Resolve the ticket's current state to an intent
  const resolvedIntent = resolveTicketIntent(statusName, statusCategory)

  // If we can't resolve the intent, allow the action (don't block on unknown states)
  if (!resolvedIntent) {
    return { allowed: true, resolvedIntent: undefined }
  }

  // Check if the resolved intent is in the valid_from list
  if (action.validFrom.includes(resolvedIntent)) {
    return { allowed: true, resolvedIntent }
  }

  // Blocked — build a human-readable message
  const validStates = action.validFrom.join(', ')
  const currentState = statusName ? `"${statusName}" (${resolvedIntent})` : resolvedIntent
  const message =
    `Action "${action.name}" cannot run from state ${currentState}. ` +
    `Valid states: [${validStates}]. Use --force to override.`

  return { allowed: false, message, resolvedIntent }
}
