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

/**
 * Detect if a GitHub repository has been transferred to a new org/owner.
 *
 * Queries the GitHub API with the local remote's owner/repo and compares
 * the API-returned full_name to detect if the repo was transferred.
 * GitHub automatically redirects API calls for transferred repos.
 *
 * @param cwd - Working directory of the git repo
 * @returns Object with transfer details, or null if no transfer detected or check fails
 */
export function detectTransferredRepo(cwd?: string): { oldOwnerRepo: string; newOwnerRepo: string } | null {
  const originUrl = getOriginUrl(cwd || process.cwd());
  if (!originUrl) return null;

  const localOwnerRepo = parseGitHubOwnerRepo(originUrl);
  if (!localOwnerRepo) return null;

  try {
    const result = execSync(`gh api repos/${localOwnerRepo} -q .full_name`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (!result) return null;

    // Compare case-insensitively since GitHub treats owner/repo as case-insensitive
    if (result.toLowerCase() !== localOwnerRepo.toLowerCase()) {
      return { oldOwnerRepo: localOwnerRepo, newOwnerRepo: result };
    }

    return null;
  } catch {
    // API call failed — don't block the user
    return null;
  }
}

/**
 * Build a new remote URL preserving the original URL format (HTTPS or SSH).
 *
 * @param originalUrl - The original remote URL (used to determine format)
 * @param newOwnerRepo - The new "owner/repo" to use
 * @returns The new URL in the same format as the original
 */
export function buildRemoteUrl(originalUrl: string, newOwnerRepo: string): string {
  // SSH format: git@github.com:owner/repo.git
  if (originalUrl.startsWith('git@github.com:')) {
    const hadGitSuffix = originalUrl.endsWith('.git');
    return `git@github.com:${newOwnerRepo}${hadGitSuffix ? '.git' : ''}`;
  }

  // SSH alternative: ssh://git@github.com/owner/repo.git
  if (originalUrl.startsWith('ssh://git@github.com/')) {
    const hadGitSuffix = originalUrl.endsWith('.git');
    return `ssh://git@github.com/${newOwnerRepo}${hadGitSuffix ? '.git' : ''}`;
  }

  // HTTPS format: https://github.com/owner/repo.git
  const hadGitSuffix = originalUrl.endsWith('.git');
  return `https://github.com/${newOwnerRepo}${hadGitSuffix ? '.git' : ''}`;
}

/**
 * Detect if a repo has been transferred and update the origin remote URL if so.
 *
 * @param cwd - Working directory of the git repo
 * @returns Object describing what happened, or null if no action taken
 */
export function detectAndFixTransferredRepo(cwd?: string): { oldOwnerRepo: string; newOwnerRepo: string; oldUrl: string; newUrl: string } | null {
  const transfer = detectTransferredRepo(cwd);
  if (!transfer) return null;

  const repoPath = cwd || process.cwd();
  const originUrl = getOriginUrl(repoPath);
  if (!originUrl) return null;

  const newUrl = buildRemoteUrl(originUrl, transfer.newOwnerRepo);
  setOriginUrl(repoPath, newUrl);

  return {
    oldOwnerRepo: transfer.oldOwnerRepo,
    newOwnerRepo: transfer.newOwnerRepo,
    oldUrl: originUrl,
    newUrl,
  };
}

/**
 * Ensure the git remote is up to date before push/PR operations.
 *
 * This is the single entry point that should be called at the command level
 * (in pr create and work ready) before any push or PR creation.
 * It detects transferred repos and updates the remote URL.
 *
 * @param cwd - Working directory of the git repo
 * @param log - Optional callback for logging messages to the user
 * @returns Object describing what happened, or null if no action taken
 */
export function ensureRemoteUpToDate(
  cwd?: string,
  log?: (message: string) => void,
): { oldOwnerRepo: string; newOwnerRepo: string; oldUrl: string; newUrl: string } | null {
  const result = detectAndFixTransferredRepo(cwd);
  if (result && log) {
    log(`Repo transferred: ${result.oldOwnerRepo} → ${result.newOwnerRepo}. Updated remote URL.`);
  }
  return result;
}
