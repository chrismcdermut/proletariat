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

interface PresetHook {
  event: OrchestrateEvent
  action: string
  actionType: 'action' | 'poke'
  mode: HookMode
  config?: Record<string, unknown>
}

interface PresetDefinition {
  name: PresetName
  description: string
  hooks: PresetHook[]
}

/**
 * Action type for shared hook definitions.
 * - 'action': resolve a named built-in action directly (no shell indirection)
 * - 'poke': send a message to a named session
 */
type SharedHookActionType = 'action' | 'poke'

interface SharedHook {
  event: OrchestrateEvent
  action: string
  actionType?: SharedHookActionType
  config?: Record<string, unknown>
}

const SHARED_HOOKS: SharedHook[] = [
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
  // Poke orchestrator — shared definition, fired from multiple events
  {
    event: 'on_pr_opened',
    action: 'poke-orchestrator',
    actionType: 'poke',
    config: {
      target: 'orchestrator-main',
      template: '{event}: {ticket_id} — PR #{pr_number} opened by {author}. Suggested: prlt work hooks list',
    },
  },
  {
    event: 'on_ci_green',
    action: 'poke-orchestrator',
    actionType: 'poke',
    config: {
      target: 'orchestrator-main',
      template: '{event}: {ticket_id} — CI green on PR #{pr_number}. Suggested: prlt work ship {ticket_id}',
    },
  },
  {
    event: 'on_ci_failed',
    action: 'poke-orchestrator',
    actionType: 'poke',
    config: {
      target: 'orchestrator-main',
      template: '{event}: {ticket_id} — CI failed on PR #{pr_number}. Suggested: prlt work start {ticket_id}',
    },
  },
  {
    event: 'on_agent_completed',
    action: 'poke-orchestrator',
    actionType: 'poke',
    config: {
      target: 'orchestrator-main',
      template: '{event}: {ticket_id} — Agent {agent_name} completed. Suggested: prlt work propose {ticket_id}',
    },
  },
  {
    event: 'on_agent_died',
    action: 'poke-orchestrator',
    actionType: 'poke',
    config: {
      target: 'orchestrator-main',
      template: '{event}: {ticket_id} — Agent {agent_name} died (exit {exit_code}). Suggested: prlt work start {ticket_id} --force',
    },
  },
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

/**
 * Poke-orchestrator is always safe (it just sends a message).
 */
const POKE_ACTIONS = new Set(['poke-orchestrator'])

function buildPresetHooks(modeForDestructive: HookMode): PresetHook[] {
  return SHARED_HOOKS.map(h => {
    const isSafe = SAFE_ACTIONS.has(h.action) || POKE_ACTIONS.has(h.action)
    return {
      ...h,
      actionType: (h.actionType || 'action') as 'action' | 'poke',
      mode: (isSafe ? 'auto' : modeForDestructive) as HookMode,
    }
  })
}

export const PRESETS: Record<PresetName, PresetDefinition> = {
  aggressive: {
    name: 'aggressive',
    description: 'Auto everything — Tier 1 only, no decisions needed',
    hooks: buildPresetHooks('auto'),
  },

  conservative: {
    name: 'conservative',
    description: 'Safe=auto (Tier 1), destructive=human (Tier 3)',
    hooks: buildPresetHooks('human'),
  },

  supervised: {
    name: 'supervised',
    description: 'Safe=auto (Tier 1), destructive=llm (Tier 2)',
    hooks: buildPresetHooks('llm'),
  },
}

/**
 * Get a preset definition by name.
 */
export function getPreset(name: PresetName): PresetDefinition {
  return PRESETS[name]
}
