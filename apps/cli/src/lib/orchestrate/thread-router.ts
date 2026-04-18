/**
 * Orchestrator Thread Router (PRLT-1265)
 *
 * Routes daemon events to the correct orchestrator thread via tmux send-keys.
 * Messages are tagged with structured metadata so the orchestrator can
 * distinguish daemon-routed messages from human input.
 *
 * Message format:
 *   [daemon:event_name:ticket_id] Human-readable summary
 *   [notify:event_name] FYI-only notification
 *
 * Response flow:
 *   1. Daemon writes to pending_llm_decisions table
 *   2. Router formats + sends message to orchestrator via tmux
 *   3. Orchestrator reads context, generates response
 *   4. Hook callback picks up the response and routes to action execution
 *   5. Without orchestrator (timeout): escalates to human (tier 3)
 */

import { MachineDB, type OrchestratorThreadRecord, type PendingLlmDecisionRecord } from '../machine-db.js'
import type { EscalationContext } from './escalation.js'

// =============================================================================
// Message metadata types
// =============================================================================

export type MessageType = 'daemon' | 'notify'

export interface DaemonMessage {
  type: MessageType
  eventName: string
  ticketId?: string
  body: string
}

// =============================================================================
// Message formatting
// =============================================================================

/**
 * Format a daemon message with structured metadata prefix.
 *
 * Examples:
 *   [daemon:on_pr_conflicting:PRLT-1259] PR #1094 has conflicts on main.
 *   [notify:on_ci_failed] PR #1094 CI failed on e2e-tests.
 */
export function formatDaemonMessage(msg: DaemonMessage): string {
  const tag = msg.ticketId
    ? `[${msg.type}:${msg.eventName}:${msg.ticketId}]`
    : `[${msg.type}:${msg.eventName}]`
  return `${tag} ${msg.body}`
}

/**
 * Parse a metadata-tagged message back into its components.
 * Returns null if the message has no metadata tag (i.e. human input).
 */
export function parseDaemonMessage(raw: string): DaemonMessage | null {
  const match = raw.match(/^\[(daemon|notify):([^:\]]+)(?::([^\]]+))?\]\s*(.*)$/s)
  if (!match) return null
  return {
    type: match[1] as MessageType,
    eventName: match[2],
    ticketId: match[3] || undefined,
    body: match[4],
  }
}

// =============================================================================
// Thread routing
// =============================================================================

/**
 * Resolve which orchestrator thread should handle an event.
 * Opens and closes machine.db internally.
 *
 * @returns The thread record, or null if no thread handles this event.
 */
export function resolveThreadForEvent(eventName: string, dbPath?: string): OrchestratorThreadRecord | null {
  const machineDb = new MachineDB(dbPath)
  try {
    return machineDb.findThreadForEvent(eventName)
  } finally {
    machineDb.close()
  }
}

/**
 * Parse a thread address into its components.
 *
 * Address formats:
 *   "host:tmux:session-name"
 *   "container:abc123/tmux:session-name"
 */
export function parseThreadAddress(address: string): {
  environment: 'host' | 'container'
  containerId?: string
  sessionId: string
} {
  if (address.startsWith('container:')) {
    const rest = address.slice('container:'.length)
    const slashIdx = rest.indexOf('/tmux:')
    if (slashIdx === -1) {
      return { environment: 'container', containerId: rest, sessionId: rest }
    }
    return {
      environment: 'container',
      containerId: rest.substring(0, slashIdx),
      sessionId: rest.substring(slashIdx + '/tmux:'.length),
    }
  }
  // host:tmux:session-name
  const sessionId = address.replace(/^host:tmux:/, '')
  return { environment: 'host', sessionId }
}

/**
 * Build an escalation context into a formatted daemon message for the orchestrator.
 */
export function escalationToMessage(ctx: EscalationContext, decisionId?: string): DaemonMessage {
  const ticketId = (ctx.ctx?.ticketId as string) || undefined
  const parts = [`Hook "${ctx.hookName}" triggered by ${ctx.event}.`]
  parts.push(`Action: ${ctx.action}`)
  if (decisionId) {
    parts.push(`Decision ID: ${decisionId}`)
  }
  parts.push('Decision needed: approve, deny, or escalate?')

  return {
    type: 'daemon',
    eventName: ctx.event,
    ticketId,
    body: parts.join(' '),
  }
}

/**
 * Queue an escalation context as a pending LLM decision and return
 * the formatted message to send to the orchestrator.
 *
 * This is the main integration point between the hook manager's
 * LLM tier and the orchestrator thread system.
 */
export function queueAndFormatDecision(
  ctx: EscalationContext,
  dbPath?: string,
): { message: string; decision: PendingLlmDecisionRecord; thread: OrchestratorThreadRecord } | null {
  const machineDb = new MachineDB(dbPath)
  try {
    const thread = machineDb.findThreadForEvent(ctx.event)
    if (!thread) return null

    const decision = machineDb.createPendingLlmDecision({
      eventName: ctx.event,
      hookName: ctx.hookName,
      action: ctx.action,
      contextJson: JSON.stringify(ctx.ctx),
      orchestratorName: thread.name,
    })

    // Touch the thread to update last_seen
    machineDb.touchThread(thread.name)

    const msg = escalationToMessage(ctx, decision.id)
    return {
      message: formatDaemonMessage(msg),
      decision,
      thread,
    }
  } finally {
    machineDb.close()
  }
}
