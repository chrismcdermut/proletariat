/**
 * Auto-Merge Orchestration
 *
 * Implements the --when-green watch loop that polls CI status and
 * automatically merges a PR once all checks pass. Handles the full
 * rebase+CI cycle automatically.
 *
 * Flow:
 * 1. Optionally enable native auto-merge as a safety net
 * 2. Poll CI status at regular intervals
 * 3. If CI is green and branch is up to date, merge
 * 4. If branch has conflicts, rebase and wait for CI to rerun
 * 5. If CI fails, exit with error
 * 6. If timeout, exit with error
 */

import {
  getPRChecks,
  mergePR,
} from '../pr/index.js'
import type { AutoMergeProvider , WhenGreenOptions, WhenGreenResult } from './types.js'
import { execSync } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000  // 60 minutes
const DEFAULT_POLL_INTERVAL_MS = 30 * 1000  // 30 seconds

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Check if a PR has merge conflicts with its base branch.
 */
function checkMergeConflicts(prNumber: number, cwd?: string): boolean {
  try {
    const result = execSync(
      `gh pr view ${prNumber} --json mergeable -q .mergeable`,
      {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ).trim()

    return result === 'CONFLICTING'
  } catch {
    return false
  }
}

/**
 * Check if a PR has already been merged.
 */
function isPRMerged(prNumber: number, cwd?: string): boolean {
  try {
    const result = execSync(
      `gh pr view ${prNumber} --json state -q .state`,
      {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ).trim()

    return result === 'MERGED'
  } catch {
    return false
  }
}

/**
 * Rebase a PR branch onto its base branch and force-push.
 */
function rebaseOntoBase(
  headBranch: string,
  baseBranch: string,
  cwd?: string,
): { success: boolean; error?: string } {
  try {
    execSync('git fetch origin', {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    execSync(`git checkout ${headBranch}`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    execSync(`git rebase origin/${baseBranch}`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    execSync(`git push --force-with-lease origin ${headBranch}`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    return { success: true }
  } catch (error) {
    try {
      execSync('git rebase --abort', {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      // Ignore abort failures
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown rebase error',
    }
  }
}

export interface WatchAndShipDeps {
  getPRChecks: typeof getPRChecks
  mergePR: typeof mergePR
  checkMergeConflicts: typeof checkMergeConflicts
  isPRMerged: typeof isPRMerged
  rebaseOntoBase: typeof rebaseOntoBase
  sleep: typeof sleep
}

const defaultDeps: WatchAndShipDeps = {
  getPRChecks,
  mergePR,
  checkMergeConflicts,
  isPRMerged,
  rebaseOntoBase,
  sleep,
}

/**
 * Watch a PR and ship it when CI turns green.
 *
 * This is the core implementation of `--when-green`. It enters a poll loop
 * that checks CI status and handles the rebase+merge cycle automatically.
 *
 * If a native auto-merge provider is given, it will be enabled as a safety net
 * so that even if this process dies, the PR will still auto-merge when ready.
 *
 * @param options - Watch loop configuration
 * @param autoMergeProvider - Optional provider for native auto-merge
 * @param deps - Injectable dependencies for testing
 */
export async function watchAndShip(
  options: WhenGreenOptions,
  autoMergeProvider?: AutoMergeProvider | null,
  deps: WatchAndShipDeps = defaultDeps,
): Promise<WhenGreenResult> {
  const {
    prNumber,
    method,
    deleteBranch,
    admin,
    noRebase,
    cwd,
    headBranch,
    baseBranch,
    onProgress,
    onWarning,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = options

  let autoMergeEnabled = false
  let pollCycles = 0
  let rebasePerformed = false

  // Step 1: Try to enable native auto-merge as a safety net
  if (autoMergeProvider) {
    const autoResult = autoMergeProvider.enableAutoMerge(prNumber, method, cwd)
    if (autoResult.success) {
      autoMergeEnabled = true
      if (autoResult.alreadyEnabled) {
        onProgress?.('Auto-merge already enabled')
      } else {
        onProgress?.('Enabled native auto-merge as safety net')
      }
    } else {
      onWarning?.(`Could not enable native auto-merge: ${autoResult.error}. Will poll manually.`)
    }
  }

  // Step 2: Enter poll loop
  const startTime = Date.now()
  const maxRebasesPerCycle = 3 // Prevent infinite rebase loops
  let rebaseCount = 0

  while (Date.now() - startTime < timeoutMs) {
    pollCycles++

    // Check if PR was already merged (by auto-merge or someone else)
    if (deps.isPRMerged(prNumber, cwd)) {
      onProgress?.('PR was merged (auto-merge or external)')
      return {
        merged: true,
        autoMergeEnabled,
        pollCycles,
        rebasePerformed,
      }
    }

    // Check CI status
    const checks = deps.getPRChecks(prNumber, cwd)

    // No checks configured — can merge immediately
    if (checks.length === 0) {
      onProgress?.('No CI checks configured — merging immediately')
      const mergeResult = deps.mergePR(prNumber, { method, deleteBranch, admin, cwd })
      if (mergeResult.success) {
        return {
          merged: true,
          autoMergeEnabled,
          pollCycles,
          rebasePerformed,
        }
      }
      return {
        merged: false,
        autoMergeEnabled,
        pollCycles,
        rebasePerformed,
        error: `Merge failed: ${mergeResult.error}`,
        errorCode: 'MERGE_FAILED',
      }
    }

    const failed = checks.filter(c => c.conclusion === 'FAILURE')
    const pending = checks.filter(c =>
      !c.conclusion || c.status === 'IN_PROGRESS' || c.status === 'QUEUED'
    )
    const passed = checks.filter(c =>
      c.conclusion === 'SUCCESS' || c.conclusion === 'SKIPPED'
    )

    // CI has failures — exit
    if (pending.length === 0 && failed.length > 0) {
      const failedNames = failed.map(c => c.name).join(', ')

      // Disable auto-merge if we enabled it
      if (autoMergeEnabled && autoMergeProvider) {
        autoMergeProvider.disableAutoMerge(prNumber, cwd)
      }

      return {
        merged: false,
        autoMergeEnabled,
        pollCycles,
        rebasePerformed,
        error: `CI checks failed: ${failedNames}. Fix the failures before shipping.`,
        errorCode: 'CI_FAILED',
      }
    }

    // CI still pending — wait
    if (pending.length > 0) {
      if (pollCycles === 1) {
        onProgress?.(`Waiting for CI (${pending.length} pending, ${passed.length} passed)...`)
      } else if (pollCycles % 4 === 0) {
        // Log progress every ~2 minutes
        const elapsed = Math.round((Date.now() - startTime) / 60_000)
        onProgress?.(`Still waiting for CI — ${pending.length} pending (${elapsed}m elapsed)`)
      }
      await deps.sleep(pollIntervalMs)
      continue
    }

    // All CI checks passed! Check for merge conflicts.
    onProgress?.(`CI green (${passed.length} checks passed)`)

    const hasConflicts = deps.checkMergeConflicts(prNumber, cwd)
    if (hasConflicts) {
      if (noRebase) {
        if (autoMergeEnabled && autoMergeProvider) {
          autoMergeProvider.disableAutoMerge(prNumber, cwd)
        }
        return {
          merged: false,
          autoMergeEnabled,
          pollCycles,
          rebasePerformed,
          error: `PR #${prNumber} has merge conflicts. Resolve them manually or run without --no-rebase.`,
          errorCode: 'MERGE_CONFLICTS',
        }
      }

      if (rebaseCount >= maxRebasesPerCycle) {
        if (autoMergeEnabled && autoMergeProvider) {
          autoMergeProvider.disableAutoMerge(prNumber, cwd)
        }
        return {
          merged: false,
          autoMergeEnabled,
          pollCycles,
          rebasePerformed,
          error: `Rebase limit reached (${maxRebasesPerCycle}). Base branch is changing too quickly.`,
          errorCode: 'REBASE_LIMIT',
        }
      }

      onProgress?.('Merge conflicts detected, rebasing...')
      const rebaseResult = deps.rebaseOntoBase(headBranch, baseBranch, cwd)
      if (!rebaseResult.success) {
        if (autoMergeEnabled && autoMergeProvider) {
          autoMergeProvider.disableAutoMerge(prNumber, cwd)
        }
        return {
          merged: false,
          autoMergeEnabled,
          pollCycles,
          rebasePerformed,
          error: `Rebase failed: ${rebaseResult.error}. Resolve conflicts manually.`,
          errorCode: 'REBASE_FAILED',
        }
      }

      rebasePerformed = true
      rebaseCount++
      onProgress?.('Rebased and force-pushed. Waiting for CI to rerun...')
      await deps.sleep(pollIntervalMs)
      continue
    }

    // CI green + no conflicts — merge!
    // If auto-merge is enabled, it may have already merged. Check first.
    if (deps.isPRMerged(prNumber, cwd)) {
      onProgress?.('PR was auto-merged')
      return {
        merged: true,
        autoMergeEnabled,
        pollCycles,
        rebasePerformed,
      }
    }

    onProgress?.(`Merging PR #${prNumber} (${method})...`)
    const mergeResult = deps.mergePR(prNumber, { method, deleteBranch, admin, cwd })
    if (mergeResult.success) {
      return {
        merged: true,
        autoMergeEnabled,
        pollCycles,
        rebasePerformed,
      }
    }

    // Merge failed — could be a race condition. Check if already merged.
    if (deps.isPRMerged(prNumber, cwd)) {
      onProgress?.('PR was merged by another process')
      return {
        merged: true,
        autoMergeEnabled,
        pollCycles,
        rebasePerformed,
      }
    }

    return {
      merged: false,
      autoMergeEnabled,
      pollCycles,
      rebasePerformed,
      error: `Merge failed: ${mergeResult.error}`,
      errorCode: 'MERGE_FAILED',
    }
  }

  // Timeout — auto-merge may still complete later if enabled
  const timeoutMinutes = Math.round(timeoutMs / 60_000)
  return {
    merged: false,
    autoMergeEnabled,
    pollCycles,
    rebasePerformed,
    error: autoMergeEnabled
      ? `Timed out after ${timeoutMinutes} minutes. Native auto-merge is still enabled — PR will merge automatically when ready.`
      : `Timed out after ${timeoutMinutes} minutes waiting for CI. Check manually.`,
    errorCode: 'TIMEOUT',
  }
}
