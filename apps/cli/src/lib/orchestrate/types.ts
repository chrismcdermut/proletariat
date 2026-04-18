/**
 * Orchestrate Types
 *
 * Defines events, hook modes, actions, and presets for the orchestrate daemon.
 * The orchestrate system extends the existing work-lifecycle hooks with
 * built-in actions and HITL (human-in-the-loop) controls.
 */

// =============================================================================
// Orchestrator Events
// =============================================================================

/**
 * All events the orchestrate daemon can react to.
 * Extends the existing HookableEvent set with CI/PR/agent lifecycle events.
 */
export type OrchestrateEvent =
  // Existing work-lifecycle events
  | 'work:started'
  | 'work:status_changed'
  | 'work:pr_created'
  | 'work:pr_merged'
  | 'work:pr_closed'
  | 'work:completed'
  | 'agent:spawned'
  | 'agent:stopped'
  // New orchestrator events
  | 'on_ci_green'
  | 'on_ci_failed'
  | 'on_pr_opened'
  | 'on_pr_merged'
  | 'on_pr_conflicting'
  | 'on_ticket_ready'
  | 'on_agent_spawned'
  | 'on_agent_died'
  | 'on_agent_completed'
  | 'on_agent_idle'
  | 'on_review_approved'
  | 'on_changes_requested'
  | 'on_version_published'

/** All valid orchestrate event names. */
export const ORCHESTRATE_EVENTS: OrchestrateEvent[] = [
  'work:started',
  'work:status_changed',
  'work:pr_created',
  'work:pr_merged',
  'work:pr_closed',
  'work:completed',
  'agent:spawned',
  'agent:stopped',
  'on_ci_green',
  'on_ci_failed',
  'on_pr_opened',
  'on_pr_merged',
  'on_pr_conflicting',
  'on_ticket_ready',
  'on_agent_spawned',
  'on_agent_died',
  'on_agent_completed',
  'on_agent_idle',
  'on_review_approved',
  'on_changes_requested',
  'on_version_published',
]

// =============================================================================
// Hook Modes (re-exported from work-lifecycle hooks for backward compatibility)
// =============================================================================

// Import locally so types in this file can reference HookMode
import type { HookMode as _HookMode } from '../work-lifecycle/hooks/types.js'
export type HookMode = _HookMode
export { HOOK_MODES } from '../work-lifecycle/hooks/types.js'

// =============================================================================
// Built-in Actions
// =============================================================================

/**
 * Built-in orchestrate actions.
 * These are first-class actions the daemon knows how to execute natively.
 */
export type BuiltinAction =
  | 'merge-pr'
  | 'move-ticket'
  | 'rebase-conflicting-prs'
  | 'spawn-agent'
  | 'respawn'
  | 'notify'
  | 'cleanup-container'
  | 'spawn-fix-agent'
  | 'spawn-review-agent'
  | 'health-check'
  | 'resolve-conflict'
  | 'gc-sweep'
  | 'poke-orchestrator'

/** All valid built-in action names. */
export const BUILTIN_ACTIONS: BuiltinAction[] = [
  'merge-pr',
  'move-ticket',
  'rebase-conflicting-prs',
  'spawn-agent',
  'respawn',
  'notify',
  'cleanup-container',
  'spawn-fix-agent',
  'spawn-review-agent',
  'health-check',
  'resolve-conflict',
  'gc-sweep',
  'poke-orchestrator',
]

// =============================================================================
// Hook Configuration (YAML shape)
// =============================================================================

/**
 * A single hook entry as defined in hooks.yml.
 */
export interface HookYamlEntry {
  action: string
  mode: HookMode
  max_retries?: number
  args?: Record<string, string>
}

/**
 * The full hooks.yml file shape.
 * Keys are event names, values are arrays of hook entries.
 */
export type HooksYaml = Record<string, HookYamlEntry[]>

// =============================================================================
// Workflow Configuration (YAML shape)
// =============================================================================

/**
 * The .proletariat/workflow.yml file shape.
 */
export interface WorkflowYaml {
  branches?: {
    target?: string
    strategy?: 'squash' | 'merge' | 'rebase'
  }
  on_implement_complete?: string[]
  on_review_complete?: string[]
  review?: {
    required?: boolean | 'auto'
    auto_merge_on_green?: boolean
  }
}

// =============================================================================
// Presets
// =============================================================================

/**
 * Preset name for quick hook configuration.
 */
export type PresetName = 'aggressive' | 'conservative' | 'supervised'

/** All valid preset names. */
export const PRESET_NAMES: PresetName[] = ['aggressive', 'conservative', 'supervised']

/**
 * Event context passed to hook handlers at runtime.
 */
export interface OrchestrateEventContext {
  event: string
  ticket?: string
  pr?: number
  branch?: string
  agent?: string
  container?: string
  executionId?: string
  prUrl?: string
  projectId?: string
  [key: string]: unknown
}

/**
 * Result of running a single orchestrate hook action.
 */
export interface OrchestrateActionResult {
  action: string
  success: boolean
  error?: string
  durationMs: number
  skipped?: boolean
  awaitingConfirmation?: boolean
  /** True when hook is queued for LLM decision (Tier 2) */
  awaitingLlmDecision?: boolean
  /** True when hook was escalated from LLM to human (Tier 2 → Tier 3) */
  escalatedToHuman?: boolean
  /** The decision tier that handled this hook */
  tier?: import('../work-lifecycle/hooks/types.js').DecisionTier
}
