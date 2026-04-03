/**
 * Claude Code Version Management (PRLT-1240)
 *
 * Utilities for detecting Claude Code versions in containers and generating
 * version-appropriate permission settings for ~/.claude/settings.json.
 *
 * PRLT-1240: Container agents now use -p (print) mode which skips all onboarding
 * prompts. Version detection is kept for settings.json compatibility but the
 * version pin (CC_DEFAULT_VERSION) and launcher wrapper are no longer needed.
 */

import { execSync } from 'node:child_process'

// =============================================================================
// Constants
// =============================================================================

/**
 * Version where Claude Code changed the permissions prompt settings format.
 * Versions >= this require additional settings to suppress the prompt.
 */
export const CC_BREAKING_VERSION = '2.1.86'

// =============================================================================
// Version Detection
// =============================================================================

/**
 * Detect the installed Claude Code version inside a container.
 * Returns the version string (e.g., "2.1.86") or undefined if detection fails.
 */
export function detectCCVersionInContainer(containerId: string): string | undefined {
  try {
    const output = execSync(
      `docker exec ${containerId} claude --version 2>/dev/null`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000 }
    ).trim()
    return parseCCVersionOutput(output)
  } catch {
    return undefined
  }
}

/**
 * Parse Claude Code version from `claude --version` output.
 * The output format is typically "claude <version>" or just "<version>".
 * Returns the version string or undefined if parsing fails.
 */
export function parseCCVersionOutput(output: string): string | undefined {
  if (!output) return undefined
  // Match version pattern: digits.digits.digits (with optional pre-release suffix)
  const match = output.match(/(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/)
  return match ? match[1] : undefined
}

// =============================================================================
// Version Comparison
// =============================================================================

/**
 * Compare two semver version strings.
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b.
 * Only compares major.minor.patch — ignores pre-release suffixes.
 */
export function compareCCVersion(a: string, b: string): -1 | 0 | 1 {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)

  for (let i = 0; i < 3; i++) {
    const va = partsA[i] || 0
    const vb = partsB[i] || 0
    if (va < vb) return -1
    if (va > vb) return 1
  }
  return 0
}

/**
 * Check if a version is >= the breaking version where settings format changed.
 */
export function isPostBreakingVersion(version: string): boolean {
  return compareCCVersion(version, CC_BREAKING_VERSION) >= 0
}

// =============================================================================
// Version-Aware Permission Settings
// =============================================================================

/**
 * Settings to write to ~/.claude.json for permission bypass.
 */
export interface CCUserSettings {
  bypassPermissionsModeAccepted: boolean
  /** Added in 2.1.86+ — records explicit acceptance of dangerous mode */
  dangerouslySkipPermissionsAccepted?: boolean
}

/**
 * Settings to write to ~/.claude/settings.json for permission bypass.
 */
export interface CCAppSettings {
  skipDangerousModePermissionPrompt: boolean
  /** Added in 2.1.86+ — explicit bypass of the permissions confirmation */
  dangerouslySkipPermissions?: boolean
}

/**
 * Get the permission-related user settings (.claude.json) for a given CC version.
 * Writes both old and new format keys for forward compatibility.
 */
export function getCCUserPermissionSettings(version?: string): CCUserSettings {
  const settings: CCUserSettings = {
    bypassPermissionsModeAccepted: true,
  }

  // For 2.1.86+ or unknown versions, also write the new format
  if (!version || isPostBreakingVersion(version)) {
    settings.dangerouslySkipPermissionsAccepted = true
  }

  return settings
}

/**
 * Get the permission-related app settings (settings.json) for a given CC version.
 * Writes both old and new format keys for forward compatibility.
 */
export function getCCAppPermissionSettings(version?: string): CCAppSettings {
  const settings: CCAppSettings = {
    skipDangerousModePermissionPrompt: true,
  }

  // For 2.1.86+ or unknown versions, also write the new format
  if (!version || isPostBreakingVersion(version)) {
    settings.dangerouslySkipPermissions = true
  }

  return settings
}
