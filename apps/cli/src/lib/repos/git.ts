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
