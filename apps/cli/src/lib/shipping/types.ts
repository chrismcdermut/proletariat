/**
 * Shipping Types — Git Provider Interface
 *
 * Provider-agnostic interface for git hosting operations needed by the
 * shipping/rebase pipeline. Implementations exist for GitHub (via gh CLI)
 * and can be added for GitLab, Bitbucket, etc.
 */

import type { PRInfo, MergeableState, RebasePRResult } from '../pr/index.js'

// =============================================================================
// Git Provider Interface
// =============================================================================

/**
 * Supported git hosting provider names.
 */
export type GitProviderName = 'github' | 'gitlab'

/**
 * Result of attempting to update (rebase) a PR branch via the provider API.
 */
export interface UpdateBranchResult {
  success: boolean
  /** PR number that was updated */
  prNumber: number
  /** Head branch name */
  headBranch: string
  /** Error message if the update failed */
  error?: string
  /** Whether the failure was due to merge conflicts */
  hasConflicts?: boolean
}

/**
 * Result of the full sibling rebase operation across all PRs.
 */
export interface SiblingRebaseResult {
  /** PRs that were successfully rebased */
  succeeded: UpdateBranchResult[]
  /** PRs that failed to rebase (conflicts or other errors) */
  failed: UpdateBranchResult[]
  /** PRs that were skipped (already up to date) */
  skipped: UpdateBranchResult[]
  /** Total open PRs checked */
  totalChecked: number
}

/**
 * Options for the rebaseSiblingPRs operation.
 */
export interface RebaseSiblingOptions {
  /** PR number to exclude (the one that was just merged) */
  excludePRNumber: number | null
  /** Working directory for git operations */
  cwd?: string
  /** Callback for progress messages */
  onProgress?: (msg: string) => void
  /** Whether to add a 'rebase-conflict' label on conflict failures */
  labelConflicts?: boolean
  /** Whether to add a comment on conflict failures */
  commentOnConflicts?: boolean
  /** Whether to attempt all PRs or just conflicting ones */
  rebaseAll?: boolean
}

/**
 * Provider-agnostic interface for git hosting operations.
 *
 * Each provider (GitHub, GitLab, etc.) implements this interface to enable
 * API-based branch updates instead of local git rebase + force-push.
 *
 * API-based updates are preferred because:
 * - They don't require a local checkout
 * - They work in CI/CD environments without full git history
 * - They use the hosting provider's merge infrastructure
 * - They avoid force-push permission issues
 */
export interface GitProvider {
  /** Which provider this is */
  readonly name: GitProviderName

  /**
   * List all open PRs/MRs in the repository.
   */
  listOpenPRs(cwd?: string): PRInfo[]

  /**
   * Get the mergeable state of a PR/MR.
   */
  getMergeableState(prNumber: number, cwd?: string): MergeableState

  /**
   * Update a PR branch to include the latest changes from its base branch.
   *
   * GitHub: PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch
   * GitLab: PUT /projects/{id}/merge_requests/{merge_request_iid}/rebase
   *
   * This is the API-based alternative to local git rebase + force-push.
   * Falls back to local git rebase if the API call fails.
   */
  updatePRBranch(prNumber: number, cwd?: string): UpdateBranchResult

  /**
   * Add a label to a PR/MR.
   */
  addLabel(prNumber: number, label: string, cwd?: string): boolean

  /**
   * Add a comment to a PR/MR.
   */
  addComment(prNumber: number, body: string, cwd?: string): boolean
}
