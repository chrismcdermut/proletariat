/**
 * Shipping Types — Git Provider Interface & Auto-Merge
 *
 * Provider-agnostic interface for git hosting operations needed by the
 * shipping/rebase pipeline and auto-merge orchestration. Implementations
 * exist for GitHub (via gh CLI) and can be added for GitLab, Bitbucket, etc.
 */

import type { PRInfo, MergeableState } from '../pr/index.js'

// =============================================================================
// Git Provider Interface (Sibling Rebase — PRLT-1143)
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

// =============================================================================
// Auto-Merge Types (PRLT-1144)
// =============================================================================

/**
 * Result of enabling or disabling auto-merge on a PR.
 */
export interface AutoMergeResult {
  success: boolean
  prNumber: number
  error?: string
  /** Whether auto-merge was already enabled when we tried to enable it */
  alreadyEnabled?: boolean
}

/**
 * Configuration for the when-green watch loop.
 */
export interface WhenGreenOptions {
  /** PR number to watch */
  prNumber: number
  /** Merge method (squash, merge, rebase) */
  method: 'merge' | 'squash' | 'rebase'
  /** Delete branch after merging */
  deleteBranch: boolean
  /** Use admin privileges to bypass branch protections */
  admin: boolean
  /** Fail on conflicts instead of auto-rebasing */
  noRebase: boolean
  /** Working directory for git operations */
  cwd?: string
  /** Head branch name */
  headBranch: string
  /** Base branch name */
  baseBranch: string
  /** Callback for progress messages */
  onProgress?: (msg: string) => void
  /** Callback for warning messages */
  onWarning?: (msg: string) => void
  /** Maximum time to wait in milliseconds (default: 60 minutes) */
  timeoutMs?: number
  /** Poll interval in milliseconds (default: 30 seconds) */
  pollIntervalMs?: number
}

/**
 * Result of the when-green watch loop.
 */
export interface WhenGreenResult {
  /** Whether the PR was successfully merged */
  merged: boolean
  /** Whether native auto-merge was enabled as a safety net */
  autoMergeEnabled: boolean
  /** Number of poll cycles completed */
  pollCycles: number
  /** Whether a rebase was performed during the watch */
  rebasePerformed: boolean
  /** Error message if the operation failed */
  error?: string
  /** Error code for JSON output */
  errorCode?: string
}

/**
 * Provider-agnostic interface for auto-merge operations.
 *
 * Each provider (GitHub, GitLab, etc.) implements these methods to enable
 * native auto-merge functionality.
 */
export interface AutoMergeProvider {
  /** Which provider this is */
  readonly name: 'github' | 'gitlab'

  /**
   * Enable native auto-merge on a PR.
   *
   * GitHub: `gh pr merge --auto --squash`
   * GitLab: merge when pipeline succeeds API
   */
  enableAutoMerge(
    prNumber: number,
    method: 'merge' | 'squash' | 'rebase',
    cwd?: string,
  ): AutoMergeResult

  /**
   * Disable native auto-merge on a PR.
   *
   * GitHub: `gh pr merge --disable-auto`
   */
  disableAutoMerge(prNumber: number, cwd?: string): AutoMergeResult

  /**
   * Check if a PR has been merged (by auto-merge or manually).
   */
  isPRMerged(prNumber: number, cwd?: string): boolean
}
