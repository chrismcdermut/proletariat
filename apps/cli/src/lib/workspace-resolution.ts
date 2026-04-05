/**
 * Workspace Resolution for Ticketless Work
 *
 * Auto-detects the directory type and resolves the appropriate working
 * directory for an agent. Handles git repos, non-git directories, and
 * headless (no directory) mode.
 *
 * Resolution rules:
 *   1. Git repo (default)     → create worktree for isolation
 *   2. Git repo + noWorktree  → work in-place
 *   3. Non-git directory      → work in-place (auto-detected)
 *   4. No directory specified  → create temp workspace (headless mode)
 *   5. --repo URL             → clone into temp dir (handled by caller)
 *
 * The caller should not need to specify a mode — this module detects
 * git vs non-git and does the right thing.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'

// =============================================================================
// Types
// =============================================================================

export type WorkspaceMode = 'worktree' | 'in-place' | 'headless'

export interface ResolvedWorkspace {
  /** Actual directory the agent will work in */
  workDir: string
  /** Original source directory (same as workDir for in-place/headless) */
  sourceDir: string
  /** Whether the directory is inside a git repository */
  isGitRepo: boolean
  /** Current git branch (null if not a git repo) */
  branch: string | null
  /** How the workspace was resolved */
  mode: WorkspaceMode
  /** Whether the workspace is a temporary directory (should be cleaned up) */
  isTemp: boolean
}

// =============================================================================
// Git Detection
// =============================================================================

/**
 * Check if a directory is inside a git repository.
 */
export function isGitRepo(dir: string): boolean {
  try {
    execSync('git rev-parse --git-dir', {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    })
    return true
  } catch {
    return false
  }
}

/**
 * Get the git root directory for a path.
 */
export function getGitRoot(dir: string): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * Get the current git branch.
 */
export function getCurrentBranch(dir: string): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

// =============================================================================
// Worktree Management
// =============================================================================

/**
 * Create a git worktree for isolated agent work.
 * Returns the path to the new worktree directory.
 */
export function createWorktree(repoDir: string, agentName: string): string {
  const gitRoot = getGitRoot(repoDir)
  if (!gitRoot) {
    throw new Error(`Not a git repository: ${repoDir}`)
  }

  // Create worktree in a sibling directory to avoid polluting the repo
  const worktreeBase = path.join(os.tmpdir(), 'prlt-worktrees')
  fs.mkdirSync(worktreeBase, { recursive: true })

  const worktreeDir = path.join(worktreeBase, `${agentName}-${Date.now()}`)
  const branchName = `prlt-run/${agentName}-${Date.now()}`

  // Get the current HEAD as the base for the worktree
  const baseRef = getCurrentBranch(gitRoot) || 'HEAD'

  execSync(`git worktree add "${worktreeDir}" -b "${branchName}" "${baseRef}"`, {
    cwd: gitRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  return worktreeDir
}

// =============================================================================
// Temp Workspace (Headless Mode)
// =============================================================================

/**
 * Create a temporary workspace directory for headless work.
 * Used when no --dir or --repo is specified (research, thinking, non-code tasks).
 */
export function createTempWorkspace(agentName: string): string {
  const tmpBase = path.join(os.tmpdir(), 'prlt-workspaces')
  fs.mkdirSync(tmpBase, { recursive: true })
  const tmpDir = path.join(tmpBase, `${agentName}-${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  return tmpDir
}

// =============================================================================
// Resolve Workspace
// =============================================================================

/**
 * Resolve the workspace for a ticketless work run.
 *
 * Auto-detects git vs non-git and chooses the appropriate strategy:
 * - Git repo → worktree (default) or in-place (--no-worktree)
 * - Non-git dir → in-place
 * - No dir → temp workspace (headless)
 *
 * @param options Resolution options
 * @returns Resolved workspace info
 */
export function resolveWorkspace(options: {
  /** Explicit directory (--dir flag) */
  dir?: string
  /** Agent name (for worktree/temp naming) */
  agentName: string
  /** Skip worktree creation even for git repos (--no-worktree) */
  noWorktree?: boolean
}): ResolvedWorkspace {
  const { dir, agentName, noWorktree = false } = options

  // ─── No directory: headless mode ──────────────────────────────
  if (!dir) {
    const tmpDir = createTempWorkspace(agentName)
    return {
      workDir: tmpDir,
      sourceDir: tmpDir,
      isGitRepo: false,
      branch: null,
      mode: 'headless',
      isTemp: true,
    }
  }

  // ─── Explicit directory ───────────────────────────────────────
  const resolvedDir = path.resolve(dir)
  const gitRepo = isGitRepo(resolvedDir)

  if (!gitRepo) {
    // Non-git directory: work in-place (auto-detected)
    return {
      workDir: resolvedDir,
      sourceDir: resolvedDir,
      isGitRepo: false,
      branch: null,
      mode: 'in-place',
      isTemp: false,
    }
  }

  // Git repo
  if (noWorktree) {
    // User opted out of worktree isolation
    return {
      workDir: resolvedDir,
      sourceDir: resolvedDir,
      isGitRepo: true,
      branch: getCurrentBranch(resolvedDir),
      mode: 'in-place',
      isTemp: false,
    }
  }

  // Default: create worktree for isolation
  try {
    const worktreeDir = createWorktree(resolvedDir, agentName)
    return {
      workDir: worktreeDir,
      sourceDir: resolvedDir,
      isGitRepo: true,
      branch: getCurrentBranch(worktreeDir),
      mode: 'worktree',
      isTemp: true,
    }
  } catch {
    // Worktree creation failed — fall back to in-place
    return {
      workDir: resolvedDir,
      sourceDir: resolvedDir,
      isGitRepo: true,
      branch: getCurrentBranch(resolvedDir),
      mode: 'in-place',
      isTemp: false,
    }
  }
}
