/**
 * Execution Context Utilities
 *
 * Shared helpers for building ExecutionContext and detecting repository worktrees.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import type { WorkspaceRepo, WorkspaceManifest } from './types.js'

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
 * @param fallbackPath - Path to use if no worktrees found (defaults to agentDir)
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
    // No git worktrees found - fall back to agentDir so the path stays
    // inside the Docker mount (process.cwd() is on the host and won't
    // resolve inside a container)
    return fallbackPath ?? agentDir
  }
}

// =============================================================================
// Workspace Repo Info (PRLT-1088)
// =============================================================================

/**
 * Get the GitHub remote (owner/repo) for a git repository.
 * Returns undefined if the remote can't be determined.
 */
function getGitRemote(repoPath: string): string | undefined {
  try {
    const url = execSync('git remote get-url origin', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    // Parse GitHub remote from various URL formats:
    // https://github.com/owner/repo.git -> owner/repo
    // git@github.com:owner/repo.git -> owner/repo
    const match = url.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/)
    return match ? match[1] : undefined
  } catch {
    return undefined
  }
}

/**
 * Get the current git branch for a repository.
 * Returns undefined if the branch can't be determined.
 */
function getGitBranch(repoPath: string): string | undefined {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Build structured workspace repo info from detected worktrees.
 *
 * @param agentDir - The agent's working directory (mounted at /workspace in container)
 * @param repoWorktrees - Array of repo directory names (from detectRepoWorktrees)
 * @param primaryRepoName - Name of the primary repo (first repo if not specified)
 * @returns Array of WorkspaceRepo objects with git metadata
 */
export function buildWorkspaceRepos(
  agentDir: string,
  repoWorktrees: string[],
  primaryRepoName?: string,
): WorkspaceRepo[] {
  if (repoWorktrees.length === 0) return []

  // If no primary specified, first repo is primary
  const primary = primaryRepoName || repoWorktrees[0]

  return repoWorktrees.map(name => {
    const repoPath = path.join(agentDir, name)
    return {
      name,
      path: `/workspace/${name}`,
      remote: getGitRemote(repoPath),
      branch: getGitBranch(repoPath),
      primary: name === primary,
    }
  })
}

/**
 * Write the workspace manifest (.prlt-workspace.json) to the agent directory.
 * This file tells the agent exactly what repos are available and what to work on.
 */
export function writeWorkspaceManifest(
  agentDir: string,
  manifest: WorkspaceManifest,
): void {
  const manifestPath = path.join(agentDir, '.prlt-workspace.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 })
}

/**
 * Read the workspace manifest (.prlt-workspace.json) from a directory.
 * Returns null if the manifest doesn't exist or can't be parsed.
 */
export function readWorkspaceManifest(dir: string): WorkspaceManifest | null {
  const manifestPath = path.join(dir, '.prlt-workspace.json')
  try {
    if (!fs.existsSync(manifestPath)) return null
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  } catch {
    return null
  }
}
