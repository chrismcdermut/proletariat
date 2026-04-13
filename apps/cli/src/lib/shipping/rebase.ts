/**
 * Sibling PR Rebase — Provider-Agnostic
 *
 * After a PR merges, the base branch advances. Other open PRs may become
 * stale or conflicting. This module rebases sibling PRs using the git
 * provider's API (e.g., GitHub's update-branch endpoint), falling back
 * to local git rebase when the API is unavailable.
 *
 * On conflict, optionally labels the PR and adds a comment so the
 * author knows manual resolution is needed.
 */

import type {
  GitProvider,
  RebaseSiblingOptions,
  SiblingRebaseResult,
} from './types.js'
import { GitHubProvider } from './github.js'

const CONFLICT_LABEL = 'rebase-conflict'
const CONFLICT_COMMENT =
  'This PR has merge conflicts with the base branch after a recent merge. ' +
  'Please rebase or merge the base branch to resolve conflicts.'

/**
 * Detect the git provider for the current repository.
 *
 * Currently supports GitHub. Returns null if the provider cannot be detected.
 * GitLab support can be added here by checking the remote URL.
 */
export function detectGitProvider(_cwd?: string): GitProvider | null {
  // For now, default to GitHub since it's the only implemented provider.
  // When GitLab/Bitbucket providers are added, detect from the remote URL:
  //   git remote get-url origin → github.com = GitHub, gitlab.com = GitLab, etc.
  return new GitHubProvider()
}

/**
 * Rebase all open sibling PRs after a merge.
 *
 * This is the main entry point for post-merge sibling rebase.
 * It uses the git provider's API to update branches, which is cleaner
 * than local git rebase + force-push because:
 * - No local checkout needed
 * - Works in CI/CD without full git history
 * - Uses the provider's merge infrastructure
 * - Avoids force-push permission issues
 *
 * @param options - Configuration for the rebase operation
 * @param provider - Git provider to use (auto-detected if not provided)
 * @returns Results of the rebase operation for each PR
 */
export function rebaseSiblingPRs(
  options: RebaseSiblingOptions,
  provider?: GitProvider | null,
): SiblingRebaseResult {
  const gitProvider = provider ?? detectGitProvider(options.cwd)
  if (!gitProvider) {
    return {
      succeeded: [],
      failed: [],
      skipped: [],
      totalChecked: 0,
    }
  }

  const {
    excludePRNumber,
    cwd,
    onProgress,
    labelConflicts = true,
    commentOnConflicts = true,
    rebaseAll = false,
  } = options

  const openPRs = gitProvider.listOpenPRs(cwd)
  const result: SiblingRebaseResult = {
    succeeded: [],
    failed: [],
    skipped: [],
    totalChecked: 0,
  }

  for (const pr of openPRs) {
    // Skip the PR that was just merged
    if (pr.number === excludePRNumber) continue

    result.totalChecked++

    // Check mergeable state unless rebaseAll is set
    if (!rebaseAll) {
      const state = gitProvider.getMergeableState(pr.number, cwd)
      if (state === 'MERGEABLE') {
        result.skipped.push({
          success: true,
          prNumber: pr.number,
          headBranch: pr.headBranch,
        })
        continue
      }

      // Skip UNKNOWN state PRs — we can't determine if they need rebase
      if (state === 'UNKNOWN') {
        result.skipped.push({
          success: true,
          prNumber: pr.number,
          headBranch: pr.headBranch,
        })
        continue
      }
    }

    onProgress?.(`Updating PR #${pr.number} (${pr.headBranch})...`)

    const updateResult = gitProvider.updatePRBranch(pr.number, cwd)

    if (updateResult.success) {
      result.succeeded.push(updateResult)
    } else {
      result.failed.push(updateResult)

      // Label and comment on conflict failures
      if (updateResult.hasConflicts) {
        if (labelConflicts) {
          gitProvider.addLabel(pr.number, CONFLICT_LABEL, cwd)
        }

        if (commentOnConflicts) {
          gitProvider.addComment(pr.number, CONFLICT_COMMENT, cwd)
        }
      }
    }
  }

  return result
}
