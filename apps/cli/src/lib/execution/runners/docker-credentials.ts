/**
 * Docker Credential Helpers
 *
 * Functions for checking and managing Claude Code credentials
 * in Docker volumes, host filesystem, and macOS keychain.
 * Also includes tmux server keychain access management.
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const CLAUDE_CREDENTIALS_VOLUME = 'claude-credentials'

/**
 * Check if the claude-credentials Docker volume exists.
 */
export function credentialsVolumeExists(): boolean {
  try {
    execSync(`docker volume inspect ${CLAUDE_CREDENTIALS_VOLUME}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Check if valid Claude OAuth credentials exist in the Docker volume.
 * Returns true if OAuth credentials are stored (even if access token is expired,
 * since Claude Code handles refresh internally using stored refresh tokens).
 *
 * Uses `docker volume inspect` to check volume existence (lightweight, no image pull).
 * Then attempts to read the credentials file with `--pull never` to avoid requiring
 * Docker Hub auth (which fails on locked keychains / headless environments).
 * Falls back to volume existence as a reasonable proxy — the volume is only created
 * by `prlt agent auth` with valid credentials.
 *
 * NOTE: This intentionally does NOT check for ANTHROPIC_API_KEY. If the user
 * has an API key but no OAuth credentials, we want to prompt them to set up
 * OAuth (which uses their Max subscription) rather than silently burning API credits.
 */
export function dockerCredentialsExist(): boolean {
  // First check: does the volume exist at all?
  if (!credentialsVolumeExists()) {
    return false
  }

  // Try to read the credentials file without pulling any image.
  // --pull never ensures we never hit Docker Hub (fixes locked keychain / headless).
  try {
    const result = execSync(
      `docker run --rm --pull never -v ${CLAUDE_CREDENTIALS_VOLUME}:/data alpine cat /data/.credentials.json 2>/dev/null`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 10000 }
    )

    const creds = JSON.parse(result)
    if (creds.claudeAiOauth?.accessToken) {
      return true
    }
    return false
  } catch {
    // alpine image not cached locally — fall back to volume existence.
    // The volume is created by `prlt agent auth` with valid credentials,
    // so its presence is a reasonable proxy.
    return true
  }
}

/**
 * Get Docker credential info for display.
 * Returns expiration date and subscription type if available.
 *
 * Uses --pull never to avoid requiring Docker Hub auth (fixes locked keychain / headless).
 */
export function getDockerCredentialInfo(): { expiresAt: Date; subscriptionType?: string } | null {
  try {
    const result = execSync(
      `docker run --rm --pull never -v ${CLAUDE_CREDENTIALS_VOLUME}:/data alpine cat /data/.credentials.json 2>/dev/null`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 10000 }
    )

    const creds = JSON.parse(result)
    if (creds.claudeAiOauth?.expiresAt) {
      return {
        expiresAt: new Date(creds.claudeAiOauth.expiresAt),
        subscriptionType: creds.claudeAiOauth.subscriptionType,
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * PRLT-1296: Refresh the claude-credentials Docker volume with fresh credentials from the host.
 *
 * OAuth tokens expire every ~24h. The host's Claude Code auto-refreshes its tokens,
 * but the Docker volume is a snapshot that goes stale. This copies the host's current
 * credentials into the volume before each container spawn, ensuring fresh tokens.
 *
 * Creates the volume if it doesn't exist.
 * Sets file ownership to UID 1000 (node user) so the container can read them.
 *
 * @returns true if credentials were refreshed successfully, false otherwise
 */
export function refreshCredentialVolume(): boolean {
  const homeDir = process.env.HOME || os.homedir()
  const hostCredPath = path.join(homeDir, '.claude', '.credentials.json')

  // Check if host has credentials to copy
  if (!fs.existsSync(hostCredPath)) {
    console.debug('[runners:credentials] No host credentials at ~/.claude/.credentials.json, skipping refresh')
    return false
  }

  try {
    // Use a temporary container to copy host credentials into the named volume.
    // -v ~/.claude:/src:ro  → mount host credentials read-only
    // -v claude-credentials:/dest  → mount the target volume
    // cp + chown ensures node user (UID 1000) owns the file inside the container.
    // --pull never avoids Docker Hub auth issues on locked keychains / headless environments.
    const refreshCmd = [
      'docker run --rm --pull never',
      `-v "${path.join(homeDir, '.claude')}:/src:ro"`,
      `-v "${CLAUDE_CREDENTIALS_VOLUME}:/dest"`,
      `alpine sh -c 'cp /src/.credentials.json /dest/.credentials.json && chown 1000:1000 /dest/.credentials.json'`,
    ].join(' ')

    execSync(refreshCmd, { stdio: 'pipe', timeout: 15000 })
    console.debug('[runners:credentials] Refreshed credential volume with host credentials')
    return true
  } catch (error) {
    // alpine image may not be cached — try with node:22 which is already pulled for agent builds
    try {
      const fallbackCmd = [
        'docker run --rm --pull never',
        `-v "${path.join(homeDir, '.claude')}:/src:ro"`,
        `-v "${CLAUDE_CREDENTIALS_VOLUME}:/dest"`,
        `node:22 bash -c 'cp /src/.credentials.json /dest/.credentials.json && chown 1000:1000 /dest/.credentials.json'`,
      ].join(' ')

      execSync(fallbackCmd, { stdio: 'pipe', timeout: 15000 })
      console.debug('[runners:credentials] Refreshed credential volume with host credentials (node:22 fallback)')
      return true
    } catch {
      console.debug('[runners:credentials] Failed to refresh credential volume:', error)
      return false
    }
  }
}

/**
 * Check if Claude Code authentication is available on the host system.
 * Returns true if any of:
 * 1. ANTHROPIC_API_KEY environment variable is set
 * 2. OAuth credentials exist in ~/.claude/.credentials.json (Claude Code 1.x)
 * 3. OAuth credentials exist in macOS keychain (Claude Code 2.x)
 */
export function hostCredentialsExist(): boolean {
  if (process.env.ANTHROPIC_API_KEY) {
    return true
  }

  try {
    const homeDir = process.env.HOME || os.homedir()
    const credPath = path.join(homeDir, '.claude', '.credentials.json')
    if (fs.existsSync(credPath)) {
      const credData = fs.readFileSync(credPath, 'utf-8')
      const creds = JSON.parse(credData)
      if (creds.claudeAiOauth?.accessToken) {
        return true
      }
    }
  } catch {
    // Fall through to keychain check
  }

  if (process.platform === 'darwin') {
    try {
      execSync('security find-generic-password -s "Claude Code-credentials" 2>/dev/null', {
        stdio: 'pipe',
        timeout: 5000,
      })
      return true
    } catch {
      // Keychain entry not found or keychain is locked
    }
  }

  return false
}

/**
 * Ensure tmux server has keychain access for Claude Code OAuth.
 *
 * On macOS, tmux sessions can lose access to the keychain if the tmux server
 * was started in a context without keychain access. This function tests and
 * restarts the tmux server if needed.
 */
export async function ensureTmuxServerHasKeychainAccess(): Promise<void> {
  try {
    const serverRunning = execSync('tmux list-sessions 2>/dev/null || echo ""', {
      encoding: 'utf-8',
      stdio: 'pipe'
    })
    if (!serverRunning.trim()) {
      return
    }
  } catch {
    return
  }

  const testSession = `prlt-keychain-test-${Date.now()}`

  try {
    execSync(`tmux new-session -d -s "${testSession}"`, { stdio: 'pipe' })
    execSync(
      `tmux send-keys -t "${testSession}" "unset CLAUDECODE && claude -p 'test' 2>&1 | head -1" Enter`,
      { stdio: 'pipe' }
    )
    await new Promise(resolve => setTimeout(resolve, 3000))
    const output = execSync(`tmux capture-pane -t "${testSession}" -p`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    })
    execSync(`tmux kill-session -t "${testSession}"`, { stdio: 'pipe' })

    if (output.includes('Not logged in') || output.includes('Please run /login')) {
      execSync('tmux kill-server', { stdio: 'pipe' })
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 300))
        try {
          execSync('tmux list-sessions 2>/dev/null', { stdio: 'pipe' })
        } catch {
          break
        }
      }
    }
  } catch {
    try {
      execSync(`tmux kill-session -t "${testSession}"`, { stdio: 'pipe' })
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Copy Claude Code credentials (~/.claude.json) into the agent directory.
 * This makes the subscription credentials available inside the devcontainer.
 */
export function copyClaudeCredentials(agentDir: string): void {
  const sourceFile = path.join(os.homedir(), '.claude.json')
  const destFile = path.join(agentDir, '.claude.json')

  if (fs.existsSync(sourceFile)) {
    try {
      fs.copyFileSync(sourceFile, destFile)
      console.debug('[runners:credentials] Copied .claude.json to workspace')
    } catch (err) {
      console.debug('[runners:credentials] Failed to copy .claude.json:', err)
    }
  }
}
