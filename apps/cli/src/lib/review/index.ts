/**
 * Review Worktree Utilities
 *
 * Manages persistent worktrees for human PR review and testing workflows.
 * Unlike ephemeral agent worktrees, review worktrees persist and allow
 * quick branch swapping for PR review, manual testing, and debugging.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { findHQRoot } from '../workspace.js';
import { getWorkspaceRepositories } from '../database/index.js';

export interface ReviewWorktree {
  name: string;
  path: string;
  currentBranch: string | null;
  repoName: string | null;
  createdAt: string;
  lastUsedAt: string;
}

/**
 * Get the review worktrees directory at HQ level.
 */
export function getReviewDir(hqPath?: string): string {
  const hq = hqPath || findHQRoot();
  if (!hq) {
    throw new Error('Not in an HQ workspace. Run "prlt init" first.');
  }
  return path.join(hq, 'review');
}

/**
 * Get the primary repository path in the HQ repos directory.
 * Returns the first 'main' type repository, or the first repository found.
 */
export function getPrimaryRepoPath(hqPath: string): { name: string; path: string } | null {
  const repos = getWorkspaceRepositories(hqPath);
  if (repos.length === 0) return null;

  // Prefer 'main' type repos
  const mainRepo = repos.find(r => r.type === 'main');
  const repo = mainRepo || repos[0];
  return {
    name: repo.name,
    path: path.join(hqPath, 'repos', repo.name),
  };
}

/**
 * Create a new review worktree.
 */
export function createReviewWorktree(
  name: string,
  hqPath: string,
  repoName?: string,
): { worktreePath: string; repoName: string; branch: string } {
  const reviewDir = getReviewDir(hqPath);
  const worktreePath = path.join(reviewDir, name);

  if (fs.existsSync(worktreePath)) {
    throw new Error(`Review worktree "${name}" already exists at ${worktreePath}`);
  }

  // Find the source repository
  let sourceRepo: { name: string; path: string };
  if (repoName) {
    const repoPath = path.join(hqPath, 'repos', repoName);
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository "${repoName}" not found in repos/`);
    }
    sourceRepo = { name: repoName, path: repoPath };
  } else {
    const primary = getPrimaryRepoPath(hqPath);
    if (!primary) {
      throw new Error('No repositories found. Add a repository first.');
    }
    sourceRepo = primary;
  }

  // Ensure review directory exists
  fs.mkdirSync(reviewDir, { recursive: true });

  // Determine the base ref (prefer origin/main)
  let baseRef = 'origin/main';
  try {
    execSync(`git rev-parse ${baseRef}`, { cwd: sourceRepo.path, stdio: 'pipe' });
  } catch {
    try {
      execSync('git rev-parse main', { cwd: sourceRepo.path, stdio: 'pipe' });
      baseRef = 'main';
    } catch {
      baseRef = 'HEAD';
    }
  }

  // Create a detached worktree (no branch needed for review worktrees)
  const branchName = `review/${name}`;
  try {
    execSync(`git worktree add "${worktreePath}" -b ${branchName} ${baseRef}`, {
      cwd: sourceRepo.path,
      stdio: 'pipe',
    });
  } catch {
    // Branch might already exist - try using it
    try {
      execSync(`git worktree add "${worktreePath}" ${branchName}`, {
        cwd: sourceRepo.path,
        stdio: 'pipe',
      });
    } catch {
      // Clean up and recreate
      try {
        execSync(`git branch -D ${branchName}`, { cwd: sourceRepo.path, stdio: 'pipe' });
      } catch { /* ignore */ }
      execSync(`git worktree add "${worktreePath}" -b ${branchName} ${baseRef}`, {
        cwd: sourceRepo.path,
        stdio: 'pipe',
      });
    }
  }

  return {
    worktreePath,
    repoName: sourceRepo.name,
    branch: branchName,
  };
}

/**
 * Remove a review worktree.
 */
export function removeReviewWorktree(name: string, hqPath: string): void {
  const reviewDir = getReviewDir(hqPath);
  const worktreePath = path.join(reviewDir, name);

  if (!fs.existsSync(worktreePath)) {
    throw new Error(`Review worktree "${name}" not found at ${worktreePath}`);
  }

  // Find the parent repo to prune the worktree
  // Read the .git file in the worktree to find the main repo
  const gitFile = path.join(worktreePath, '.git');
  let mainRepoPath: string | null = null;

  if (fs.existsSync(gitFile)) {
    const content = fs.readFileSync(gitFile, 'utf-8').trim();
    const match = content.match(/gitdir:\s*(.+)/);
    if (match) {
      // The .git file points to .git/worktrees/<name> in the main repo
      const worktreeGitDir = path.resolve(worktreePath, match[1]);
      // Go up from .git/worktrees/<name> to .git, then up to the repo root
      mainRepoPath = path.dirname(path.dirname(path.dirname(worktreeGitDir)));
    }
  }

  // Remove the worktree directory
  fs.rmSync(worktreePath, { recursive: true, force: true });

  // Prune worktrees in the main repo
  if (mainRepoPath && fs.existsSync(mainRepoPath)) {
    try {
      execSync('git worktree prune', { cwd: mainRepoPath, stdio: 'pipe' });
    } catch { /* ignore prune errors */ }

    // Clean up the review branch
    const branchName = `review/${name}`;
    try {
      execSync(`git branch -D ${branchName}`, { cwd: mainRepoPath, stdio: 'pipe' });
    } catch { /* branch may not exist */ }
  }
}

/**
 * Checkout a branch or PR into a review worktree.
 */
export function checkoutInReviewWorktree(
  worktreePath: string,
  branchOrPR: string,
): string {
  if (!fs.existsSync(worktreePath)) {
    throw new Error(`Review worktree not found at ${worktreePath}`);
  }

  // Check if it's a PR number
  const prNumber = /^\d+$/.test(branchOrPR) ? parseInt(branchOrPR, 10) : null;

  if (prNumber) {
    // Fetch and checkout PR using gh CLI
    try {
      execSync(`gh pr checkout ${prNumber} --force`, {
        cwd: worktreePath,
        stdio: 'pipe',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to checkout PR #${prNumber}: ${msg}`);
    }
  } else {
    // Regular branch checkout
    // Fetch first to get latest remote branches
    try {
      execSync('git fetch origin', { cwd: worktreePath, stdio: 'pipe' });
    } catch { /* offline or no remote */ }

    try {
      execSync(`git checkout ${branchOrPR}`, { cwd: worktreePath, stdio: 'pipe' });
    } catch {
      // Try checking out from remote
      try {
        execSync(`git checkout -b ${branchOrPR} origin/${branchOrPR}`, {
          cwd: worktreePath,
          stdio: 'pipe',
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to checkout branch "${branchOrPR}": ${msg}`);
      }
    }
  }

  // Get current branch after checkout
  const currentBranch = getCurrentBranchInWorktree(worktreePath);
  return currentBranch || branchOrPR;
}

/**
 * Get the current branch in a worktree.
 */
export function getCurrentBranchInWorktree(worktreePath: string): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}
