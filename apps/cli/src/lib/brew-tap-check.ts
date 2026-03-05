/**
 * Homebrew Tap Staleness Detection
 *
 * Detects when the local Homebrew tap checkout for chrismcdermut/proletariat
 * is behind origin/main. When stale, `brew upgrade prlt` silently does nothing
 * because Homebrew doesn't see the new formula. This module surfaces that
 * condition and provides copy-paste remediation commands.
 *
 * Only runs when the detected package manager is `brew`.
 */

import { execSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TAP_NAME = 'chrismcdermut/proletariat'
const TAP_REPO = 'chrismcdermut/homebrew-proletariat'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TapCheckResult {
  /** Whether the tap is stale (local HEAD behind origin/main) */
  isStale: boolean
  /** Human-readable explanation (empty when healthy) */
  message: string
  /** Copy-paste remediation commands (empty when healthy) */
  remediationCommands: string[]
}

// ---------------------------------------------------------------------------
// Tap path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the local path of the Homebrew tap.
 * Uses `brew --repository` which works on both Apple Silicon and Intel Macs.
 * Returns null if the tap is not installed or brew is not available.
 */
export function getTapPath(): string | null {
  try {
    const tapPath = execSync(`brew --repository ${TAP_NAME}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim()

    if (!tapPath) return null
    return tapPath
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Staleness check
// ---------------------------------------------------------------------------

/**
 * Get the local HEAD commit hash for the tap repo.
 */
function getLocalHead(tapPath: string): string | null {
  try {
    return execSync(`git -C "${tapPath}" rev-parse HEAD`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim()
  } catch {
    return null
  }
}

/**
 * Get the remote HEAD commit hash for origin/main.
 * Uses `git ls-remote` to avoid a full fetch.
 */
function getRemoteHead(tapPath: string): string | null {
  try {
    const output = execSync(
      `git -C "${tapPath}" ls-remote origin refs/heads/main`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      },
    ).trim()

    // Output format: "<hash>\trefs/heads/main"
    const hash = output.split('\t')[0]
    return hash || null
  } catch {
    return null
  }
}

/**
 * Build remediation commands for a stale tap.
 */
function buildRemediationCommands(): string[] {
  return [
    `brew tap --repair ${TAP_NAME}`,
    `brew update`,
    `brew upgrade ${TAP_NAME}/prlt`,
  ]
}

/**
 * Check whether the Homebrew tap is stale.
 *
 * A tap is considered stale when the local HEAD differs from origin/main.
 * Returns a result with `isStale: false` in any non-error non-stale case
 * (tap not installed, git unavailable, etc.) so the normal upgrade path
 * is never disrupted.
 */
export function checkTapStaleness(tapPath?: string | null): TapCheckResult {
  const healthy: TapCheckResult = {
    isStale: false,
    message: '',
    remediationCommands: [],
  }

  const resolvedPath = tapPath ?? getTapPath()
  if (!resolvedPath) return healthy

  const localHead = getLocalHead(resolvedPath)
  if (!localHead) return healthy

  const remoteHead = getRemoteHead(resolvedPath)
  if (!remoteHead) return healthy

  if (localHead === remoteHead) return healthy

  // Tap is stale
  const commands = buildRemediationCommands()
  return {
    isStale: true,
    message:
      `Your Homebrew tap "${TAP_REPO}" is out of date.\n` +
      'This can cause `brew upgrade prlt` to report "already installed" even when a newer version exists.\n' +
      'Run the following commands to fix it:',
    remediationCommands: commands,
  }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * Print the stale tap warning with remediation commands.
 * Returns true if a warning was printed.
 */
export async function printStaleTapWarning(
  result: TapCheckResult,
): Promise<boolean> {
  if (!result.isStale) return false

  const chalk = (await import('chalk')).default

  console.log('')
  console.log(chalk.yellow('Warning: Stale Homebrew tap detected'))
  console.log('')
  console.log(result.message)
  console.log('')
  for (const cmd of result.remediationCommands) {
    console.log(`  ${chalk.cyan(cmd)}`)
  }
  console.log('')

  return true
}
