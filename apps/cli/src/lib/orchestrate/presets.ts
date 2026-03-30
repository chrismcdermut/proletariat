/**
 * Orchestrate Presets
 *
 * Pre-configured hook sets for common automation levels.
 *
 * - aggressive: auto-everything — no human needed
 * - conservative: confirm everything — human approves all
 * - supervised: auto for safe ops, confirm for destructive
 */

import type { HookMode, OrchestrateEvent, PresetName } from './types.js'

interface PresetHook {
  event: OrchestrateEvent
  action: string
  mode: HookMode
  config?: Record<string, unknown>
}

interface PresetDefinition {
  name: PresetName
  description: string
  hooks: PresetHook[]
}

const SHARED_HOOKS: Array<{ event: OrchestrateEvent; action: string; config?: Record<string, unknown> }> = [
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
  // Review lifecycle
  { event: 'on_review_approved', action: 'notify' },
  { event: 'on_changes_requested', action: 'spawn-fix-agent' },
  { event: 'on_changes_requested', action: 'notify' },
  // CI lifecycle
  { event: 'on_ci_failed', action: 'notify' },
  { event: 'on_ci_failed', action: 'spawn-fix-agent' },
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
])

export const PRESETS: Record<PresetName, PresetDefinition> = {
  aggressive: {
    name: 'aggressive',
    description: 'Auto everything — no human needed',
    hooks: SHARED_HOOKS.map(h => ({
      ...h,
      mode: 'auto' as HookMode,
    })),
  },

  conservative: {
    name: 'conservative',
    description: 'Confirm everything — human approves all actions',
    hooks: SHARED_HOOKS.map(h => ({
      ...h,
      mode: 'confirm' as HookMode,
    })),
  },

  supervised: {
    name: 'supervised',
    description: 'Auto for safe ops, confirm for destructive actions',
    hooks: SHARED_HOOKS.map(h => ({
      ...h,
      mode: (SAFE_ACTIONS.has(h.action) ? 'auto' : 'confirm') as HookMode,
    })),
  },
}

/**
 * Get a preset definition by name.
 */
export function getPreset(name: PresetName): PresetDefinition {
  return PRESETS[name]
}
