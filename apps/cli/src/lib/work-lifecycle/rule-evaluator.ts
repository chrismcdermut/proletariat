/**
 * Workflow Rule Evaluator
 *
 * Subscribes to ticket:status_changed events on the global EventBus and
 * evaluates workflow rules when a ticket enters a new state.
 *
 * Rules use intent-based matching (from_intent/to_intent). The evaluator
 * maps provider state names to intents before querying rules.
 *
 * For on_enter rules, emits a work:rule_matched event so that
 * downstream systems (orchestrators, hooks) can fire the associated action.
 * For manual rules, the match is logged but no action is auto-fired.
 */

import type Database from 'better-sqlite3'
import { getEventBus } from '../events/event-bus.js'
import type { TicketStatusChangedEvent } from '../events/events.js'
import { PMO_TABLES } from '../pmo/schema.js'
import type { WorkflowRuleTrigger } from '../pmo/types.js'
import { DEFAULT_INTENTS } from '../providers/state-intents.js'

interface WorkflowRuleRow {
  id: string
  from_intent: string | null
  to_intent: string
  action_id: string
  trigger: string
  enabled: number
}

/**
 * Map a provider state name to its canonical intent name.
 * Uses the DEFAULT_INTENTS aliases for resolution.
 */
function stateNameToIntent(stateName: string): string | null {
  const lower = stateName.toLowerCase()
  for (const intent of DEFAULT_INTENTS) {
    if (intent.aliases.some(a => a.toLowerCase() === lower)) {
      return intent.name
    }
  }
  return null
}

export class WorkflowRuleEvaluator {
  private unsubscribers: Array<() => void> = []
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  /**
   * Start listening for ticket state changes.
   */
  start(): void {
    const bus = getEventBus()

    this.unsubscribers.push(
      bus.on('ticket:status_changed', (event: TicketStatusChangedEvent) => {
        this.evaluate(event)
      }),
    )
  }

  /**
   * Stop listening for events.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
  }

  /**
   * Evaluate workflow rules for a status change event.
   * Maps state names to intents, then finds matching intent-based rules.
   */
  private evaluate(event: TicketStatusChangedEvent): void {
    if (!event.newStatusName) return

    try {
      // Map the new state name to an intent
      const toIntent = stateNameToIntent(event.newStatusName)
      if (!toIntent) return

      // Map the previous state name to an intent (for from_intent matching)
      const fromIntent = event.previousStatusName
        ? stateNameToIntent(event.previousStatusName)
        : null

      // Find all enabled rules where to_intent matches
      const rows = this.db.prepare(`
        SELECT * FROM ${PMO_TABLES.workflow_rules}
        WHERE to_intent = ? AND enabled = 1
      `).all(toIntent) as WorkflowRuleRow[]

      if (rows.length === 0) return

      const bus = getEventBus()

      for (const row of rows) {
        // If from_intent is set, it must match the previous intent
        if (row.from_intent && row.from_intent !== fromIntent) {
          continue
        }

        // Emit rule_matched event for on_enter triggers
        if (row.trigger === 'on_enter') {
          bus.emit('workflow_rule:matched', {
            ruleId: row.id,
            ticketId: event.ticketId,
            projectId: event.projectId,
            actionId: row.action_id,
            trigger: row.trigger as WorkflowRuleTrigger,
            fromIntent: row.from_intent,
            toIntent: row.to_intent,
            timestamp: new Date(),
          })
        }
      }
    } catch {
      // Rule evaluation errors are non-fatal
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _evaluator: WorkflowRuleEvaluator | undefined

/**
 * Initialize and start the workflow rule evaluator.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initWorkflowRuleEvaluator(db: Database.Database): WorkflowRuleEvaluator {
  if (!_evaluator) {
    _evaluator = new WorkflowRuleEvaluator(db)
    _evaluator.start()
  }
  return _evaluator
}

/**
 * Stop the workflow rule evaluator (primarily for testing).
 */
export function stopWorkflowRuleEvaluator(): void {
  if (_evaluator) {
    _evaluator.stop()
    _evaluator = undefined
  }
}
