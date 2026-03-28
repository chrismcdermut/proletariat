/**
 * Garbage Collection Module
 *
 * Core logic for cleaning up agent artifacts after PR merge/close.
 * Handles: worktree removal, container removal, branch pruning (local + remote),
 * tmux session cleanup, Claude session cleanup, DB record marking, agent name recycling,
 * and stale PR closure.
 *
 * Used by both the `prlt gc` command and the daemon's post-merge phase.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import {
  listAgentContainers,
  removeContainer,
  type ContainerInfo,
} from '../execution/container-cleanup.js'
import {
  getPRForBranch,
  closePR,
  type PRInfo,
} from '../pr/index.js'

// =============================================================================
// Types
// =============================================================================

export type GCArtifactStatus =
  | 'merged'     // PR merged — safe to delete everything
  | 'closed'     // PR closed without merge — safe to delete
  | 'stale'      // PR open but inactive for staleDays — close PR + archive
  | 'active'     // PR open and active — skip

export interface GCCandidate {
  /** Worktree path on disk */
  worktreePath: string
  /** Branch name checked out in this worktree */
  branch: string
  /** Agent name extracted from worktree path */
  agentName: string | null
  /** Repository name this worktree belongs to */
  repoName: string
  /** Source repo path (bare/main repo) */
  sourceRepoPath: string
  /** PR info if found */
  pr: PRInfo | null
  /** Computed artifact status */
  status: GCArtifactStatus
  /** Associated container, if any */
  container: ContainerInfo | null
}

export interface GCResult {
  /** Worktrees removed */
  worktreesRemoved: string[]
  /** Containers removed */
  containersRemoved: string[]
  /** Local branches pruned */
  branchesPruned: string[]
  /** Remote branches deleted */
  remoteBranchesDeleted: string[]
  /** tmux sessions killed */
  tmuxSessionsCleaned: string[]
  /** Claude sessions cleaned */
  claudeSessionsCleaned: string[]
  /** DB execution records marked as gc_cleaned */
  dbRecordsMarked: number
  /** DB execution records purged (deleted) */
  dbRecordsPurged: number
  /** Agent names marked as recyclable */
  agentNamesRecycled: string[]
  /** Stale PRs closed */
  stalePRsClosed: number[]
  /** Errors encountered */
  errors: string[]
  /** Candidates that were skipped (active) */
  skipped: string[]
}

export interface GCOptions {
  /** Working directory (HQ path) */
  hqPath: string
  /** Days of inactivity before a PR is considered stale */
  staleDays?: number
  /** Only process candidates matching this status */
  filterStatus?: GCArtifactStatus[]
  /** Actually execute cleanup (default: false = dry run) */
  execute?: boolean
  /** Purge (DELETE) old DB execution records instead of just marking them */
  purgeDb?: boolean
  /** Log callback */
  log?: (msg: string) => void
}

// =============================================================================
// Worktree Discovery
// =============================================================================

interface WorktreeEntry {
  worktreePath: string
  branch: string
  isPrunable: boolean
}

/**
 * Parse `git worktree list --porcelain` output into structured entries.
 */
export function parseWorktreeList(output: string): WorktreeEntry[] {
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
 * List all git worktrees for a given repo path.
 */
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

/**
 * Extract agent name from a worktree path.
 * Worktrees are at: {hqPath}/agents/{subdir}/{agentName}/{repoName}
 */
export function extractAgentName(worktreePath: string, hqPath: string): string | null {
  const relative = path.relative(hqPath, worktreePath)
  if (!relative.startsWith('agents/')) return null

  const parts = relative.split(path.sep)
  // agents / {subdir} / {agentName} / {repoName}
  if (parts.length >= 4) {
    return parts[2]
  }
  return null
}

// =============================================================================
// Candidate Collection
// =============================================================================

/**
 * Determine the GC status for a worktree based on its PR state.
 */
export function classifyArtifact(pr: PRInfo | null, staleDays: number): GCArtifactStatus {
  if (!pr) {
    // No PR found — branch exists but no PR was ever created or it's been deleted.
    // Treat as closed (safe to clean up).
    return 'closed'
  }

  if (pr.state === 'MERGED') return 'merged'
  if (pr.state === 'CLOSED') return 'closed'

  // PR is open — check if stale
  const updatedAt = new Date(pr.updatedAt)
  const daysSinceUpdate = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)
  if (daysSinceUpdate >= staleDays) return 'stale'

  return 'active'
}

/**
 * Collect all GC candidates by scanning worktrees and checking PR status.
 *
 * Scans all repos in the HQ, finds worktrees inside the agents/ directory,
 * checks PR status for each branch, and classifies them.
 */
export function collectGCCandidates(options: GCOptions): GCCandidate[] {
  const { hqPath, staleDays = 7, log } = options
  const reposPath = path.join(hqPath, 'repos')
  const candidates: GCCandidate[] = []

  if (!fs.existsSync(reposPath)) return candidates

  // Get all repositories
  let repoDirs: string[]
  try {
    repoDirs = fs.readdirSync(reposPath).filter(d =>
      fs.statSync(path.join(reposPath, d)).isDirectory()
    )
  } catch {
    return candidates
  }

  // Build container lookup: agentName → ContainerInfo
  const containers = listAgentContainers()
  const containerByAgent = new Map<string, ContainerInfo>()
  for (const c of containers) {
    containerByAgent.set(c.agentName, c)
  }

  // Track branches we've already seen to avoid duplicate PR lookups
  const seenBranches = new Map<string, PRInfo | null>()

  for (const repoName of repoDirs) {
    const repoPath = path.join(reposPath, repoName)
    const worktrees = listWorktrees(repoPath)

    for (const wt of worktrees) {
      // Skip the main worktree (the repo itself) and prunable entries
      if (wt.worktreePath === repoPath || wt.isPrunable) continue

      // Only consider worktrees inside agents/ directory
      const agentName = extractAgentName(wt.worktreePath, hqPath)
      if (!agentName && !wt.worktreePath.includes('/agents/')) continue

      // Skip worktrees without a branch (detached HEAD)
      if (!wt.branch) continue

      // Look up PR status for this branch
      let pr: PRInfo | null
      if (seenBranches.has(wt.branch)) {
        pr = seenBranches.get(wt.branch)!
      } else {
        log?.(`Checking PR status for branch: ${wt.branch}`)
        pr = getPRForBranch(wt.branch, repoPath)
        seenBranches.set(wt.branch, pr)
      }

      const status = classifyArtifact(pr, staleDays)

      candidates.push({
        worktreePath: wt.worktreePath,
        branch: wt.branch,
        agentName,
        repoName,
        sourceRepoPath: repoPath,
        pr,
        status,
        container: agentName ? containerByAgent.get(agentName) ?? null : null,
      })
    }
  }

  return candidates
}

// =============================================================================
// Cleanup Execution
// =============================================================================

/**
 * Delete a local git branch.
 */
function deleteLocalBranch(branch: string, cwd: string): boolean {
  try {
    execSync(`git branch -D ${branch}`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * Remove a git worktree.
 */
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

/**
 * Prune stale worktree references for a repo.
 */
function pruneWorktreeRefs(repoPath: string): void {
  try {
    execSync('git worktree prune', {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    // Ignore prune errors
  }
}

/**
 * Remove an agent's directory if it exists and is empty (or force).
 */
function removeAgentDir(agentDir: string): boolean {
  try {
    if (fs.existsSync(agentDir)) {
      fs.rmSync(agentDir, { recursive: true, force: true })
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Delete a remote git branch. Non-fatal if branch doesn't exist on remote.
 */
export function deleteRemoteBranch(branch: string, cwd: string): boolean {
  try {
    execSync(`git push origin --delete "${branch}"`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    })
    return true
  } catch (error) {
    // If the remote branch is already gone, that's fine
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('remote ref does not exist') || msg.includes('unable to delete')) {
      return false
    }
    return false
  }
}

/**
 * Kill tmux sessions inside a Docker container.
 * Non-fatal if tmux is not running or container is not accessible.
 */
export function killTmuxInContainer(containerId: string): boolean {
  try {
    execSync(`docker exec ${containerId} tmux kill-server`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    })
    return true
  } catch {
    // Non-fatal — tmux may not be running in the container
    return false
  }
}

/**
 * Clean up Claude session data from a Docker container's claude-credentials volume.
 * Only removes session-specific files, preserving auth credentials.
 *
 * Session files to clean: projects/, .claude-*, statsig/
 * Files to preserve: .credentials.json, credentials.json, .oauthtoken, settings.json
 */
export function cleanClaudeSessionData(containerId: string): boolean {
  try {
    // Remove session-specific directories and files, preserve auth
    // The cleanup script removes session state but keeps credentials
    const script =
      'rm -rf /home/node/.claude/projects 2>/dev/null; ' +
      'rm -rf /home/node/.claude/statsig 2>/dev/null; ' +
      'rm -f /home/node/.claude/.claude-session 2>/dev/null; ' +
      'rm -f /home/node/.claude/.claude-conversation 2>/dev/null; ' +
      'rm -f /home/node/.claude/.claude-history 2>/dev/null; ' +
      'rm -rf /home/node/.claude/memory 2>/dev/null; ' +
      'true'

    execSync(`docker exec ${containerId} sh -c '${script}'`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    })
    return true
  } catch {
    // Non-fatal — container may not be accessible
    return false
  }
}

/**
 * Mark execution records as GC-cleaned for the given agent names.
 * Sets gc_cleaned_at timestamp on agent_work rows that are completed/failed.
 */
export function markExecutionRecordsCleaned(
  hqPath: string,
  agentNames: string[],
): number {
  if (agentNames.length === 0) return 0

  try {
    const { openWorkspaceDatabase } = require('../database/workspace.js')
    const db = openWorkspaceDatabase(hqPath)
    try {
      // Check if agent_work table exists
      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_work'"
      ).get()
      if (!tableExists) return 0

      // Check if gc_cleaned_at column exists
      const cols = db.prepare("PRAGMA table_info(agent_work)").all() as { name: string }[]
      if (!cols.some(c => c.name === 'gc_cleaned_at')) return 0

      const placeholders = agentNames.map(() => '?').join(',')
      const now = new Date().toISOString()

      const stmt = db.prepare(
        `UPDATE agent_work SET gc_cleaned_at = ? WHERE agent_name IN (${placeholders}) AND gc_cleaned_at IS NULL`
      )
      const result = stmt.run(now, ...agentNames)
      return result.changes
    } finally {
      db.close()
    }
  } catch {
    return 0
  }
}

/**
 * Purge (DELETE) execution records for the given agent names.
 * Only deletes records that have already been marked as gc_cleaned.
 */
export function purgeExecutionRecords(
  hqPath: string,
  agentNames: string[],
): number {
  if (agentNames.length === 0) return 0

  try {
    const { openWorkspaceDatabase } = require('../database/workspace.js')
    const db = openWorkspaceDatabase(hqPath)
    try {
      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_work'"
      ).get()
      if (!tableExists) return 0

      const placeholders = agentNames.map(() => '?').join(',')

      const stmt = db.prepare(
        `DELETE FROM agent_work WHERE agent_name IN (${placeholders}) AND gc_cleaned_at IS NOT NULL`
      )
      const result = stmt.run(...agentNames)
      return result.changes
    } finally {
      db.close()
    }
  } catch {
    return 0
  }
}

/**
 * Mark agent names as recyclable (status='cleaned') in the database.
 * Preserves the record for history but allows name reuse.
 */
export function recycleAgentNames(
  hqPath: string,
  agentNames: string[],
): string[] {
  if (agentNames.length === 0) return []

  const recycled: string[] = []
  try {
    const { markAgentCleaned } = require('../database/agents.js')
    for (const name of agentNames) {
      try {
        markAgentCleaned(hqPath, name)
        recycled.push(name)
      } catch {
        // Agent may not exist in DB — non-fatal
      }
    }
  } catch {
    // DB access may fail — non-fatal
  }
  return recycled
}

/**
 * Execute garbage collection on the provided candidates.
 *
 * Processes candidates in order:
 * 1. Close stale PRs
 * 2. Kill tmux sessions in containers
 * 3. Clean Claude session data in containers
 * 4. Remove worktrees
 * 5. Remove containers
 * 6. Prune local branches
 * 7. Delete remote branches
 * 8. Clean up empty agent directories
 * 9. Mark/purge DB execution records
 * 10. Recycle agent names
 */
export function executeGC(
  candidates: GCCandidate[],
  options: GCOptions,
): GCResult {
  const { execute = false, purgeDb = false, log, hqPath } = options

  const result: GCResult = {
    worktreesRemoved: [],
    containersRemoved: [],
    branchesPruned: [],
    remoteBranchesDeleted: [],
    tmuxSessionsCleaned: [],
    claudeSessionsCleaned: [],
    dbRecordsMarked: 0,
    dbRecordsPurged: 0,
    agentNamesRecycled: [],
    stalePRsClosed: [],
    errors: [],
    skipped: [],
  }

  // Filter to only actionable candidates
  const filterStatus = options.filterStatus ?? ['merged', 'closed', 'stale']
  const actionable = candidates.filter(c => filterStatus.includes(c.status))
  const skipped = candidates.filter(c => !filterStatus.includes(c.status))

  for (const c of skipped) {
    result.skipped.push(`${c.branch} (${c.status})`)
  }

  // Track repos that need pruning and agent dirs that need cleanup
  const reposToProcess = new Set<string>()
  const agentDirs = new Set<string>()
  const processedContainers = new Set<string>()
  const processedAgentNames = new Set<string>()
  const processedBranches = new Set<string>()

  for (const candidate of actionable) {
    // 1. Close stale PRs
    if (candidate.status === 'stale' && candidate.pr) {
      if (execute) {
        log?.(`Closing stale PR #${candidate.pr.number}: ${candidate.pr.title}`)
        const closeResult = closePR(candidate.pr.number, {
          comment: 'Closing stale PR — no activity for 7+ days. Worktree archived by GC.',
          cwd: candidate.sourceRepoPath,
        })
        if (closeResult.success) {
          result.stalePRsClosed.push(candidate.pr.number)
        } else {
          result.errors.push(`Failed to close PR #${candidate.pr.number}: ${closeResult.error}`)
        }
      } else {
        log?.(`[dry-run] Would close stale PR #${candidate.pr.number}: ${candidate.pr.title}`)
        result.stalePRsClosed.push(candidate.pr.number)
      }
    }

    // 2. Kill tmux sessions + 3. Clean Claude session data (before container removal)
    if (candidate.container && !processedContainers.has(candidate.container.containerId)) {
      if (execute) {
        // Kill tmux sessions inside the container
        log?.(`Killing tmux sessions in container: ${candidate.container.containerName}`)
        if (killTmuxInContainer(candidate.container.containerId)) {
          result.tmuxSessionsCleaned.push(candidate.container.containerName)
        }
        // tmux cleanup failure is non-fatal

        // Clean Claude session data
        log?.(`Cleaning Claude session data in container: ${candidate.container.containerName}`)
        if (cleanClaudeSessionData(candidate.container.containerId)) {
          result.claudeSessionsCleaned.push(candidate.container.containerName)
        }
        // Claude session cleanup failure is non-fatal
      } else {
        log?.(`[dry-run] Would kill tmux sessions in container: ${candidate.container.containerName}`)
        result.tmuxSessionsCleaned.push(candidate.container.containerName)
        log?.(`[dry-run] Would clean Claude session data in container: ${candidate.container.containerName}`)
        result.claudeSessionsCleaned.push(candidate.container.containerName)
      }
    }

    // 4. Remove worktree
    if (execute) {
      log?.(`Removing worktree: ${candidate.worktreePath}`)
      if (removeWorktree(candidate.worktreePath, candidate.sourceRepoPath)) {
        result.worktreesRemoved.push(candidate.worktreePath)
      } else {
        result.errors.push(`Failed to remove worktree: ${candidate.worktreePath}`)
      }
    } else {
      log?.(`[dry-run] Would remove worktree: ${candidate.worktreePath}`)
      result.worktreesRemoved.push(candidate.worktreePath)
    }

    // 5. Remove container (deduplicate by agent)
    if (candidate.container && !processedContainers.has(candidate.container.containerId)) {
      processedContainers.add(candidate.container.containerId)
      if (execute) {
        log?.(`Removing container: ${candidate.container.containerName}`)
        const rmResult = removeContainer(candidate.container.containerId)
        if (rmResult.success) {
          result.containersRemoved.push(candidate.container.containerName)
        } else {
          result.errors.push(`Failed to remove container ${candidate.container.containerName}: ${rmResult.error}`)
        }
      } else {
        log?.(`[dry-run] Would remove container: ${candidate.container.containerName}`)
        result.containersRemoved.push(candidate.container.containerName)
      }
    }

    // 6. Prune local branch
    if (candidate.branch) {
      if (execute) {
        if (deleteLocalBranch(candidate.branch, candidate.sourceRepoPath)) {
          result.branchesPruned.push(candidate.branch)
          log?.(`Pruned local branch: ${candidate.branch}`)
        }
        // Branch deletion failure is non-fatal (may already be deleted)
      } else {
        log?.(`[dry-run] Would prune local branch: ${candidate.branch}`)
        result.branchesPruned.push(candidate.branch)
      }

      // 7. Delete remote branch (deduplicate across repos for same branch)
      if (!processedBranches.has(candidate.branch)) {
        processedBranches.add(candidate.branch)
        if (execute) {
          log?.(`Deleting remote branch: ${candidate.branch}`)
          if (deleteRemoteBranch(candidate.branch, candidate.sourceRepoPath)) {
            result.remoteBranchesDeleted.push(candidate.branch)
          }
          // Remote branch deletion failure is non-fatal (may already be deleted)
        } else {
          log?.(`[dry-run] Would delete remote branch: ${candidate.branch}`)
          result.remoteBranchesDeleted.push(candidate.branch)
        }
      }
    }

    reposToProcess.add(candidate.sourceRepoPath)

    // Track agent directory and name for cleanup
    if (candidate.agentName) {
      const agentDir = path.dirname(candidate.worktreePath)
      agentDirs.add(agentDir)
      processedAgentNames.add(candidate.agentName)
    }
  }

  // 8. Prune worktree refs and clean up empty agent directories
  if (execute) {
    for (const repoPath of reposToProcess) {
      pruneWorktreeRefs(repoPath)
    }

    for (const agentDir of agentDirs) {
      // Only remove if directory is now empty or doesn't exist
      if (fs.existsSync(agentDir)) {
        try {
          const contents = fs.readdirSync(agentDir)
          if (contents.length === 0) {
            removeAgentDir(agentDir)
            log?.(`Removed empty agent directory: ${agentDir}`)
          }
        } catch {
          // Ignore
        }
      }
    }
  }

  // 9. Mark/purge DB execution records
  const agentNameList = [...processedAgentNames]
  if (agentNameList.length > 0) {
    if (execute) {
      // Always mark records as gc_cleaned
      const marked = markExecutionRecordsCleaned(hqPath, agentNameList)
      result.dbRecordsMarked = marked
      if (marked > 0) {
        log?.(`Marked ${marked} execution record(s) as gc_cleaned`)
      }

      // Optionally purge (DELETE) if --purge-db was passed
      if (purgeDb) {
        const purged = purgeExecutionRecords(hqPath, agentNameList)
        result.dbRecordsPurged = purged
        if (purged > 0) {
          log?.(`Purged ${purged} execution record(s)`)
        }
      }
    } else {
      log?.(`[dry-run] Would mark execution records as gc_cleaned for ${agentNameList.length} agent(s)`)
      if (purgeDb) {
        log?.(`[dry-run] Would purge execution records for ${agentNameList.length} agent(s)`)
      }
    }
  }

  // 10. Recycle agent names
  if (agentNameList.length > 0) {
    if (execute) {
      log?.(`Recycling ${agentNameList.length} agent name(s)`)
      const recycled = recycleAgentNames(hqPath, agentNameList)
      result.agentNamesRecycled = recycled
    } else {
      log?.(`[dry-run] Would recycle ${agentNameList.length} agent name(s)`)
      result.agentNamesRecycled = agentNameList
    }
  }

  return result
}

// =============================================================================
// Daemon Integration — Grace Period Scheduler
// =============================================================================

interface ScheduledCleanup {
  branch: string
  scheduledAt: number
  graceUntil: number
}

/**
 * In-memory scheduler for daemon GC with grace periods.
 * Tracks branches that need cleanup after their grace period expires.
 */
export class GCScheduler {
  private pending = new Map<string, ScheduledCleanup>()
  private gracePeriodMs: number

  constructor(gracePeriodMs: number = 60 * 60 * 1000 /* 1 hour */) {
    this.gracePeriodMs = gracePeriodMs
  }

  /**
   * Schedule a branch for GC after the grace period.
   */
  schedule(branch: string): void {
    if (this.pending.has(branch)) return
    const now = Date.now()
    this.pending.set(branch, {
      branch,
      scheduledAt: now,
      graceUntil: now + this.gracePeriodMs,
    })
  }

  /**
   * Get branches whose grace period has expired.
   */
  getReady(): string[] {
    const now = Date.now()
    const ready: string[] = []

    for (const [branch, entry] of this.pending) {
      if (now >= entry.graceUntil) {
        ready.push(branch)
      }
    }

    return ready
  }

  /**
   * Remove a branch from the schedule (after cleanup).
   */
  complete(branch: string): void {
    this.pending.delete(branch)
  }

  /**
   * Get all pending cleanups (for status/debugging).
   */
  getPending(): ScheduledCleanup[] {
    return [...this.pending.values()]
  }

  /**
   * Number of pending cleanups.
   */
  get size(): number {
    return this.pending.size
  }
}
