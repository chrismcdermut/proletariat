import * as fs from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Check if a git repository has a GitHub remote configured.
 *
 * @param cwd - Directory to check (defaults to process.cwd())
 * @returns true if the repository has a GitHub remote
 */
export function hasGitHubRemote(cwd?: string): boolean {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return remoteUrl.includes('github.com');
  } catch {
    return false;
  }
}

/**
 * Check if a URL/path is a local filesystem path (not a remote URL).
 */
export function isLocalPath(urlOrPath: string): boolean {
  return !urlOrPath.startsWith('http://') &&
         !urlOrPath.startsWith('https://') &&
         !urlOrPath.startsWith('git@') &&
         !urlOrPath.startsWith('ssh://');
}

/**
 * Get the origin remote URL for a git repository.
 */
export function getOriginUrl(repoPath: string): string | null {
  try {
    const url = execSync('git remote get-url origin', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return url || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the actual GitHub/GitLab remote URL for a repository.
 *
 * When a repo is cloned from a local filesystem path, its origin points to that
 * local path. This function detects that case and resolves the real remote URL
 * by reading the source repo's remotes.
 *
 * Resolution strategy:
 * 1. Get the repo's origin URL
 * 2. If it's already a remote URL (https://, git@, ssh://), return it as-is
 * 3. If it's a local path, read that source repo's remotes to find a remote URL
 * 4. Prefer 'origin', then 'upstream', then any remote with a remote URL
 * 5. If no remote URL found, return the local path as fallback
 *
 * @param repoPath - Path to the git repository
 * @returns { url: string, isResolved: boolean, warning?: string }
 */
export function resolveRemoteUrl(repoPath: string): { url: string | null; isResolved: boolean; warning?: string } {
  const originUrl = getOriginUrl(repoPath);
  if (!originUrl) {
    return { url: null, isResolved: false, warning: 'No origin remote configured' };
  }

  // Already a remote URL — no resolution needed
  if (!isLocalPath(originUrl)) {
    return { url: originUrl, isResolved: false };
  }

  // Origin is a local path — try to resolve from the source repo
  const sourcePath = originUrl;

  // Verify the source path exists and is a git repo
  if (!fs.existsSync(sourcePath) || !isGitRepo(sourcePath)) {
    return { url: originUrl, isResolved: false, warning: `Source path ${sourcePath} is not a valid git repo` };
  }

  // Read all remotes from the source repo
  const remoteUrl = findRemoteUrl(sourcePath);
  if (remoteUrl) {
    return { url: remoteUrl, isResolved: true };
  }

  // No remote URL found in source — return local path with warning
  return {
    url: originUrl,
    isResolved: false,
    warning: `Source repo at ${sourcePath} has no remote URL configured (truly local-only repo)`,
  };
}

/**
 * Find the best remote URL from a git repository's configured remotes.
 * Prefers origin > upstream > any other remote.
 * Only returns actual remote URLs (not local paths).
 */
export function findRemoteUrl(repoPath: string): string | null {
  try {
    const output = execSync('git remote -v', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (!output) return null;

    // Parse remotes: "name\turl (fetch|push)"
    const remotes = new Map<string, string>();
    for (const line of output.split('\n')) {
      const match = line.match(/^(\S+)\t(\S+)\s+\(fetch\)$/);
      if (match) {
        const [, name, url] = match;
        if (!isLocalPath(url)) {
          remotes.set(name, url);
        }
      }
    }

    // Prefer origin, then upstream, then any remote
    return remotes.get('origin') ?? remotes.get('upstream') ?? remotes.values().next().value ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if a path is a git repository.
 */
export function isGitRepo(dir: string): boolean {
  try {
    execSync('git rev-parse --git-dir', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Update a git repository's origin URL to a new URL.
 */
export function setOriginUrl(repoPath: string, newUrl: string): void {
  execSync(`git remote set-url origin "${newUrl}"`, {
    cwd: repoPath,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Parse a GitHub URL into owner/repo format.
 * Supports:
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 *   ssh://git@github.com/owner/repo.git
 *
 * @returns "owner/repo" or null if not a GitHub URL
 */
export function parseGitHubOwnerRepo(url: string): string | null {
  const httpsMatch = url.match(/github\.com[/:]([^/]+)\/([^/.]+?)(\.git)?$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }
  return null;
}

/**
 * Check if a GitHub repository is archived using the `gh` CLI.
 *
 * @param ownerRepo - "owner/repo" format
 * @returns true if archived, false if not archived or if the check fails
 */
export function checkGitHubRepoArchived(ownerRepo: string): boolean {
  try {
    const result = execSync(`gh api repos/${ownerRepo} -q .archived`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result === 'true';
  } catch {
    // If gh CLI is not installed or API call fails, don't block the user
    return false;
  }
}

// =============================================================================
// Transferred Repo Detection
// =============================================================================

export interface TransferredRepoResult {
  transferred: boolean;
  oldOwnerRepo?: string;
  newOwnerRepo?: string;
  newUrl?: string;
  error?: string;
}

/**
 * Parse owner/repo from a GitHub remote URL.
 *
 * Handles formats:
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo
 * - git@github.com:owner/repo.git
 * - git@github.com:owner/repo
 * - ssh://git@github.com/owner/repo.git
 */
export function parseOwnerRepo(remoteUrl: string): string | null {
  const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);

  const match = httpsMatch || sshMatch;
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  return null;
}

/**
 * Detect if a GitHub repo has been transferred to a new org/owner.
 *
 * When a repo is transferred on GitHub, the API at the old owner/repo path
 * automatically redirects to the new location. We detect this by comparing
 * the local remote's owner/repo with what the GitHub API returns.
 *
 * @param cwd - Working directory of the git repo
 * @returns Transfer detection result
 */
export function detectTransferredRepo(cwd?: string): TransferredRepoResult {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Only works for GitHub remote URLs
    if (!remoteUrl.includes('github.com')) {
      return { transferred: false };
    }

    const localOwnerRepo = parseOwnerRepo(remoteUrl);
    if (!localOwnerRepo) {
      return { transferred: false };
    }

    // Query GitHub API — redirects are followed automatically
    let apiResult: string;
    try {
      apiResult = execSync(`gh api repos/${localOwnerRepo} --jq .full_name`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      // API call failed — repo may not exist or gh not authenticated
      return { transferred: false, error: 'Could not query GitHub API' };
    }

    if (!apiResult) {
      return { transferred: false };
    }

    // Compare: if the API returns a different owner/repo, the repo was transferred
    if (apiResult.toLowerCase() !== localOwnerRepo.toLowerCase()) {
      // Build the new URL in the same format as the old one
      const newUrl = buildNewRemoteUrl(remoteUrl, localOwnerRepo, apiResult);
      return {
        transferred: true,
        oldOwnerRepo: localOwnerRepo,
        newOwnerRepo: apiResult,
        newUrl,
      };
    }

    return { transferred: false };
  } catch {
    return { transferred: false };
  }
}

/**
 * Build a new remote URL preserving the protocol format of the old URL.
 */
function buildNewRemoteUrl(oldUrl: string, oldOwnerRepo: string, newOwnerRepo: string): string {
  // Replace owner/repo in the URL, preserving the protocol format
  return oldUrl.replace(
    oldOwnerRepo,
    newOwnerRepo,
  );
}

/**
 * Detect and fix a transferred GitHub repo by updating the origin remote.
 *
 * @param cwd - Working directory of the git repo
 * @returns Description of what was done, or null if no fix was needed
 */
export function detectAndFixTransferredRepo(cwd?: string): {
  fixed: boolean;
  oldOwnerRepo?: string;
  newOwnerRepo?: string;
  message?: string;
} {
  const result = detectTransferredRepo(cwd);

  if (!result.transferred || !result.newUrl) {
    return { fixed: false };
  }

  try {
    const effectiveCwd = cwd || process.cwd();
    setOriginUrl(effectiveCwd, result.newUrl);
    return {
      fixed: true,
      oldOwnerRepo: result.oldOwnerRepo,
      newOwnerRepo: result.newOwnerRepo,
      message: `Repository transferred from ${result.oldOwnerRepo} to ${result.newOwnerRepo}. Updated remote origin.`,
    };
  } catch {
    return {
      fixed: false,
      message: `Repository appears transferred from ${result.oldOwnerRepo} to ${result.newOwnerRepo}, but failed to update remote.`,
    };
  }
}
