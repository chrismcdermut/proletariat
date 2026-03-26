/**
 * GitHub Git Provider
 *
 * Implements the GitProvider interface using the GitHub API (via `gh` CLI).
 * Uses the update-branch API endpoint for rebasing instead of local git operations.
 */

import { execSync } from 'node:child_process'
import type { PRInfo, MergeableState } from '../pr/index.js'
import {
  listOpenPRs,
  getMergeableState,
  getGitHubRepo,
  rebasePRBranch,
} from '../pr/index.js'
import type { GitProvider, UpdateBranchResult } from './types.js'

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
