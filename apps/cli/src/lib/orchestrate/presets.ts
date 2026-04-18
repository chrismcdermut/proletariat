/**
 * Orchestrate Presets
 *
 * Pre-configured hook sets for common automation levels.
 * Maps to the 3-tier supervision tree:
 *
 * - aggressive: all auto (Tier 1) — no decision needed
 * - supervised: safe=auto (Tier 1), destructive=llm (Tier 2)
 * - conservative: safe=auto (Tier 1), destructive=human (Tier 3)
 */

import type { HookMode, OrchestrateEvent, PresetName } from './types.js'
import type { HookActionType } from '../work-lifecycle/hooks/types.js'

interface PresetHook {
  event: OrchestrateEvent
  action: string
  mode: HookMode
  /** Action type override (defaults to 'action' for direct dispatch) */
  actionType?: HookActionType
  config?: Record<string, unknown>
}

interface PresetDefinition {
  name: PresetName
  description: string
  hooks: PresetHook[]
}

/** Default poke-orchestrator template used to notify the orchestrator session. */
const POKE_ORCHESTRATOR_TEMPLATE = '{event}: ticket={ticket_id} pr=#{pr_number} agent={agent_name} — {summary}'

/** Events that should poke the orchestrator. */
const POKE_ORCHESTRATOR_EVENTS: OrchestrateEvent[] = [
  'on_pr_opened',
  'on_ci_green',
  'on_ci_failed',
  'on_agent_completed',
  'on_agent_died',
]

const SHARED_HOOKS: Array<{ event: OrchestrateEvent; action: string; actionType?: HookActionType; config?: Record<string, unknown> }> = [
  // PR lifecycle
  { event: 'on_ci_green', action: 'merge-pr' },
  { event: 'on_pr_merged', action: 'move-ticket', config: { target: 'done' } },
  { event: 'on_pr_opened', action: 'move-ticket', config: { target: 'review' } },
  { event: 'on_pr_opened', action: 'spawn-review-agent' },
  { event: 'on_pr_merged', action: 'rebase-conflicting-prs' },
  { event: 'on_pr_conflicting', action: 'resolve-conflict' },
  // Ticket lifecycle
  { event: 'on_ticket_ready', action: 'spawn-agent' },
  // Agent lifecycle (PRLT-1224: full loop — spawned→in-progress, completed→review, died→ready)
  { event: 'on_agent_spawned', action: 'move-ticket', config: { target: 'in-progress' } },
  { event: 'on_agent_completed', action: 'move-ticket', config: { target: 'review' } },
  { event: 'on_agent_completed', action: 'cleanup-container' },
  { event: 'on_agent_died', action: 'move-ticket', config: { target: 'ready' } },
  { event: 'on_agent_died', action: 'respawn', config: { max_retries: 2 } },
  { event: 'on_agent_died', action: 'notify' },
  { event: 'on_agent_idle', action: 'health-check' },
  { event: 'on_agent_idle', action: 'gc-sweep' },
  // Review lifecycle
  { event: 'on_review_approved', action: 'notify' },
  { event: 'on_changes_requested', action: 'spawn-fix-agent' },
  { event: 'on_changes_requested', action: 'notify' },
  // CI lifecycle
  { event: 'on_ci_failed', action: 'notify' },
  { event: 'on_ci_failed', action: 'spawn-fix-agent' },
  // Periodic cleanup
  { event: 'on_agent_completed', action: 'gc-sweep' },
  // Poke orchestrator — shared action definition referenced by multiple events
  ...POKE_ORCHESTRATOR_EVENTS.map(event => ({
    event,
    action: 'poke-orchestrator',
    actionType: 'poke' as HookActionType,
    config: { target: 'orchestrator-main', template: POKE_ORCHESTRATOR_TEMPLATE },
  })),
]

/**
 * Safe actions that can be auto-executed even in supervised mode.
 *
 * Actions that spawn agents/containers (spawn-agent, respawn, spawn-fix-agent,
 * resolve-conflict) are NOT safe — they create external resources and must
 * require confirmation in supervised mode.
 *
 * Exception: spawn-review-agent IS safe because review agents are non-destructive
 * — they only read diffs and post review comments (read-only permission mode).
 */
const SAFE_ACTIONS = new Set([
  'move-ticket',
  'notify',
  'cleanup-container',
  'health-check',
  'rebase-conflicting-prs',
  'spawn-review-agent',
  'gc-sweep',
])

export const PRESETS: Record<PresetName, PresetDefinition> = {
  aggressive: {
    name: 'aggressive',
    description: 'Auto everything — Tier 1 only, no decisions needed',
    hooks: SHARED_HOOKS.map(h => ({
      ...h,
      mode: 'auto' as HookMode,
    })),
  },

  conservative: {
    name: 'conservative',
    description: 'Safe=auto (Tier 1), destructive=human (Tier 3)',
    hooks: SHARED_HOOKS.map(h => ({
      ...h,
      mode: (SAFE_ACTIONS.has(h.action) ? 'auto' : 'human') as HookMode,
    })),
  },

  supervised: {
    name: 'supervised',
    description: 'Safe=auto (Tier 1), destructive=llm (Tier 2)',
    hooks: SHARED_HOOKS.map(h => ({
      ...h,
      mode: (SAFE_ACTIONS.has(h.action) ? 'auto' : 'llm') as HookMode,
    })),
  },
}

/**
 * Get a preset definition by name.
 */
export function getPreset(name: PresetName): PresetDefinition {
  return PRESETS[name]
}
