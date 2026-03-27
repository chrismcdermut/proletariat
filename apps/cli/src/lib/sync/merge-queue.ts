/**
 * Merge Queue
 *
 * Sequential rebase-test-merge pipeline for parallel agent PRs.
 *
 * With strict branch protection (PR must be up-to-date with main), parallel
 * agent PRs create a rebase treadmill. The merge queue processes green PRs
 * one at a time: rebase on main → wait for CI → merge if green → eject if red.
 *
 * State machine per cycle:
 * 1. If paused → skip
 * 2. If a PR is currently being processed (rebased, waiting for CI):
 *    - CI green → merge, rebase siblings
 *    - CI failed → eject (label + comment)
 *    - CI pending → wait
 * 3. If no current PR:
 *    - Build queue: open, non-draft PRs with green CI, ordered by priority then age
 *    - Pick first → rebase → set as current
 *    - If rebase fails (conflicts) → eject, try next
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { PRInfo, PRCheck } from '../pr/index.js'
import {
  listOpenPRs,
  getPRChecks,
  getPRByNumber,
  mergePR,
} from '../pr/index.js'
import { rebaseSiblingPRs } from '../shipping/rebase.js'
import { GitHubProvider } from '../shipping/github.js'

// =============================================================================
// Types
// =============================================================================

export interface MergeQueueState {
  /** Whether the merge queue is paused */
  paused: boolean
  /** ISO timestamp when paused */
  pausedAt: string | null
  /** PR currently being processed (rebased, waiting for CI) */
  currentPR: CurrentPRState | null
  /** Last PR that was successfully merged */
  lastMergedPR: MergedPRInfo | null
  /** ISO timestamp of last cycle */
  lastCycleAt: string | null
  /** Recently ejected PRs (max 10) */
  ejectedPRs: EjectedPRInfo[]
}

export interface CurrentPRState {
  prNumber: number
  headBranch: string
  baseBranch: string
  ticketId: string | null
  priority: number
  rebasedAt: string
}

export interface MergedPRInfo {
  prNumber: number
  headBranch: string
  mergedAt: string
}

export interface EjectedPRInfo {
  prNumber: number
  headBranch: string
  reason: string
  ejectedAt: string
}

export interface MergeQueueEntry {
  pr: PRInfo
  ticketId: string | null
  priority: number
}

export interface MergeQueueCycleResult {
  action: 'none' | 'rebase_started' | 'waiting_ci' | 'merged' | 'ejected' | 'paused' | 'error'
  prNumber?: number
  reason?: string
  queueSize: number
}

export interface MergeQueueOptions {
  /** HQ path for state file */
  hqPath: string
  /** Working directory for git/gh operations */
  cwd?: string
  /** Logging callback */
  log?: (msg: string) => void
  /** Merge method (default: squash) */
  mergeMethod?: 'merge' | 'squash' | 'rebase'
  /** Delete branch after merging (default: true) */
  deleteBranch?: boolean
  /** Map of PR head branch to priority (0=P0, 1=P1, 2=P2, 3=P3). Lower = higher priority */
  branchPriorities?: Map<string, number>
}

/** Injectable dependencies for testing */
export interface MergeQueueDeps {
  listOpenPRs: typeof listOpenPRs
  getPRChecks: typeof getPRChecks
  getPRByNumber: typeof getPRByNumber
  mergePR: typeof mergePR
  rebaseSiblingPRs: typeof rebaseSiblingPRs
  updatePRBranch: (prNumber: number, cwd?: string) => import('../shipping/types.js').UpdateBranchResult
}

// =============================================================================
// Constants
// =============================================================================

const MERGE_QUEUE_STATE_FILE = 'merge-queue.json'
const MAX_EJECTED_HISTORY = 10
const EJECTED_LABEL = 'merge-queue-ejected'
const EJECTED_COMMENT_PREFIX = 'Merge queue ejected this PR:'
const DEFAULT_PRIORITY = 3 // P3 — lowest

// =============================================================================
// State Management
// =============================================================================

export function getMergeQueueStatePath(hqPath: string): string {
  return path.join(hqPath, '.proletariat', MERGE_QUEUE_STATE_FILE)
}

export function getDefaultState(): MergeQueueState {
  return {
    paused: false,
    pausedAt: null,
    currentPR: null,
    lastMergedPR: null,
    lastCycleAt: null,
    ejectedPRs: [],
  }
}

export function getMergeQueueState(hqPath: string): MergeQueueState {
  const statePath = getMergeQueueStatePath(hqPath)
  try {
    const content = fs.readFileSync(statePath, 'utf-8')
    return { ...getDefaultState(), ...JSON.parse(content) }
  } catch {
    return getDefaultState()
  }
}

export function saveMergeQueueState(hqPath: string, state: MergeQueueState): void {
  const statePath = getMergeQueueStatePath(hqPath)
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
}

// =============================================================================
// Pause / Resume
// =============================================================================

export function isMergeQueuePaused(hqPath: string): boolean {
  return getMergeQueueState(hqPath).paused
}

export function pauseMergeQueue(hqPath: string): MergeQueueState {
  const state = getMergeQueueState(hqPath)
  state.paused = true
  state.pausedAt = new Date().toISOString()
  saveMergeQueueState(hqPath, state)
  return state
}

export function resumeMergeQueue(hqPath: string): MergeQueueState {
  const state = getMergeQueueState(hqPath)
  state.paused = false
  state.pausedAt = null
  saveMergeQueueState(hqPath, state)
  return state
}

// =============================================================================
// Queue Building
// =============================================================================

/**
 * Build the merge queue: open, non-draft PRs with all CI checks green,
 * ordered by priority (P0 first) then by creation date (oldest first).
 */
export function buildMergeQueue(
  options: {
    cwd?: string
    branchPriorities?: Map<string, number>
  },
  deps: Pick<MergeQueueDeps, 'listOpenPRs' | 'getPRChecks'> = { listOpenPRs, getPRChecks },
): MergeQueueEntry[] {
  const { cwd, branchPriorities } = options
  const openPRs = deps.listOpenPRs(cwd)
  const entries: MergeQueueEntry[] = []

  for (const pr of openPRs) {
    // Skip drafts
    if (pr.isDraft) continue

    // Check CI
    const checks = deps.getPRChecks(pr.number, cwd)
    if (checks.length === 0) continue // No checks = not ready
    if (!allChecksGreen(checks)) continue

    // Resolve priority from branch
    const priority = branchPriorities?.get(pr.headBranch) ?? DEFAULT_PRIORITY
    const ticketId = extractTicketIdFromBranch(pr.headBranch)

    entries.push({ pr, ticketId, priority })
  }

  // Sort: lower priority number first (P0 < P1 < P2 < P3), then oldest first
  entries.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return new Date(a.pr.createdAt).getTime() - new Date(b.pr.createdAt).getTime()
  })

  return entries
}

// =============================================================================
// Main Cycle
// =============================================================================

const defaultDeps: MergeQueueDeps = {
  listOpenPRs,
  getPRChecks,
  getPRByNumber,
  mergePR,
  rebaseSiblingPRs,
  updatePRBranch: (prNumber, cwd) => new GitHubProvider().updatePRBranch(prNumber, cwd),
}

/**
 * Run a single merge queue cycle.
 *
 * Called by the daemon on each interval. Handles the state machine:
 * - If paused, returns immediately
 * - If a PR is in progress (rebased, waiting CI), checks status
 * - If no PR in progress, picks next from queue and rebases
 */
export function runMergeQueueCycle(
  options: MergeQueueOptions,
  deps: MergeQueueDeps = defaultDeps,
): MergeQueueCycleResult {
  const {
    hqPath,
    cwd,
    log,
    mergeMethod = 'squash',
    deleteBranch = true,
    branchPriorities,
  } = options

  const state = getMergeQueueState(hqPath)
  state.lastCycleAt = new Date().toISOString()

  // Step 1: Check if paused
  if (state.paused) {
    saveMergeQueueState(hqPath, state)
    log?.('Merge queue is paused')
    return { action: 'paused', queueSize: 0 }
  }

  // Step 2: If a PR is currently being processed, check its status
  if (state.currentPR) {
    const result = processCurrentPR(state, { cwd, log, mergeMethod, deleteBranch }, deps)
    saveMergeQueueState(hqPath, state)
    return result
  }

  // Step 3: No current PR — build queue and pick next
  const queue = buildMergeQueue({ cwd, branchPriorities }, deps)
  log?.(`Merge queue: ${queue.length} eligible PR(s)`)

  if (queue.length === 0) {
    saveMergeQueueState(hqPath, state)
    return { action: 'none', queueSize: 0 }
  }

  // Try to rebase the top PR — if conflicts, eject and try next
  for (const entry of queue) {
    const rebaseResult = deps.updatePRBranch(entry.pr.number, cwd)

    if (rebaseResult.success) {
      state.currentPR = {
        prNumber: entry.pr.number,
        headBranch: entry.pr.headBranch,
        baseBranch: entry.pr.baseBranch,
        ticketId: entry.ticketId,
        priority: entry.priority,
        rebasedAt: new Date().toISOString(),
      }
      log?.(`Rebased PR #${entry.pr.number} (${entry.pr.headBranch}) — waiting for CI`)
      saveMergeQueueState(hqPath, state)
      return { action: 'rebase_started', prNumber: entry.pr.number, queueSize: queue.length }
    }

    // Rebase failed — eject this PR
    const reason = rebaseResult.hasConflicts
      ? 'Merge conflicts during rebase'
      : `Rebase failed: ${rebaseResult.error ?? 'unknown error'}`

    ejectPR(state, entry.pr.number, entry.pr.headBranch, reason, cwd, deps)
    log?.(`Ejected PR #${entry.pr.number}: ${reason}`)
  }

  // All PRs in queue had conflicts
  saveMergeQueueState(hqPath, state)
  return { action: 'none', reason: 'All eligible PRs have conflicts', queueSize: queue.length }
}

// =============================================================================
// Process Current PR
// =============================================================================

function processCurrentPR(
  state: MergeQueueState,
  options: {
    cwd?: string
    log?: (msg: string) => void
    mergeMethod: 'merge' | 'squash' | 'rebase'
    deleteBranch: boolean
  },
  deps: MergeQueueDeps,
): MergeQueueCycleResult {
  const { cwd, log, mergeMethod, deleteBranch } = options
  const current = state.currentPR!
  const queueSize = 0 // We don't rebuild the queue when checking current

  // Verify PR is still open
  const prInfo = deps.getPRByNumber(current.prNumber, cwd)
  if (!prInfo || prInfo.state !== 'OPEN') {
    const reason = prInfo?.state === 'MERGED'
      ? 'PR was merged externally'
      : 'PR is no longer open'
    log?.(`Current PR #${current.prNumber}: ${reason} — clearing`)
    state.currentPR = null

    if (prInfo?.state === 'MERGED') {
      state.lastMergedPR = {
        prNumber: current.prNumber,
        headBranch: current.headBranch,
        mergedAt: new Date().toISOString(),
      }
    }

    return { action: 'none', prNumber: current.prNumber, reason, queueSize }
  }

  // Check CI status
  const checks = deps.getPRChecks(current.prNumber, cwd)

  // No checks yet — still waiting
  if (checks.length === 0) {
    log?.(`PR #${current.prNumber}: no CI checks yet — waiting`)
    return { action: 'waiting_ci', prNumber: current.prNumber, queueSize }
  }

  const failed = checks.filter(c => c.conclusion === 'FAILURE')
  const pending = checks.filter(c =>
    !c.conclusion || c.status === 'IN_PROGRESS' || c.status === 'QUEUED',
  )

  // CI still pending
  if (pending.length > 0) {
    log?.(`PR #${current.prNumber}: CI pending (${pending.length} check(s)) — waiting`)
    return { action: 'waiting_ci', prNumber: current.prNumber, queueSize }
  }

  // CI failed — eject
  if (failed.length > 0) {
    const failedNames = failed.map(c => c.name).join(', ')
    const reason = `CI failed after rebase: ${failedNames}`
    ejectPR(state, current.prNumber, current.headBranch, reason, cwd, deps)
    state.currentPR = null
    log?.(`Ejected PR #${current.prNumber}: ${reason}`)
    return { action: 'ejected', prNumber: current.prNumber, reason, queueSize }
  }

  // All CI green — merge!
  log?.(`PR #${current.prNumber}: CI green — merging (${mergeMethod})`)
  const mergeResult = deps.mergePR(current.prNumber, {
    method: mergeMethod,
    deleteBranch,
    cwd,
  })

  if (!mergeResult.success) {
    // Check if it was merged by someone else
    const recheck = deps.getPRByNumber(current.prNumber, cwd)
    if (recheck?.state === 'MERGED') {
      log?.(`PR #${current.prNumber}: was merged externally`)
      state.currentPR = null
      state.lastMergedPR = {
        prNumber: current.prNumber,
        headBranch: current.headBranch,
        mergedAt: new Date().toISOString(),
      }
      return { action: 'merged', prNumber: current.prNumber, reason: 'Merged externally', queueSize }
    }

    const reason = `Merge failed: ${mergeResult.error}`
    ejectPR(state, current.prNumber, current.headBranch, reason, cwd, deps)
    state.currentPR = null
    log?.(`Ejected PR #${current.prNumber}: ${reason}`)
    return { action: 'ejected', prNumber: current.prNumber, reason, queueSize }
  }

  // Merge succeeded!
  log?.(`Merged PR #${current.prNumber} (${current.headBranch})`)
  state.currentPR = null
  state.lastMergedPR = {
    prNumber: current.prNumber,
    headBranch: current.headBranch,
    mergedAt: new Date().toISOString(),
  }

  // Rebase sibling PRs
  log?.('Rebasing sibling PRs...')
  const siblingResult = deps.rebaseSiblingPRs({
    excludePRNumber: current.prNumber,
    cwd,
    onProgress: log,
    labelConflicts: true,
    commentOnConflicts: true,
  })
  log?.(`Siblings: ${siblingResult.succeeded.length} rebased, ${siblingResult.failed.length} failed, ${siblingResult.skipped.length} skipped`)

  return { action: 'merged', prNumber: current.prNumber, queueSize }
}

// =============================================================================
// Eject PR
// =============================================================================

function ejectPR(
  state: MergeQueueState,
  prNumber: number,
  headBranch: string,
  reason: string,
  cwd: string | undefined,
  deps: MergeQueueDeps,
): void {
  // Record ejection
  state.ejectedPRs.unshift({
    prNumber,
    headBranch,
    reason,
    ejectedAt: new Date().toISOString(),
  })

  // Keep only the last N ejected PRs
  if (state.ejectedPRs.length > MAX_EJECTED_HISTORY) {
    state.ejectedPRs = state.ejectedPRs.slice(0, MAX_EJECTED_HISTORY)
  }

  // Label and comment on the PR
  try {
    const provider = new GitHubProvider()
    provider.addLabel(prNumber, EJECTED_LABEL, cwd)
    provider.addComment(prNumber, `${EJECTED_COMMENT_PREFIX} ${reason}`, cwd)
  } catch {
    // Best effort — don't fail the cycle
  }
}

// =============================================================================
// Helpers
// =============================================================================

function allChecksGreen(checks: PRCheck[]): boolean {
  return checks.every(
    c => c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED',
  )
}

/**
 * Extract a ticket ID from a branch name.
 * Supports patterns like: PRLT-1173/feat/... or TKT-007/...
 */
function extractTicketIdFromBranch(branch: string): string | null {
  const match = branch.match(/^([A-Z]+-\d+)\//)
  return match?.[1] ?? null
}
