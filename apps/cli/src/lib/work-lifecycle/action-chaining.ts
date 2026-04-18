/**
 * Action Chaining Handler
 *
 * Listens for workflow_rule:matched events on the EventBus and automatically
 * spawns the next agent action when an on_enter rule fires.
 *
 * Example chain:
 *   implement completes → lifecycle hook moves to Review →
 *   on_enter rule fires merge → ticket moves to Done
 *
 * Safety guards:
 * - Max chain depth of 5 per ticket to prevent infinite loops
 * - Skips if an agent is already running for the ticket
 * - Only fires on_enter rules (manual rules are user-initiated)
 * - Respects the enabled flag on rules
 */

import type Database from 'better-sqlite3'
import { getEventBus } from '../events/event-bus.js'
import type { WorkflowRuleMatchedEvent } from '../events/events.js'
import { PMO_TABLES } from '../pmo/schema.js'
import type { SQLiteStorage } from '../pmo/storage-sqlite.js'
import { ExecutionStorage } from '../execution/storage.js'
import { trackEvent } from '../telemetry/analytics.js'
import { validateActionState } from './action-guardrails.js'

// =============================================================================
// Constants
// =============================================================================

/** Maximum chain depth per ticket to prevent infinite loops. */
const MAX_CHAIN_DEPTH = 5

// =============================================================================
// Types
// =============================================================================

interface ActionRow {
  id: string
  name: string
  prompt: string
  end_prompt: string | null
  from_intent: string | null
  to_intent: string | null
  valid_from: string | null
  executor: string | null
  environment: string | null
  permission_mode: string | null
  model: string | null
  network_allowlist: string | null
}

// =============================================================================
// Handler
// =============================================================================

export class ActionChainingHandler {
  private unsubscribers: Array<() => void> = []
  private chainDepths = new Map<string, number>()
  private db: Database.Database
  private storage: SQLiteStorage
  private pmoPath: string
  private log: (msg: string) => void

  constructor(
    db: Database.Database,
    storage: SQLiteStorage,
    pmoPath: string,
    log?: (msg: string) => void,
  ) {
    this.db = db
    this.storage = storage
    this.pmoPath = pmoPath
    this.log = log ?? (() => {})
  }

  /**
   * Start listening for workflow rule matches.
   */
  start(): void {
    const bus = getEventBus()

    this.unsubscribers.push(
      bus.on('workflow_rule:matched', (event: WorkflowRuleMatchedEvent) => {
        void this.handleRuleMatched(event)
      }),
    )
  }

  /**
   * Stop listening for events and clean up.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
    this.chainDepths.clear()
  }

  /**
   * Handle a workflow rule match by spawning the next action in the chain.
   */
  private async handleRuleMatched(event: WorkflowRuleMatchedEvent): Promise<void> {
    const { ticketId, actionId, ruleId, trigger, toState } = event

    // Only fire on_enter rules — manual rules are user-initiated
    if (trigger !== 'on_enter') return

    // Check chain depth to prevent infinite loops
    const depth = this.chainDepths.get(ticketId) ?? 0
    if (depth >= MAX_CHAIN_DEPTH) {
      this.log(
        `[action-chain] Depth limit reached for ${ticketId} (depth=${depth}, max=${MAX_CHAIN_DEPTH}). Stopping chain.`,
      )
      trackEvent('action_chain_blocked', null, {
        ticket_id: ticketId,
        action_id: actionId,
        rule_id: ruleId,
        reason: 'max_depth',
        depth: String(depth),
      })
      return
    }

    // Check if an agent is already running for this ticket
    const executionStorage = new ExecutionStorage(this.db)
    const runningExec = executionStorage.getRunningExecution(ticketId)
    if (runningExec) {
      this.log(
        `[action-chain] Agent already running for ${ticketId} (execution=${runningExec.id}). Skipping chain.`,
      )
      trackEvent('action_chain_blocked', null, {
        ticket_id: ticketId,
        action_id: actionId,
        rule_id: ruleId,
        reason: 'agent_running',
      })
      return
    }

    // Look up the action
    const action = this.db
      .prepare(`SELECT * FROM ${PMO_TABLES.actions} WHERE id = ?`)
      .get(actionId) as ActionRow | undefined

    if (!action) {
      this.log(`[action-chain] Action ${actionId} not found. Skipping chain for ${ticketId}.`)
      return
    }

    // PRLT-1317: Validate action guardrails — check valid_from against ticket's current state
    let validFrom: string[] | undefined
    if (action.valid_from) {
      try { validFrom = JSON.parse(action.valid_from) } catch { /* ignore */ }
    }
    if (!validFrom?.length && action.from_intent) {
      validFrom = [action.from_intent]
    }
    if (validFrom?.length) {
      // toState in the event IS the ticket's current state (it just moved there)
      const currentIntent = toState
      if (currentIntent && !validFrom.includes(currentIntent)) {
        this.log(
          `[action-chain] Action "${action.name}" blocked: valid_from=[${validFrom.join(',')}] ` +
          `but ticket is in "${currentIntent}". Skipping.`
        )
        trackEvent('action_chain_blocked', null, {
          ticket_id: ticketId,
          action_id: actionId,
          rule_id: ruleId,
          reason: 'state_mismatch',
          valid_from: validFrom.join(','),
          current_state: currentIntent,
        })
        return
      }
    }

    // Increment chain depth before spawning
    this.chainDepths.set(ticketId, depth + 1)

    this.log(
      `[action-chain] Firing action "${action.name}" for ${ticketId} (rule=${ruleId}, state=${toState}, depth=${depth + 1})`,
    )

    // Spawn the agent
    try {
      await this.spawnChainedAction(ticketId, event.projectId, action)

      trackEvent('action_chain_fired', null, {
        ticket_id: ticketId,
        action_id: actionId,
        action_name: action.name,
        rule_id: ruleId,
        to_state: toState,
        chain_depth: String(depth + 1),
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.log(`[action-chain] Failed to spawn action "${action.name}" for ${ticketId}: ${errorMsg}`)

      trackEvent('action_chain_error', null, {
        ticket_id: ticketId,
        action_id: actionId,
        rule_id: ruleId,
        error: errorMsg,
      })

      // Roll back chain depth on failure so it can be retried
      this.chainDepths.set(ticketId, depth)
    }
  }

  /**
   * Spawn an agent to execute the chained action.
   * Lazily resolves workspace info and agent selection.
   */
  private async spawnChainedAction(
    ticketId: string,
    projectId: string,
    action: ActionRow,
  ): Promise<void> {
    // Lazy imports to avoid circular dependencies and reduce startup cost
    const { getWorkspaceInfo } = await import('../agents/commands.js')
    const { spawnAgentForTicket, getAvailableAgents } = await import('../execution/spawner.js')

    // Get workspace info (may throw if not in a workspace)
    const workspaceInfo = getWorkspaceInfo()

    // Get execution storage for agent availability check
    const executionStorage = new ExecutionStorage(this.db)

    // Get available agents
    const availableAgents = getAvailableAgents(workspaceInfo, executionStorage)
    if (availableAgents.length === 0) {
      this.log(`[action-chain] No agents available for ${ticketId}. Chain paused.`)
      return
    }

    // Select the first available agent
    const agentName = availableAgents[0]

    // Get the ticket
    const ticket = await this.storage.getTicket(ticketId)
    if (!ticket) {
      this.log(`[action-chain] Ticket ${ticketId} not found. Skipping.`)
      return
    }

    // Ensure projectId is set on ticket
    if (!ticket.projectId) {
      ticket.projectId = projectId
    }

    // Spawn the agent with the action's configuration
    // Note: chained actions always run in background mode
    const actionAllowlist = action.network_allowlist
      ? (JSON.parse(action.network_allowlist) as string[])
      : undefined
    const result = await spawnAgentForTicket(
      ticket,
      agentName,
      this.storage,
      executionStorage,
      workspaceInfo,
      this.db,
      this.pmoPath,
      {
        displayMode: 'background',
        log: (msg: string) => this.log(`[action-chain] ${msg}`),
        networkAllowlist: actionAllowlist,
      },
    )

    if (result.success) {
      this.log(
        `[action-chain] Spawned ${agentName} for ${ticketId} → action "${action.name}" (execution=${result.executionId})`,
      )
    } else {
      throw new Error(result.error || 'Unknown spawn error')
    }
  }

  /**
   * Get the current chain depth for a ticket (for testing/debugging).
   */
  getChainDepth(ticketId: string): number {
    return this.chainDepths.get(ticketId) ?? 0
  }

  /**
   * Reset chain depth for a ticket (e.g., when a ticket is manually moved).
   */
  resetChainDepth(ticketId: string): void {
    this.chainDepths.delete(ticketId)
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _handler: ActionChainingHandler | undefined

/**
 * Initialize and start the action chaining handler.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initActionChaining(
  db: Database.Database,
  storage: SQLiteStorage,
  pmoPath: string,
  log?: (msg: string) => void,
): ActionChainingHandler {
  if (!_handler) {
    _handler = new ActionChainingHandler(db, storage, pmoPath, log)
    _handler.start()
  }
  return _handler
}

/**
 * Stop the action chaining handler (primarily for testing).
 */
export function stopActionChaining(): void {
  if (_handler) {
    _handler.stop()
    _handler = undefined
  }
}
