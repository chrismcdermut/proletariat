/**
 * Workflow Rule Evaluator
 *
 * Subscribes to ticket:status_changed events on the global EventBus and
 * evaluates workflow rules when a ticket enters a new state.
 *
 * For on_enter rules, emits a work:rule_matched event so that
 * downstream systems (orchestrators, hooks) can fire the associated action.
 * For manual rules, the match is logged but no action is auto-fired.
 *
 * Rules use intent names (e.g., 'started', 'ready') not provider state names.
 * The evaluator resolves the ticket's new state name to an intent before matching.
 */

import type { SqliteDatabase } from '../database/sqlite.js'
import { getEventBus } from '../events/event-bus.js'
import type { TicketStatusChangedEvent } from '../events/events.js'
import { PMO_TABLES } from '../pmo/schema.js'
import type { WorkflowRuleTrigger } from '../pmo/types.js'
import { resolveStateToIntent } from '../providers/state-intents.js'

interface WorkflowRuleRow {
  id: string
  from_intent: string | null
  to_intent: string
  action_id: string
  trigger: string
  enabled: number
}

export class WorkflowRuleEvaluator {
  private unsubscribers: Array<() => void> = []
  private db: SqliteDatabase

  constructor(db: SqliteDatabase) {
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
   * Resolves the new state name to an intent, then finds matching rules.
   */
  private evaluate(event: TicketStatusChangedEvent): void {
    if (!event.newStatusName) return

    try {
      // Resolve provider state name → intent name
      const newIntent = resolveStateToIntent(event.newStatusName)
      if (!newIntent) return

      // Find all enabled rules where to_intent matches the resolved intent
      const rows = this.db.prepare(`
        SELECT * FROM ${PMO_TABLES.workflow_rules}
        WHERE to_intent = ? AND enabled = 1
      `).all(newIntent) as WorkflowRuleRow[]

      if (rows.length === 0) return

      const bus = getEventBus()

      // Resolve previous state name → intent for from_intent matching
      const prevIntent = event.previousStatusName
        ? resolveStateToIntent(event.previousStatusName)
        : null

      for (const row of rows) {
        // If from_intent is set, it must match the previous intent
        if (row.from_intent && row.from_intent !== prevIntent) {
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
export function initWorkflowRuleEvaluator(db: SqliteDatabase): WorkflowRuleEvaluator {
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
