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
