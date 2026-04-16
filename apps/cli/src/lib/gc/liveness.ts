/**
 * GC Liveness Check (PRLT-1324)
 *
 * Multi-signal liveness verification for worktree garbage collection.
 *
 * Before GC destroys an agent's worktree, ALL of the following must be true:
 *   1. DB record shows session as terminated (status != active/running)
 *   2. No tmux session exists for this agent (host or container)
 *   3. No process is holding a file inside the worktree path (lsof)
 *   4. No open PR exists for the worktree's branch
 *   5. Last heartbeat older than N minutes (default 10)
 *   6. Worktree is at least N minutes old (default 5) — protects fresh spawns
 *   7. Worktree has no uncommitted changes
 *
 * If ANY check fails, the worktree is skipped and the reason is logged.
 *
 * Rationale: PRLT-1324 — `prlt gc --orphans --execute` destroyed a live agent's
 * worktree because the single-signal liveness check (running container OR
 * active/running DB status) can go stale during GC's scan phase. Multi-signal
 * verification with a minimum-age grace prevents this class of failure.
 */

import * as fs from 'node:fs'
import { execSync } from 'node:child_process'
import { getPRForBranch } from '../pr/index.js'
import {
  getHostTmuxSessionNames,
  getContainerTmuxSessionMap,
  flattenContainerSessions,
} from '../execution/session-utils.js'
import type { ContainerInfo } from '../execution/container-cleanup.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Individual signal results collected by the liveness check.
 * Each field is a human-readable reason, or null if the signal is "safe to
 * delete". A non-null value means this signal proves the worktree is live.
 */
export interface LivenessSignals {
  /** DB agent record indicates active/running — non-null reason if alive */
  dbActive: string | null
  /** Tmux session exists for this agent — non-null reason if found */
  tmuxAlive: string | null
  /** Process holds a file inside the worktree — non-null reason if held */
  processHolding: string | null
  /** Open PR exists for this branch — non-null reason if open */
  openPR: string | null
  /** Recent heartbeat recorded — non-null reason if fresh */
  recentHeartbeat: string | null
  /** Worktree younger than minimum age — non-null reason if too young */
  tooYoung: string | null
  /** Uncommitted changes present in worktree — non-null reason if dirty */
  uncommittedChanges: string | null
}

export interface LivenessResult {
  /** True when ALL signals are safe (no live markers found) */
  safeToDelete: boolean
  /** The collected signal reasons */
  signals: LivenessSignals
  /** List of non-null reasons (for logging) */
  reasons: string[]
}

export interface LivenessOptions {
  /** Workspace / HQ path */
  hqPath: string
  /** Minimum age for worktrees in minutes before they can be deleted (default 5) */
  minWorktreeAgeMinutes?: number
  /** How many minutes back counts as a "recent" heartbeat (default 10) */
  heartbeatFreshMinutes?: number
  /** Pre-fetched container info to avoid redundant docker calls */
  container?: ContainerInfo | null
  /** Pre-fetched host tmux session names */
  hostTmuxSessions?: string[]
  /** Pre-fetched container tmux sessions map */
  containerTmuxSessions?: Map<string, string[]>
  /**
   * Repo path to cwd into for the `gh pr view` call.
   * If omitted, getPRForBranch will infer from git cwd.
   */
  repoPath?: string
  /** Skip the PR check — useful for tests that can't reach GitHub */
  skipPRCheck?: boolean
  /** Skip the process-holding (lsof) check — useful for tests */
  skipProcessCheck?: boolean
}

// =============================================================================
// Individual Signal Checks
// =============================================================================

/**
 * Check whether the agent's DB record indicates it is still alive.
 * Returns a reason string when alive, null when terminated/missing.
 */
export function checkDbStatus(agentName: string, hqPath: string): string | null {
  try {
    // Lazy require to keep the liveness module importable in environments
    // without a workspace database (e.g. unit tests on /tmp/nonexistent).
    const { getAgent } = require('../database/agents.js') as typeof import('../database/agents.js')
    const agent = getAgent(hqPath, agentName)
    if (!agent) return null
    if (agent.status === 'active' || agent.status === 'running') {
      return `DB agent status is "${agent.status}"`
    }
    return null
  } catch {
    // DB access failed — do NOT assume dead. Be defensive: return null
    // so the combined check falls back to other signals. (Other signals
    // must still pass before deletion is permitted.)
    return null
  }
}

/**
 * Check for a tmux session that belongs to this agent. Looks at both host
 * sessions and container sessions. Session names follow the
 * `{ticketId}-{action}-{agentName}` convention, so any session ending in
 * `-{agentName}` (or equal to `{agentName}`) is treated as a match.
 */
export function checkTmuxSession(
  agentName: string,
  hostSessions: string[],
  containerTmux: Map<string, string[]>,
): string | null {
  const suffix = `-${agentName}`

  for (const s of hostSessions) {
    if (s === agentName || s.endsWith(suffix)) {
      return `host tmux session "${s}" is alive`
    }
  }

  for (const { sessionName, containerId } of flattenContainerSessions(containerTmux)) {
    if (sessionName === agentName || sessionName.endsWith(suffix)) {
      return `container tmux session "${sessionName}" is alive (container: ${containerId.slice(0, 12)})`
    }
  }

  return null
}

/**
 * Check whether a process holds any file inside the worktree path.
 * Uses `lsof +D` which walks the directory tree. Returns a reason when a
 * process is found, or null when the path is quiescent.
 *
 * Non-fatal: if lsof isn't available or the call fails for any reason
 * other than "found files", returns null. This is deliberate — the
 * liveness check is a suite, and other signals will still gate deletion.
 */
export function checkProcessHolding(worktreePath: string): string | null {
  if (!fs.existsSync(worktreePath)) return null

  try {
    // lsof +D returns files under the directory. Exit code 0 means matches found,
    // exit code 1 means no matches. -t restricts output to PIDs only for quick parsing.
    const output = execSync(`lsof +D ${escapeShellArg(worktreePath)} -t`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    }).trim()

    if (!output) return null

    const pids = output.split('\n').filter(Boolean)
    if (pids.length === 0) return null
    return `${pids.length} process(es) hold files inside worktree (pids: ${pids.slice(0, 3).join(',')}${pids.length > 3 ? '…' : ''})`
  } catch (err) {
    const exitCode = (err as { status?: number }).status
    // Exit code 1 = no matches, treat as safe
    if (exitCode === 1) return null
    // Anything else (lsof missing, timeout, permission error) is inconclusive.
    // Be defensive: treat as not-holding so that other signals gate deletion.
    return null
  }
}

/**
 * Check whether a PR is currently open for this branch. Returns a reason
 * when OPEN, null when MERGED/CLOSED/absent.
 */
export function checkOpenPR(
  branch: string,
  repoPath?: string,
): string | null {
  try {
    const pr = getPRForBranch(branch, repoPath)
    if (pr && pr.state === 'OPEN') {
      return `PR #${pr.number} is OPEN for branch "${branch}"`
    }
    return null
  } catch {
    return null
  }
}

/**
 * Check whether this agent has recorded a heartbeat recently.
 * Returns a reason when a heartbeat within the threshold is found.
 */
export function checkRecentHeartbeat(
  agentName: string,
  hqPath: string,
  thresholdMinutes: number,
): string | null {
  try {
    const { openWorkspaceDatabase } = require('../database/workspace.js') as typeof import('../database/workspace.js')
    const db = openWorkspaceDatabase(hqPath)
    try {
      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_work'",
      ).get()
      if (!tableExists) return null

      const cols = db.prepare("PRAGMA table_info(agent_work)").all() as { name: string }[]
      if (!cols.some(c => c.name === 'last_heartbeat')) return null

      const row = db.prepare(
        `SELECT last_heartbeat FROM agent_work
         WHERE agent_name = ? AND last_heartbeat IS NOT NULL
         ORDER BY last_heartbeat DESC
         LIMIT 1`,
      ).get(agentName) as { last_heartbeat: string | null } | undefined

      if (!row || !row.last_heartbeat) return null

      const hbTime = new Date(row.last_heartbeat).getTime()
      if (Number.isNaN(hbTime)) return null

      const ageMs = Date.now() - hbTime
      const ageMinutes = ageMs / 60000
      if (ageMinutes <= thresholdMinutes) {
        return `recent heartbeat (${ageMinutes.toFixed(1)}m ago, threshold ${thresholdMinutes}m)`
      }
      return null
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/**
 * Check whether the worktree was created within the minimum-age grace period.
 * Uses directory mtime as a proxy for "age". Returns a reason when too young.
 */
export function checkWorktreeAge(
  worktreePath: string,
  minMinutes: number,
): string | null {
  // minMinutes <= 0 disables the age guard entirely (used by tests and
  // operators who explicitly want no grace period).
  if (minMinutes <= 0) return null
  if (!fs.existsSync(worktreePath)) return null
  try {
    const stats = fs.statSync(worktreePath)
    // Use the earlier of mtime/ctime to capture the oldest evidence of existence.
    const mtimeMs = stats.mtimeMs
    const ctimeMs = stats.ctimeMs
    const birthMs = Math.min(mtimeMs, ctimeMs)
    const ageMs = Date.now() - birthMs
    const ageMinutes = ageMs / 60000
    if (ageMinutes < minMinutes) {
      return `worktree is ${ageMinutes.toFixed(1)}m old (< ${minMinutes}m minimum)`
    }
    return null
  } catch {
    return null
  }
}

/**
 * Check whether a worktree has uncommitted changes (including untracked files).
 * Returns a reason when dirty, null when clean.
 *
 * Important: we refuse to delete any worktree with uncommitted work, even if
 * every other signal says the agent is dead — the user's in-progress code
 * must be preserved for manual recovery.
 */
export function checkUncommittedChanges(worktreePath: string): string | null {
  if (!fs.existsSync(worktreePath)) return null
  try {
    const output = execSync('git status --porcelain=v1 --untracked-files=normal', {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim()
    if (!output) return null
    const lines = output.split('\n').filter(Boolean)
    return `${lines.length} uncommitted change(s) in worktree`
  } catch {
    // If we cannot inspect the worktree, err on the side of safety.
    return 'unable to inspect git status — skipping for safety'
  }
}

// =============================================================================
// Combined Liveness Check
// =============================================================================

/**
 * Run the full multi-signal liveness check for a worktree.
 *
 * Returns `safeToDelete: true` only when ALL checks agree. Otherwise returns
 * the list of reasons for the caller to log.
 */
export function checkWorktreeLiveness(
  agentName: string,
  worktreePath: string,
  branch: string,
  options: LivenessOptions,
): LivenessResult {
  const {
    hqPath,
    minWorktreeAgeMinutes = 5,
    heartbeatFreshMinutes = 10,
    hostTmuxSessions,
    containerTmuxSessions,
    repoPath,
    skipPRCheck = false,
    skipProcessCheck = false,
  } = options

  const hostSessions = hostTmuxSessions ?? getHostTmuxSessionNames()
  const containerMap = containerTmuxSessions ?? getContainerTmuxSessionMap()

  const signals: LivenessSignals = {
    dbActive: checkDbStatus(agentName, hqPath),
    tmuxAlive: checkTmuxSession(agentName, hostSessions, containerMap),
    processHolding: skipProcessCheck ? null : checkProcessHolding(worktreePath),
    openPR: skipPRCheck ? null : checkOpenPR(branch, repoPath),
    recentHeartbeat: checkRecentHeartbeat(agentName, hqPath, heartbeatFreshMinutes),
    tooYoung: checkWorktreeAge(worktreePath, minWorktreeAgeMinutes),
    uncommittedChanges: checkUncommittedChanges(worktreePath),
  }

  const reasons: string[] = []
  for (const value of Object.values(signals)) {
    if (value) reasons.push(value)
  }

  return {
    safeToDelete: reasons.length === 0,
    signals,
    reasons,
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Minimal shell argument escape for paths containing spaces/special chars.
 * We only use this with a path that we control via fs.existsSync first.
 */
function escapeShellArg(arg: string): string {
  // Wrap in single quotes and escape any single quotes inside.
  return `'${arg.replace(/'/g, `'\\''`)}'`
}
