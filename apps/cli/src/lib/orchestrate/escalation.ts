/**
 * 3-Tier Escalation Pipeline
 *
 * Routes hook actions through a 3-tier decision hierarchy:
 *
 * Tier 1 (auto): Deterministic — fires immediately, no decision needed.
 * Tier 2 (llm): LLM orchestrator decides — approve/deny/escalate.
 * Tier 3 (human): Human decides — final authority.
 *
 * Escalation flows upward: auto → llm → human.
 * Timeout on LLM response auto-escalates to human.
 */

import type { DecisionTier, LlmDecision } from '../work-lifecycle/hooks/types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Context provided to LLM and human decision-makers.
 */
export interface EscalationContext {
  /** The hook name requesting a decision */
  hookName: string
  /** The event that triggered the hook */
  event: string
  /** The action to be executed if approved */
  action: string
  /** Full event context (ticket, PR, branch, etc.) */
  ctx: Record<string, unknown>
  /** Optional per-hook config */
  config?: Record<string, unknown>
}

/**
 * A pending LLM decision queued when no onLlmDecision callback is provided.
 */
export interface PendingLlmDecision extends EscalationContext {
  /** When the decision was queued */
  queuedAt: number
  /** Timeout in ms after which the decision auto-escalates to human */
  timeoutMs: number
}

/**
 * A pending human escalation queued when no onHumanEscalation callback is provided.
 */
export interface PendingHumanEscalation extends EscalationContext {
  /** When the escalation was queued */
  queuedAt: number
  /** Reason for escalation (direct human-mode hook, LLM escalated, LLM timed out) */
  reason: EscalationReason
}

/**
 * Why a hook was escalated to human tier.
 */
export type EscalationReason =
  | 'direct'       // Hook is configured with mode=human
  | 'llm_escalate' // LLM responded with 'escalate'
  | 'llm_timeout'  // LLM decision timed out

/**
 * Callbacks for the escalation pipeline.
 */
export interface EscalationCallbacks {
  /**
   * Called when a Tier 2 (LLM) decision is needed.
   * Should return the LLM's decision: approve, deny, or escalate.
   * If not provided, decisions are queued in pendingLlmDecisions.
   */
  onLlmDecision?: (context: EscalationContext) => Promise<LlmDecision>

  /**
   * Called when a Tier 3 (human) decision is needed.
   * Should return true to approve, false to deny.
   * If not provided, decisions are queued in pendingHumanEscalations.
   */
  onHumanEscalation?: (context: EscalationContext, reason: EscalationReason) => Promise<boolean>
}

// =============================================================================
// Configuration
// =============================================================================

/** Default timeout for LLM decisions before auto-escalating to human (5 minutes). */
export const DEFAULT_LLM_TIMEOUT_MS = 5 * 60 * 1000

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Resolve a HookMode to its decision tier.
 *
 * - auto, notify → Tier 1 (auto)
 * - llm → Tier 2 (llm)
 * - confirm, human → Tier 3 (human)
 * - off → Tier 1 (auto) — handled separately as skip
 */
export function modeToTier(mode: string): DecisionTier {
  switch (mode) {
    case 'llm':
      return 'llm'
    case 'confirm':
    case 'human':
      return 'human'
    default:
      return 'auto'
  }
}

/**
 * Check if a pending LLM decision has timed out.
 */
export function isLlmDecisionTimedOut(decision: PendingLlmDecision, now: number = Date.now()): boolean {
  return (now - decision.queuedAt) >= decision.timeoutMs
}

/**
 * Get all timed-out LLM decisions from a list, returning them
 * as human escalations with reason 'llm_timeout'.
 */
export function getTimedOutLlmDecisions(
  decisions: PendingLlmDecision[],
  now: number = Date.now(),
): PendingHumanEscalation[] {
  return decisions
    .filter(d => isLlmDecisionTimedOut(d, now))
    .map(d => ({
      hookName: d.hookName,
      event: d.event,
      action: d.action,
      ctx: d.ctx,
      config: d.config,
      queuedAt: d.queuedAt,
      reason: 'llm_timeout' as EscalationReason,
    }))
}
