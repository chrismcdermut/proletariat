/**
 * Execution Context Utilities
 *
 * Shared helpers for building ExecutionContext and detecting repository worktrees.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Detect git repository worktrees within an agent directory.
 *
 * Scans the agent directory for subdirectories that contain a .git file or folder,
 * indicating they are git repositories (either worktrees or clones).
 *
 * @param agentDir - The agent's working directory
 * @returns Array of repository directory names found within the agent directory
 */
export function detectRepoWorktrees(agentDir: string): string[] {
  if (!fs.existsSync(agentDir)) {
    return []
  }

  const agentContents = fs.readdirSync(agentDir)
  return agentContents.filter(item => {
    const itemPath = path.join(agentDir, item)
    const gitPath = path.join(itemPath, '.git')
    try {
      return fs.statSync(itemPath).isDirectory() && fs.existsSync(gitPath)
    } catch {
      // Handle permission errors or race conditions
      return false
    }
  })
}

/**
 * Determine the worktree path for an agent based on detected repositories.
 *
 * @param agentDir - The agent's working directory
 * @param repoWorktrees - Array of repository names (from detectRepoWorktrees)
 * @param fallbackPath - Path to use if no worktrees found (defaults to process.cwd())
 * @returns The resolved worktree path
 */
export function resolveWorktreePath(
  agentDir: string,
  repoWorktrees: string[],
  fallbackPath?: string
): string {
  if (repoWorktrees.length === 1) {
    // Single repo - open directly in the repo worktree
    return path.join(agentDir, repoWorktrees[0])
  } else if (repoWorktrees.length > 1) {
    // Multiple repos - use agent directory, let user navigate between them
    return agentDir
  } else {
    // No git worktrees found - use fallback
    return fallbackPath ?? process.cwd()
  }
}
