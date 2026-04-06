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
import * as path from 'node:path'
import * as fs from 'node:fs'
import type { OrchestrateEventContext, OrchestrateActionResult } from './types.js'
import { resolveWorkflowTarget } from '../work-lifecycle/settings.js'
import {
  executeCascade,
  detectZombieContainers,
  detectOrphanedWorktrees,
  detectStaleTmuxSessions,
  type CascadeTarget,
} from '../gc/cascade.js'
import { getEventBus } from '../events/event-bus.js'

type ActionHandler = (ctx: OrchestrateEventContext, config?: Record<string, unknown>) => OrchestrateActionResult

/**
 * Timeout for actions that spawn agents via `prlt work start`.
 * Container creation + clone + setup regularly exceeds 60s,
 * so we allow 180s to avoid ETIMEDOUT on the execSync call.
 */
export const AGENT_SPAWN_TIMEOUT_MS = 180_000

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
    execSync(args.join(' '), { timeout: 120_000, stdio: 'pipe' })
    return { action: 'merge-pr', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'merge-pr', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

/**
 * Move a ticket to a target status.
 *
 * Resolves intent-like targets (e.g. 'done', 'review') through the workflow
 * configuration so users with custom column names get the right mapping.
 */
const moveTicket: ActionHandler = (ctx, config) => {
  const start = Date.now()
  try {
    let target = (config?.target as string) || 'done'
    if (!ctx.ticket) {
      return { action: 'move-ticket', success: false, error: 'No ticket in context', durationMs: Date.now() - start }
    }

    // Resolve the target through workflow config (e.g. 'done' → 'Shipped')
    target = resolveTargetFromWorkspace(target)

    execSync(`prlt ticket move ${ctx.ticket} "${target}"`, { timeout: 30_000, stdio: 'pipe' })
    return { action: 'move-ticket', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'move-ticket', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

/**
 * Resolve a workflow target by opening the workspace DB and checking settings.
 * If the DB isn't available, returns the target as-is.
 */
function resolveTargetFromWorkspace(target: string): string {
  try {
    const dbPath = findWorkspaceDb()
    if (!dbPath) return target

    // Dynamic import to avoid circular dependencies — better-sqlite3 is always available at runtime
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    try {
      return resolveWorkflowTarget(db, target)
    } finally {
      db.close()
    }
  } catch {
    return target
  }
}

/**
 * Find the workspace.db by walking up from cwd looking for .proletariat/workspace.db.
 */
function findWorkspaceDb(): string | null {
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    const dbPath = path.join(dir, '.proletariat', 'workspace.db')
    if (fs.existsSync(dbPath)) return dbPath
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Rebase conflicting PRs after a merge.
 */
const rebaseConflictingPrs: ActionHandler = (ctx) => {
  const start = Date.now()
  try {
    execSync('prlt work rebase --all', { timeout: 300_000, stdio: 'pipe' })
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

    execSync(`prlt work start ${ctx.ticket} --yes --display background`, { timeout: AGENT_SPAWN_TIMEOUT_MS, stdio: 'pipe' })
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

    execSync(`prlt work start ${ctx.ticket} --yes --display background --force`, { timeout: AGENT_SPAWN_TIMEOUT_MS, stdio: 'pipe' })
    return { action: 'respawn', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'respawn', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

/**
 * Send a notification about an event.
 *
 * Dispatches through the notification layer if providers are configured.
 * Falls back to terminal stdout if no providers match.
 */
const notify: ActionHandler = (ctx) => {
  const start = Date.now()
  const parts: string[] = []
  if (ctx.event) parts.push(`[${ctx.event}]`)
  if (ctx.ticket) parts.push(`ticket=${ctx.ticket}`)
  if (ctx.pr) parts.push(`PR=#${ctx.pr}`)
  if (ctx.agent) parts.push(`agent=${ctx.agent}`)

  // Try to dispatch through NotificationManager if available
  try {
    // Dynamic import to avoid circular deps at module load time
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getNotificationManager } = require('../notifications/index.js')
    const manager = getNotificationManager()
    if (manager) {
      // Fire async but don't block the action handler
      void manager.fireEvent(ctx.event || 'notify', ctx)
      return { action: 'notify', success: true, durationMs: Date.now() - start }
    }
  } catch {
    // Notification layer not available — fall through to terminal
  }

  // Fallback: terminal notification
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
    execSync(`prlt docker stop ${target} --force`, { timeout: 30_000, stdio: 'pipe' })
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

    execSync(`prlt work start ${ctx.ticket} --action revise --yes --display background`, { timeout: AGENT_SPAWN_TIMEOUT_MS, stdio: 'pipe' })
    return { action: 'spawn-fix-agent', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'spawn-fix-agent', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

/**
 * Spawn a review agent for a PR.
 * Review agents are non-destructive — they read the diff and post comments.
 * Uses --action review to launch in read-only mode with the review role prompt.
 */
const spawnReviewAgent: ActionHandler = (ctx) => {
  const start = Date.now()
  try {
    if (!ctx.ticket) {
      return { action: 'spawn-review-agent', success: false, error: 'No ticket in context', durationMs: Date.now() - start }
    }

    execSync(`prlt work start ${ctx.ticket} --action review --yes --display background`, { timeout: AGENT_SPAWN_TIMEOUT_MS, stdio: 'pipe' })
    return { action: 'spawn-review-agent', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'spawn-review-agent', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
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
    execSync(`prlt work start ${ctx.ticket} --action resolve --yes --display background`, { timeout: AGENT_SPAWN_TIMEOUT_MS, stdio: 'pipe' })
    return { action: 'resolve-conflict', success: true, durationMs: Date.now() - start }
  } catch (err) {
    return { action: 'resolve-conflict', success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

/**
 * GC Sweep — periodic safety net for catching cleanup that events missed.
 *
 * Detects zombie containers, orphaned worktrees, stale tmux sessions,
 * and dangling branches. Triggers the same cascade as Tier 1 cleanup.
 * Fires agent:stopped events so hooks stay consistent.
 *
 * This is Tier 2 of the cleanup system — runs as a daemon action.
 */
const gcSweep: ActionHandler = (ctx) => {
  const start = Date.now()
  try {
    const hqPath = findHqPath()
    if (!hqPath) {
      return { action: 'gc-sweep', success: false, error: 'Could not find workspace HQ path', durationMs: Date.now() - start }
    }

    // Get active agent names from running executions
    const activeAgentNames = getActiveAgentNames()

    let cleaned = 0
    const bus = getEventBus()

    // 1. Detect and clean zombie containers
    const zombies = detectZombieContainers(activeAgentNames)
    for (const zombie of zombies) {
      const target: CascadeTarget = {
        agentName: zombie.agentName,
        containerId: zombie.containerId,
        hqPath,
      }

      executeCascade(target, { execute: true })

      // Emit agent:stopped so hooks stay consistent
      bus.emit('agent:stopped', {
        sessionId: `gc-sweep-${zombie.agentName}`,
        runner: 'gc-sweep',
        reason: 'error' as const,
        timestamp: new Date(),
      })

      cleaned++
    }

    // 2. Detect and clean orphaned worktrees
    const orphanedWorktrees = detectOrphanedWorktrees(hqPath, activeAgentNames)
    const processedAgents = new Set<string>()

    for (const orphan of orphanedWorktrees) {
      // Only cascade once per agent (an agent may have multiple worktrees)
      if (processedAgents.has(orphan.agentName)) continue
      processedAgents.add(orphan.agentName)

      const target: CascadeTarget = {
        agentName: orphan.agentName,
        worktreePath: orphan.worktreePath,
        sourceRepoPath: orphan.repoPath,
        branch: orphan.branch,
        hqPath,
      }

      executeCascade(target, { execute: true })
      cleaned++
    }

    // 3. Detect and clean stale tmux sessions
    const activeSessionIds = getActiveSessionIds()
    const staleSessions = detectStaleTmuxSessions(activeSessionIds)

    for (const stale of staleSessions) {
      // Only cascade if we haven't already processed this agent
      if (processedAgents.has(stale.agentName)) continue
      processedAgents.add(stale.agentName)

      const target: CascadeTarget = {
        agentName: stale.agentName,
        sessionId: stale.sessionName,
        hqPath,
      }

      executeCascade(target, { execute: true, killHostTmux: true })
      cleaned++
    }

    return {
      action: 'gc-sweep',
      success: true,
      durationMs: Date.now() - start,
      skipped: cleaned === 0,
    }
  } catch (err) {
    return {
      action: 'gc-sweep',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * Find HQ path by walking up from cwd looking for .proletariat directory.
 */
function findHqPath(): string | null {
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    const hqDir = path.join(dir, '.proletariat')
    if (fs.existsSync(hqDir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Get the set of agent names with active (running/starting) executions.
 */
function getActiveAgentNames(): Set<string> {
  const names = new Set<string>()
  try {
    const dbPath = findWorkspaceDb()
    if (!dbPath) return names

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    try {
      const rows = db.prepare(
        "SELECT DISTINCT agent_name FROM agent_work WHERE status IN ('running', 'starting')"
      ).all() as { agent_name: string }[]
      for (const row of rows) {
        names.add(row.agent_name)
      }
    } finally {
      db.close()
    }
  } catch {
    // Non-fatal
  }
  return names
}

/**
 * Get the set of session IDs for active executions.
 */
function getActiveSessionIds(): Set<string> {
  const ids = new Set<string>()
  try {
    const dbPath = findWorkspaceDb()
    if (!dbPath) return ids

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    try {
      const rows = db.prepare(
        "SELECT session_id FROM agent_work WHERE status IN ('running', 'starting') AND session_id IS NOT NULL"
      ).all() as { session_id: string }[]
      for (const row of rows) {
        ids.add(row.session_id)
      }
    } finally {
      db.close()
    }
  } catch {
    // Non-fatal
  }
  return ids
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
  'spawn-review-agent': spawnReviewAgent,
  'health-check': healthCheck,
  'resolve-conflict': resolveConflict,
  'gc-sweep': gcSweep,
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
