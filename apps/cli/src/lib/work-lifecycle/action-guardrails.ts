/**
 * Action-Level Guardrails
 *
 * Validates that an action can be invoked from the ticket's current state.
 * Actions declare valid_from (array of intent names) to restrict which
 * states they can run from. If valid_from is empty/null, the action
 * can run from any state.
 *
 * The same check runs for all callers: work verb, action run, hook, SDK.
 * A --force flag bypasses the check.
 *
 * PRLT-1317
 */

import type Database from 'better-sqlite3'
import { DEFAULT_INTENTS } from '../providers/state-intents.js'
import { TransitionMapStore } from '../providers/transition-map.js'

/**
 * Result of validating an action's state guardrail.
 */
export interface ActionGuardrailResult {
  allowed: boolean
  currentIntent: string | null
  validFrom: string[]
  message?: string
}

/**
 * Resolve a ticket's current status name to a canonical intent.
 *
 * Resolution order:
 * 1. Transition map (explicit user-confirmed mappings, reversed)
 * 2. DEFAULT_INTENTS alias matching (case-insensitive)
 * 3. statusCategory fallback
 */
export function resolveTicketIntent(
  db: Database.Database | null,
  statusName: string | undefined,
  statusCategory: string | undefined,
  providerName?: string,
): string | null {
  // 1. Reverse lookup in transition_map
  if (db && providerName) {
    try {
      const store = new TransitionMapStore(db)
      const mappings = store.listMappings(providerName)
      for (const mapping of mappings) {
        if (mapping.providerStateName.toLowerCase() === statusName?.toLowerCase()) {
          return mapping.intent
        }
      }
    } catch {
      // Table may not exist yet — fall through
    }
  }

  // 2. Match against DEFAULT_INTENTS aliases (case-insensitive)
  if (statusName) {
    const lower = statusName.toLowerCase()
    for (const intent of DEFAULT_INTENTS) {
      if (intent.aliases.some(a => a.toLowerCase() === lower)) {
        return intent.name
      }
    }
  }

  // 3. Fall back to statusCategory mapping
  if (statusCategory) {
    const categoryToIntent: Record<string, string> = {
      backlog: 'backlog',
      triage: 'backlog',
      unstarted: 'ready',
      started: 'started',
      completed: 'completed',
      canceled: 'dropped',
    }
    return categoryToIntent[statusCategory] ?? null
  }

  return null
}

/**
 * Validate that an action can be invoked from the ticket's current state.
 *
 * @param validFrom - Array of intent names the action accepts, or null/empty for any state
 * @param db - Database instance (for transition map lookup)
 * @param statusName - Ticket's current provider-specific status name
 * @param statusCategory - Ticket's status category
 * @param providerName - Provider name for transition map lookup
 * @param actionName - Action name (for error message)
 * @returns ActionGuardrailResult
 */
export function validateActionState(opts: {
  validFrom: string[] | undefined
  db: Database.Database | null
  statusName: string | undefined
  statusCategory: string | undefined
  providerName?: string
  actionName: string
}): ActionGuardrailResult {
  const { validFrom, db, statusName, statusCategory, providerName, actionName } = opts

  // No valid_from constraint — action can run from any state
  if (!validFrom || validFrom.length === 0) {
    return { allowed: true, currentIntent: null, validFrom: [] }
  }

  const currentIntent = resolveTicketIntent(db, statusName, statusCategory, providerName)

  // If we can't determine the current intent, allow the action
  // (graceful degradation — don't block on missing state info)
  if (!currentIntent) {
    return { allowed: true, currentIntent: null, validFrom }
  }

  // Check if current intent is in valid_from
  if (validFrom.includes(currentIntent)) {
    return { allowed: true, currentIntent, validFrom }
  }

  // Mismatch — refuse
  const validFromDisplay = validFrom.join(', ')
  return {
    allowed: false,
    currentIntent,
    validFrom,
    message: `Cannot run action "${actionName}" from state "${statusName || currentIntent}". ` +
      `Valid from: ${validFromDisplay}. Use --force to override.`,
  }
}
