/**
 * Commit Validation
 *
 * Validates that meaningful code was committed on an agent's branch
 * before marking work as complete. Prevents agents from reporting
 * success when they only committed boilerplate (README, config files)
 * or didn't commit anything at all.
 *
 * See: GH#762, PRLT-984
 */

import { execSync } from 'node:child_process'

// =============================================================================
// Types
// =============================================================================

export interface CommitValidationResult {
  /** Whether the validation passed (meaningful code was committed) */
  passed: boolean
  /** Total number of files changed */
  totalFiles: number
  /** Number of non-boilerplate code files changed */
  codeFiles: number
  /** Total lines added */
  totalInsertions: number
  /** Total lines removed */
  totalDeletions: number
  /** Lines added in non-boilerplate code files */
  codeInsertions: number
  /** True if only boilerplate files (README, LICENSE, etc.) were modified */
  boilerplateOnly: boolean
  /** True if no commits were found on the branch */
  noCommits: boolean
  /** Number of commits on the branch relative to base */
  commitCount: number
  /** Human-readable summary of the validation result */
  details: string
}

interface DiffFileStat {
  path: string
  insertions: number
  deletions: number
}

// =============================================================================
// Boilerplate Detection
// =============================================================================

/**
 * Filename patterns that don't count as "meaningful code".
 * These are files that agents commonly create as placeholder work
 * without implementing actual functionality.
 */
const BOILERPLATE_PATTERNS: RegExp[] = [
  // README variants
  /^readme\.md$/i,
  /^readme$/i,
  /^readme\.txt$/i,
  /^readme\.rst$/i,
  // License
  /^license$/i,
  /^license\.md$/i,
  /^license\.txt$/i,
  // Git config
  /^\.gitignore$/i,
  /^\.gitkeep$/i,
  /^\.gitattributes$/i,
  // Package manager config (scaffolding without code)
  /^\.npmignore$/i,
  /^\.npmrc$/i,
  /^\.nvmrc$/i,
  /^\.node-version$/i,
  /^\.python-version$/i,
  // Documentation
  /^changelog\.md$/i,
  /^changes\.md$/i,
  /^contributing\.md$/i,
  /^code_of_conduct\.md$/i,
  /^security\.md$/i,
  /^authors$/i,
  /^authors\.md$/i,
  // Editor / formatter config
  /^\.editorconfig$/i,
  /^\.prettierrc$/i,
  /^\.prettierrc\.json$/i,
  /^\.prettierrc\.ya?ml$/i,
  /^\.prettierignore$/i,
  /^\.eslintrc$/i,
  /^\.eslintrc\.json$/i,
  /^\.eslintrc\.ya?ml$/i,
  /^\.eslintignore$/i,
  // Docker config (not code)
  /^\.dockerignore$/i,
  /^Dockerfile$/i,
  /^docker-compose\.ya?ml$/i,
  // CI config files alone are not meaningful code
  /^\.github\/.*$/i,
  /^\.gitlab-ci\.ya?ml$/i,
  /^\.circleci\/.*$/i,
  /^\.travis\.ya?ml$/i,
]

function isBoilerplateFile(filePath: string): boolean {
  const basename = filePath.split('/').pop() || ''
  return BOILERPLATE_PATTERNS.some(pattern => pattern.test(basename))
}

// =============================================================================
// Git Helpers
// =============================================================================

/**
 * Find the base branch for comparison.
 * Tries origin/main, origin/master, then local main, local master, then HEAD.
 */
function findBaseBranch(repoPath: string): string {
  const candidates = ['origin/main', 'origin/master', 'main', 'master']
  for (const branch of candidates) {
    try {
      execSync(`git rev-parse --verify ${branch}`, {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return branch
    } catch {
      // Try next candidate
    }
  }
  return 'HEAD'
}

/**
 * Count the number of commits on a branch relative to a base.
 */
function getCommitCount(repoPath: string, base: string, branch: string): number {
  try {
    const output = execSync(`git rev-list --count ${base}..${branch}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return parseInt(output, 10) || 0
  } catch {
    return 0
  }
}

/**
 * Get the diff stats (files changed, insertions, deletions) between two refs.
 * Uses --numstat for machine-parseable output.
 */
function getDiffStats(repoPath: string, base: string, branch: string): DiffFileStat[] {
  try {
    const output = execSync(`git diff --numstat ${base}..${branch}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    if (!output) return []

    return output.split('\n').map(line => {
      const parts = line.split('\t')
      // Binary files show '-' for insertions/deletions
      const insertions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0
      const filePath = parts[2] || ''
      return { path: filePath, insertions, deletions }
    }).filter(f => f.path)
  } catch {
    return []
  }
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate that meaningful code was committed on a branch.
 *
 * Checks the diff between the branch and its base branch to determine
 * if the agent actually wrote code or just committed boilerplate.
 *
 * A branch passes validation if:
 * - It has at least one commit
 * - It modifies at least one non-boilerplate file
 * - The non-boilerplate files have at least one line inserted
 *
 * @param repoPath - Path to the git repository
 * @param branch - Branch name to validate (must be checked out or reachable)
 * @param baseBranch - Base branch to compare against (auto-detected if omitted)
 */
export function validateCommits(
  repoPath: string,
  branch: string,
  baseBranch?: string,
): CommitValidationResult {
  const base = baseBranch || findBaseBranch(repoPath)

  // Check if the branch ref exists
  try {
    execSync(`git rev-parse --verify ${branch}`, {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    return {
      passed: false,
      totalFiles: 0,
      codeFiles: 0,
      totalInsertions: 0,
      totalDeletions: 0,
      codeInsertions: 0,
      boilerplateOnly: false,
      noCommits: true,
      commitCount: 0,
      details: `Branch "${branch}" not found in repository`,
    }
  }

  // Get commit count
  const commitCount = getCommitCount(repoPath, base, branch)
  if (commitCount === 0) {
    return {
      passed: false,
      totalFiles: 0,
      codeFiles: 0,
      totalInsertions: 0,
      totalDeletions: 0,
      codeInsertions: 0,
      boilerplateOnly: false,
      noCommits: true,
      commitCount: 0,
      details: 'No commits found on branch',
    }
  }

  // Get diff stats
  const files = getDiffStats(repoPath, base, branch)
  if (files.length === 0) {
    return {
      passed: false,
      totalFiles: 0,
      codeFiles: 0,
      totalInsertions: 0,
      totalDeletions: 0,
      codeInsertions: 0,
      boilerplateOnly: false,
      noCommits: false,
      commitCount,
      details: 'No file changes found in diff',
    }
  }

  // Classify files
  const codeFiles = files.filter(f => !isBoilerplateFile(f.path))
  const boilerplateOnly = codeFiles.length === 0

  // Calculate totals
  const totalInsertions = files.reduce((sum, f) => sum + f.insertions, 0)
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0)
  const codeInsertions = codeFiles.reduce((sum, f) => sum + f.insertions, 0)

  // Validation: at least one non-boilerplate file with meaningful changes
  const passed = codeFiles.length > 0 && codeInsertions > 0

  let details: string
  if (boilerplateOnly) {
    const fileNames = files.map(f => f.path).join(', ')
    details = `Only boilerplate files modified: ${fileNames} (${commitCount} commit${commitCount !== 1 ? 's' : ''})`
  } else if (codeInsertions === 0) {
    details = `${codeFiles.length} code file(s) touched but no insertions (${commitCount} commit${commitCount !== 1 ? 's' : ''})`
  } else {
    details = `${codeFiles.length} code file(s), +${codeInsertions}/-${totalDeletions} lines across ${commitCount} commit${commitCount !== 1 ? 's' : ''}`
  }

  return {
    passed,
    totalFiles: files.length,
    codeFiles: codeFiles.length,
    totalInsertions,
    totalDeletions,
    codeInsertions,
    boilerplateOnly,
    noCommits: false,
    commitCount,
    details,
  }
}

/**
 * Try to validate commits for an execution, resolving the repository path
 * from the agent's workspace directory.
 *
 * For container-based executions where the repo might not be accessible
 * from the host, this function tries the container first, then falls back
 * to the host filesystem.
 *
 * @param agentDir - Agent's workspace directory on the host
 * @param branch - Branch name to validate
 * @param repoWorktrees - Optional list of repo worktree names within agentDir
 * @returns Validation result, or null if the repository couldn't be accessed
 */
export function tryValidateCommits(
  agentDir: string,
  branch: string,
  repoWorktrees?: string[],
): CommitValidationResult | null {
  const { existsSync } = require('node:fs')
  const { join } = require('node:path')

  // Determine which repo paths to check
  const repoPaths: string[] = []
  if (repoWorktrees && repoWorktrees.length > 0) {
    for (const wt of repoWorktrees) {
      repoPaths.push(join(agentDir, wt))
    }
  } else {
    repoPaths.push(agentDir)
  }

  // Try each repo path
  for (const repoPath of repoPaths) {
    if (!existsSync(repoPath)) continue

    // Verify it's a git repo
    try {
      execSync('git rev-parse --git-dir', {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      continue
    }

    return validateCommits(repoPath, branch)
  }

  return null
}
