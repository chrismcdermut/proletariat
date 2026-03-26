/**
 * GitHub Git Provider & Auto-Merge Provider
 *
 * Implements the GitProvider interface for sibling rebase (PRLT-1143)
 * and the AutoMergeProvider interface for auto-merge (PRLT-1144),
 * both using the GitHub API via `gh` CLI.
 */

import { execSync, spawnSync } from 'node:child_process'
import type { PRInfo, MergeableState } from '../pr/index.js'
import {
  listOpenPRs,
  getMergeableState,
  getGitHubRepo,
  rebasePRBranch,
  getPRByNumber,
} from '../pr/index.js'
import type { GitProvider, UpdateBranchResult, AutoMergeProvider, AutoMergeResult } from './types.js'

// =============================================================================
// GitHubProvider — Sibling Rebase (PRLT-1143)
// =============================================================================

/**
 * GitHub implementation of GitProvider.
 *
 * Uses the `gh api` CLI for API-based operations where possible,
 * falling back to local git operations when the API is unavailable.
 */
export class GitHubProvider implements GitProvider {
  readonly name = 'github' as const

  listOpenPRs(cwd?: string): PRInfo[] {
    return listOpenPRs(cwd)
  }

  getMergeableState(prNumber: number, cwd?: string): MergeableState {
    return getMergeableState(prNumber, cwd)
  }

  /**
   * Update a PR branch using GitHub's update-branch API.
   *
   * Uses: PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch
   *
   * This merges the base branch into the PR branch server-side,
   * without requiring a local checkout or force-push.
   *
   * Falls back to local git rebase if the API call fails with a
   * non-conflict error (e.g., permissions, network issues).
   */
  updatePRBranch(prNumber: number, cwd?: string): UpdateBranchResult {
    const repo = getGitHubRepo(cwd)
    if (!repo) {
      return {
        success: false,
        prNumber,
        headBranch: '',
        error: 'Could not determine GitHub repository from git remote',
      }
    }

    // Get PR info for the head branch name
    let headBranch = ''
    let baseBranch = ''
    try {
      const prJson = execSync(
        `gh pr view ${prNumber} --json headRefName,baseRefName`,
        { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      )
      const prData = JSON.parse(prJson)
      headBranch = prData.headRefName
      baseBranch = prData.baseRefName
    } catch {
      return {
        success: false,
        prNumber,
        headBranch: '',
        error: `Could not fetch PR #${prNumber} details`,
      }
    }

    // Try API-based update-branch first
    try {
      execSync(
        `gh api repos/${repo}/pulls/${prNumber}/update-branch -X PUT -f expected_head_sha="$(gh pr view ${prNumber} --json headRefOid -q .headRefOid)"`,
        { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      )

      return {
        success: true,
        prNumber,
        headBranch,
      }
    } catch (apiError) {
      const errorMsg = apiError instanceof Error ? apiError.message : String(apiError)

      // Check if the error indicates merge conflicts
      if (errorMsg.includes('merge conflict') || errorMsg.includes('Merge conflict')) {
        return {
          success: false,
          prNumber,
          headBranch,
          error: 'Merge conflicts detected — manual resolution required',
          hasConflicts: true,
        }
      }

      // API failed for non-conflict reason — fall back to local git rebase
      const fallbackResult = rebasePRBranch(headBranch, baseBranch, cwd)
      if (fallbackResult.success) {
        return {
          success: true,
          prNumber,
          headBranch,
        }
      }

      // Check if fallback failure was due to conflicts
      const fallbackError = fallbackResult.error || ''
      const isConflict = fallbackError.includes('CONFLICT') ||
        fallbackError.includes('conflict') ||
        fallbackError.includes('could not apply')

      return {
        success: false,
        prNumber,
        headBranch,
        error: fallbackResult.error || 'Rebase failed',
        hasConflicts: isConflict,
      }
    }
  }

  /**
   * Add a label to a GitHub PR.
   */
  addLabel(prNumber: number, label: string, cwd?: string): boolean {
    try {
      execSync(`gh pr edit ${prNumber} --add-label "${label}"`, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Add a comment to a GitHub PR.
   */
  addComment(prNumber: number, body: string, cwd?: string): boolean {
    try {
      execSync(`gh pr comment ${prNumber} --body "${body.replace(/"/g, '\\"')}"`, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return true
    } catch {
      return false
    }
  }
}

// =============================================================================
// GitHubAutoMergeProvider — Auto-Merge (PRLT-1144)
// =============================================================================

/**
 * GitHub implementation of AutoMergeProvider.
 *
 * Uses GitHub's native auto-merge feature when available, which
 * automatically merges a PR once all required status checks pass.
 */
export class GitHubAutoMergeProvider implements AutoMergeProvider {
  readonly name = 'github' as const

  /**
   * Enable GitHub's native auto-merge on a PR.
   *
   * Uses `gh pr merge --auto` which sets the PR to auto-merge once
   * all required status checks pass and branch protections are satisfied.
   *
   * Requires: auto-merge must be enabled in the repository settings.
   */
  enableAutoMerge(
    prNumber: number,
    method: 'merge' | 'squash' | 'rebase',
    cwd?: string,
  ): AutoMergeResult {
    const args = ['pr', 'merge', String(prNumber), '--auto', `--${method}`]

    const result = spawnSync('gh', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (result.status !== 0) {
      const stderr = result.stderr?.trim() || ''

      // Check if auto-merge is already enabled
      if (stderr.includes('already set to auto-merge') || stderr.includes('auto-merge is already enabled')) {
        return {
          success: true,
          prNumber,
          alreadyEnabled: true,
        }
      }

      return {
        success: false,
        prNumber,
        error: stderr || 'Failed to enable auto-merge',
      }
    }

    return { success: true, prNumber }
  }

  /**
   * Disable GitHub's native auto-merge on a PR.
   *
   * Uses `gh pr merge --disable-auto` to cancel auto-merge.
   */
  disableAutoMerge(prNumber: number, cwd?: string): AutoMergeResult {
    const result = spawnSync('gh', ['pr', 'merge', String(prNumber), '--disable-auto'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (result.status !== 0) {
      const stderr = result.stderr?.trim() || ''

      // Not an error if auto-merge wasn't enabled
      if (stderr.includes('not set to auto-merge') || stderr.includes('auto-merge is not enabled')) {
        return { success: true, prNumber }
      }

      return {
        success: false,
        prNumber,
        error: stderr || 'Failed to disable auto-merge',
      }
    }

    return { success: true, prNumber }
  }

  /**
   * Check if a PR has been merged.
   */
  isPRMerged(prNumber: number, cwd?: string): boolean {
    const prInfo = getPRByNumber(prNumber, cwd)
    return prInfo?.state === 'MERGED'
  }
}
