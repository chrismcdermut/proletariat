/**
 * Orchestrate Built-in Actions
 *
 * Implementations for the built-in hook actions that the orchestrate daemon
 * can execute. Each action receives an event context and returns a result.
 *
 * Actions use prlt CLI commands where possible to keep behavior consistent
 * with manual invocations.
 */

import { execSync } from 'node:child_process'
import type { OrchestrateEventContext, OrchestrateActionResult } from './types.js'

type ActionHandler = (ctx: OrchestrateEventContext, config?: Record<string, unknown>) => OrchestrateActionResult

/**
 * Merge a PR via `prlt work ship`.
 */
const mergePr: ActionHandler = (ctx, config) => {
  const start = Date.now()
  try {
    if (!ctx.ticket && !ctx.pr) {
      return { action: 'merge-pr', success: false, error: 'No ticket or PR number in context', durationMs: Date.now() - start }
    }

    const args: string[] = ['prlt', 'work', 'ship']
    if (ctx.ticket) args.push(ctx.ticket)
    if (ctx.pr) args.push('--pr', String(ctx.pr))
    args.push('--yes') // Skip confirmation

    execSync(args.join(' '), { timeout: 120_000, stdio: 'pipe' })
    return { action: 'merge-pr', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'merge-pr', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

/**
 * Move a ticket to a target status.
 */
const moveTicket: ActionHandler = (ctx, config) => {
  const start = Date.now()
  try {
    const target = (config?.target as string) || 'done'
    if (!ctx.ticket) {
      return { action: 'move-ticket', success: false, error: 'No ticket in context', durationMs: Date.now() - start }
    }

    execSync(`prlt ticket move ${ctx.ticket} "${target}"`, { timeout: 30_000, stdio: 'pipe' })
    return { action: 'move-ticket', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'move-ticket', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

/**
 * Rebase conflicting PRs after a merge.
 */
const rebaseConflictingPrs: ActionHandler = (ctx) => {
  const start = Date.now()
  try {
    execSync('prlt work rebase --all --yes 2>/dev/null || true', { timeout: 300_000, stdio: 'pipe' })
    return { action: 'rebase-conflicting-prs', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'rebase-conflicting-prs', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

/**
 * Spawn an agent for a ticket.
 */
const spawnAgent: ActionHandler = (ctx) => {
  const start = Date.now()
  try {
    if (!ctx.ticket) {
      return { action: 'spawn-agent', success: false, error: 'No ticket in context', durationMs: Date.now() - start }
    }

    execSync(`prlt work start ${ctx.ticket} --yes --display background`, { timeout: 60_000, stdio: 'pipe' })
    return { action: 'spawn-agent', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'spawn-agent', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

/**
 * Respawn a failed/died agent.
 */
const respawn: ActionHandler = (ctx, config) => {
  const start = Date.now()
  try {
    if (!ctx.ticket) {
      return { action: 'respawn', success: false, error: 'No ticket in context', durationMs: Date.now() - start }
    }

    execSync(`prlt work start ${ctx.ticket} --yes --display background --force`, { timeout: 60_000, stdio: 'pipe' })
    return { action: 'respawn', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'respawn', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

/**
 * Send a notification about an event.
 */
const notify: ActionHandler = (ctx) => {
  const start = Date.now()
  const parts: string[] = []
  if (ctx.event) parts.push(`[${ctx.event}]`)
  if (ctx.ticket) parts.push(`ticket=${ctx.ticket}`)
  if (ctx.pr) parts.push(`PR=#${ctx.pr}`)
  if (ctx.agent) parts.push(`agent=${ctx.agent}`)

  // eslint-disable-next-line no-console
  console.log(`[orchestrate:notify] ${parts.join(' ')}`)
  return { action: 'notify', success: true, durationMs: Date.now() - start }
}

/**
 * Clean up a container after agent completion.
 */
const cleanupContainer: ActionHandler = (ctx) => {
  const start = Date.now()
  try {
    if (!ctx.agent && !ctx.container) {
      return { action: 'cleanup-container', success: false, error: 'No agent or container in context', durationMs: Date.now() - start }
    }

    const target = ctx.container || ctx.agent
    execSync(`prlt docker rm ${target} --yes 2>/dev/null || true`, { timeout: 30_000, stdio: 'pipe' })
    return { action: 'cleanup-container', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'cleanup-container', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

/**
 * Spawn a fix agent after CI failure.
 */
const spawnFixAgent: ActionHandler = (ctx) => {
  const start = Date.now()
  try {
    if (!ctx.ticket) {
      return { action: 'spawn-fix-agent', success: false, error: 'No ticket in context', durationMs: Date.now() - start }
    }

    execSync(`prlt work start ${ctx.ticket} --action revise --yes --display background`, { timeout: 60_000, stdio: 'pipe' })
    return { action: 'spawn-fix-agent', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'spawn-fix-agent', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

/**
 * Health check / poke an idle agent.
 */
const healthCheck: ActionHandler = (ctx) => {
  const start = Date.now()
  try {
    if (!ctx.agent) {
      return { action: 'health-check', success: false, error: 'No agent in context', durationMs: Date.now() - start }
    }

    execSync(`prlt poke ${ctx.agent} "Are you still working? Please provide a status update."`, { timeout: 30_000, stdio: 'pipe' })
    return { action: 'health-check', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'health-check', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

/**
 * Resolve a merge conflict on a PR by poking the running agent or respawning a stopped one.
 * If the agent is running, it gets poked with a rebase instruction.
 * If the agent is stopped, it gets respawned with --action resolve.
 * No action is taken on PRs with no associated ticket.
 */
const resolveConflict: ActionHandler = (ctx) => {
  const start = Date.now()
  try {
    if (!ctx.ticket) {
      return { action: 'resolve-conflict', success: true, durationMs: Date.now() - start, skipped: true }
    }

    // Try poking the running agent first
    try {
      const pokeMsg = 'Your PR has merge conflicts. Please rebase on main and resolve the conflicts.'
      execSync(`prlt session poke ${ctx.ticket} "${pokeMsg}"`, { timeout: 30_000, stdio: 'pipe' })
      return { action: 'resolve-conflict', success: true, durationMs: Date.now() - start }
    } catch {
      // Poke failed — agent is likely not running, respawn it
    }

    // Respawn the agent with resolve action
    execSync(`prlt work start ${ctx.ticket} --action resolve --yes --display background`, { timeout: 60_000, stdio: 'pipe' })
    return { action: 'resolve-conflict', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'resolve-conflict', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

// =============================================================================
// Action Registry
// =============================================================================

/**
 * Registry of built-in action handlers.
 */
export const ACTION_HANDLERS: Record<string, ActionHandler> = {
  'merge-pr': mergePr,
  'move-ticket': moveTicket,
  'rebase-conflicting-prs': rebaseConflictingPrs,
  'spawn-agent': spawnAgent,
  'respawn': respawn,
  'notify': notify,
  'cleanup-container': cleanupContainer,
  'spawn-fix-agent': spawnFixAgent,
  'health-check': healthCheck,
  'resolve-conflict': resolveConflict,
}

/**
 * Execute a built-in action by name.
 */
export function executeBuiltinAction(
  actionName: string,
  ctx: OrchestrateEventContext,
  config?: Record<string, unknown>,
): OrchestrateActionResult {
  const handler = ACTION_HANDLERS[actionName]
  if (!handler) {
    return {
      action: actionName,
      success: false,
      error: `Unknown action: ${actionName}`,
      durationMs: 0,
    }
  }
  return handler(ctx, config)
}
