/**
 * Cascading Agent Cleanup
 *
 * Full 8-step cascade for cleaning up all resources associated with a stopped agent.
 * This module is shared by all three cleanup tiers:
 *   - Tier 1: Event-driven (agent:stopped handler)
 *   - Tier 2: Daemon GC sweep (periodic safety net)
 *   - Tier 3: Manual commands (prlt agent cleanup / prlt session prune)
 *
 * Cascade order:
 *   1. CC/Claude session (dies with container)
 *   2. Tmux session — tmux kill-session
 *   3. Container — docker rm -f
 *   4. Worktree — git worktree remove --force
 *   5. Agent directory — fs.rmSync
 *   6. Git branch — git branch -D + git push origin --delete
 *   7. Execution records — archive/delete
 *   8. DB agent status — mark 'cleaned'
 *
 * All steps are fire-and-forget: failures are logged but never block subsequent steps.
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  killTmuxInContainer,
  cleanClaudeSessionData,
  deleteRemoteBranch,
  markExecutionRecordsCleaned,
  recycleAgentNames,
} from './index.js'
import { removeContainer } from '../execution/container-cleanup.js'
import type { GCConfig } from './config.js'
import { GC_DEFAULTS } from './config.js'
import { parseSessionName } from '../execution/session-utils.js'

// =============================================================================
// Types
// =============================================================================

export interface CascadeTarget {
  /** Agent name */
  agentName: string
  /** Session ID (for tmux kill) */
  sessionId?: string
  /** Container ID (for docker rm) */
  containerId?: string
  /** Branch name (for git branch -D / push --delete) */
  branch?: string
  /** Worktree path */
  worktreePath?: string
  /** Source repo path (for git operations) */
  sourceRepoPath?: string
  /** HQ path (for DB operations) */
  hqPath?: string
  /** Agent directory path */
  agentDir?: string
  /** Execution environment */
  environment?: 'host' | 'docker' | 'devcontainer'
}

export interface CascadeResult {
  agentName: string
  steps: CascadeStepResult[]
  success: boolean
}

export interface CascadeStepResult {
  step: string
  success: boolean
  skipped: boolean
  error?: string
}

export interface CascadeOptions {
  /** Log callback */
  log?: (msg: string) => void
  /** Whether to actually execute (false = dry run) */
  execute?: boolean
  /** GC configuration overrides */
  config?: Partial<GCConfig>
  /** Whether to kill host tmux sessions (vs container only) */
  killHostTmux?: boolean
}

// =============================================================================
// Cascade Execution
// =============================================================================

/**
 * Execute the full cascading cleanup for a stopped agent.
 *
 * Each step is fire-and-forget: if one fails, the cascade continues.
 * Returns a detailed result showing what succeeded/failed/was-skipped.
 */
export function executeCascade(
  target: CascadeTarget,
  options: CascadeOptions = {},
): CascadeResult {
  const { log, execute = true } = options
  const cascadeConfig = {
    ...GC_DEFAULTS,
    ...options.config,
    cascade: { ...GC_DEFAULTS.cascade, ...options.config?.cascade },
    retention: { ...GC_DEFAULTS.retention, ...options.config?.retention },
  }

  const result: CascadeResult = {
    agentName: target.agentName,
    steps: [],
    success: true,
  }

  // Step 1: Clean Claude session data (dies with container, but clean explicitly first)
  result.steps.push(
    executeStep('claude-session', execute, log, () => {
      if (!target.containerId) return { skipped: true }
      cleanClaudeSessionData(target.containerId)
      return { success: true }
    }),
  )

  // Step 2: Kill tmux session
  result.steps.push(
    executeStep('tmux-session', execute, log, () => {
      if (!target.sessionId && !target.containerId) return { skipped: true }

      if (target.containerId) {
        // Kill tmux inside container
        killTmuxInContainer(target.containerId)
      }

      if (target.sessionId && options.killHostTmux) {
        // Kill host tmux session
        killHostTmuxSession(target.sessionId)
      }

      return { success: true }
    }),
  )

  // Step 3: Remove container
  result.steps.push(
    executeStep('container', execute, log, () => {
      if (!target.containerId) return { skipped: true }
      const rmResult = removeContainer(target.containerId)
      if (!rmResult.success) {
        return { success: false, error: rmResult.error }
      }
      return { success: true }
    }),
  )

  // Step 4: Remove worktree
  result.steps.push(
    executeStep('worktree', execute, log, () => {
      if (!target.worktreePath || !target.sourceRepoPath) return { skipped: true }
      removeWorktree(target.worktreePath, target.sourceRepoPath)
      return { success: true }
    }),
  )

  // Step 5: Remove agent directory
  result.steps.push(
    executeStep('agent-directory', execute, log, () => {
      if (!target.agentDir) return { skipped: true }
      if (!fs.existsSync(target.agentDir)) return { skipped: true }
      fs.rmSync(target.agentDir, { recursive: true, force: true })
      return { success: true }
    }),
  )

  // Step 6: Delete git branch (local + remote)
  result.steps.push(
    executeStep('git-branch', execute, log, () => {
      if (!target.branch) return { skipped: true }
      if (!cascadeConfig.cascade.branch) return { skipped: true }

      const cwd = target.sourceRepoPath || target.hqPath
      if (!cwd) return { skipped: true }

      // Delete local branch
      deleteLocalBranch(target.branch, cwd)
      // Delete remote branch
      if (!cascadeConfig.retention.keepBranchesAfterMerge) {
        deleteRemoteBranch(target.branch, cwd)
      }

      return { success: true }
    }),
  )

  // Step 7: Archive/delete execution records
  result.steps.push(
    executeStep('execution-records', execute, log, () => {
      if (!target.hqPath) return { skipped: true }
      if (!cascadeConfig.cascade.executionRecords) return { skipped: true }

      const marked = markExecutionRecordsCleaned(target.hqPath, [target.agentName])
      if (marked === 0) return { skipped: true }
      return { success: true }
    }),
  )

  // Step 8: Mark agent as 'cleaned' in DB
  result.steps.push(
    executeStep('db-status', execute, log, () => {
      if (!target.hqPath) return { skipped: true }
      const recycled = recycleAgentNames(target.hqPath, [target.agentName])
      if (recycled.length === 0) return { skipped: true }
      return { success: true }
    }),
  )

  // Overall success = no non-skipped failures
  result.success = result.steps.every(s => s.success || s.skipped)

  return result
}

// =============================================================================
// Zombie / Orphan Detection (for Tier 2 daemon sweep)
// =============================================================================

export interface ZombieContainer {
  containerId: string
  containerName: string
  agentName: string
}

/**
 * Detect zombie containers — running Docker containers with no active execution.
 * These are containers that were left behind when the agent died without cleanup.
 */
export function detectZombieContainers(
  activeAgentNames: Set<string>,
): ZombieContainer[] {
  const zombies: ZombieContainer[] = []

  try {
    const output = execSync(
      'docker ps --filter "name=prlt-agent-" --format "{{.ID}}\\t{{.Names}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 },
    ).trim()

    if (!output) return zombies

    for (const line of output.split('\n')) {
      const [containerId, containerName] = line.split('\t')
      if (!containerId || !containerName) continue

      // Extract agent name from container name: prlt-agent-{agentName}
      const agentName = containerName.replace(/^prlt-agent-/, '')
      if (!agentName) continue

      // If agent has no active execution, it's a zombie
      if (!activeAgentNames.has(agentName)) {
        zombies.push({ containerId, containerName, agentName })
      }
    }
  } catch {
    // Docker not available or no containers
  }

  return zombies
}

export interface OrphanedWorktree {
  worktreePath: string
  branch: string
  agentName: string
  repoPath: string
}

/**
 * Detect orphaned worktrees — worktrees for agents that are no longer active.
 */
export function detectOrphanedWorktrees(
  hqPath: string,
  activeAgentNames: Set<string>,
): OrphanedWorktree[] {
  const orphans: OrphanedWorktree[] = []
  const reposPath = path.join(hqPath, 'repos')

  if (!fs.existsSync(reposPath)) return orphans

  let repoDirs: string[]
  try {
    repoDirs = fs.readdirSync(reposPath).filter(d => {
      try { return fs.statSync(path.join(reposPath, d)).isDirectory() } catch { return false }
    })
  } catch {
    return orphans
  }

  for (const repoName of repoDirs) {
    const repoPath = path.join(reposPath, repoName)
    const worktrees = listWorktrees(repoPath)

    for (const wt of worktrees) {
      if (wt.worktreePath === repoPath || wt.isPrunable) continue
      if (!wt.worktreePath.includes('/agents/')) continue
      if (!wt.branch) continue

      // Extract agent name from path: agents/{subdir}/{agentName}/{repoName}
      const relative = path.relative(hqPath, wt.worktreePath)
      const parts = relative.split(path.sep)
      if (parts.length < 4 || parts[0] !== 'agents') continue

      const agentName = parts[2]
      if (activeAgentNames.has(agentName)) continue

      orphans.push({
        worktreePath: wt.worktreePath,
        branch: wt.branch,
        agentName,
        repoPath,
      })
    }
  }

  return orphans
}

export interface StaleTmuxSession {
  sessionName: string
  containerId?: string
  agentName: string
}

/**
 * Detect stale tmux sessions — sessions matching prlt patterns but with no active execution.
 */
export function detectStaleTmuxSessions(
  activeSessionIds: Set<string>,
): StaleTmuxSession[] {
  const stale: StaleTmuxSession[] = []

  try {
    const output = execSync(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || true',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
    ).trim()

    if (!output) return stale

    for (const sessionName of output.split('\n')) {
      if (!sessionName) continue
      // Match prlt session patterns (e.g., TKT-123-implement-agent-name)
      if (!isPrltSessionName(sessionName)) continue
      if (activeSessionIds.has(sessionName)) continue

      const agentName = parseSessionName(sessionName)?.agentName ?? null
      if (agentName) {
        stale.push({ sessionName, agentName })
      }
    }
  } catch {
    // tmux not available
  }

  return stale
}

// =============================================================================
// Internal Helpers
// =============================================================================

interface StepOutcome {
  success?: boolean
  skipped?: boolean
  error?: string
}

function executeStep(
  name: string,
  execute: boolean,
  log: ((msg: string) => void) | undefined,
  fn: () => StepOutcome,
): CascadeStepResult {
  if (!execute) {
    return { step: name, success: true, skipped: true }
  }

  try {
    const outcome = fn()
    if (outcome.skipped) {
      return { step: name, success: true, skipped: true }
    }
    if (outcome.success === false) {
      log?.(`[cascade] ${name}: failed — ${outcome.error}`)
      return { step: name, success: false, skipped: false, error: outcome.error }
    }
    return { step: name, success: true, skipped: false }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log?.(`[cascade] ${name}: error — ${error}`)
    return { step: name, success: false, skipped: false, error }
  }
}

function killHostTmuxSession(sessionName: string): boolean {
  try {
    execSync(`tmux kill-session -t "${sessionName}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    })
    return true
  } catch {
    return false
  }
}

function deleteLocalBranch(branch: string, cwd: string): boolean {
  try {
    execSync(`git branch -D "${branch}"`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

function removeWorktree(worktreePath: string, sourceRepoPath: string): boolean {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: sourceRepoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    // If git worktree remove fails, try removing the directory directly
    try {
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true })
      }
      return true
    } catch {
      return false
    }
  }
}

interface WorktreeEntry {
  worktreePath: string
  branch: string
  isPrunable: boolean
}

function listWorktrees(repoPath: string): WorktreeEntry[] {
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return parseWorktreeList(output)
  } catch {
    return []
  }
}

function parseWorktreeList(output: string): WorktreeEntry[] {
  const blocks = output.split('\n\n').filter(Boolean)
  const entries: WorktreeEntry[] = []

  for (const block of blocks) {
    const lines = block.split('\n')
    const worktreeLine = lines.find(l => l.startsWith('worktree '))
    const branchLine = lines.find(l => l.startsWith('branch '))
    const isPrunable = lines.some(l => l.startsWith('prunable'))

    if (!worktreeLine) continue

    entries.push({
      worktreePath: worktreeLine.replace('worktree ', ''),
      branch: branchLine ? branchLine.replace('branch refs/heads/', '') : '',
      isPrunable,
    })
  }

  return entries
}

/**
 * Check if a tmux session name looks like a prlt-managed session.
 */
function isPrltSessionName(name: string): boolean {
  // Match patterns like: TKT-123-implement-agent-name, PRLT-456-review-bold-turing
  return /^(?:TKT-\d+|[A-Z]+-\d+)-\w+-.+$/.test(name)
}


