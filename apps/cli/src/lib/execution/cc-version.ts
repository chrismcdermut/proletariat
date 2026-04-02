/**
 * Claude Code Version Management (PRLT-1240)
 *
 * Utilities for detecting Claude Code versions in containers and generating
 * version-appropriate permission settings. Also provides a launcher wrapper
 * script that ensures onboarding settings persist through Claude Code's
 * startup config write.
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

/**
 * Command name for the Claude launcher wrapper script.
 * Installed at /usr/local/bin/ so it's in PATH inside containers.
 */
export const CLAUDE_LAUNCHER_CMD = 'claude-launcher.sh'

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

// =============================================================================
// Claude Launcher Wrapper (PRLT-1240)
// =============================================================================

/**
 * Build the claude-launcher.sh wrapper script content.
 *
 * Claude Code >=2.1.86 overwrites ~/.claude.json on startup with its own
 * runtime cache (OAuth state, feature flags), clobbering hasCompletedOnboarding=true
 * that prlt writes during container setup. Without that flag, Claude starts the
 * first-run onboarding flow (theme picker → permissions → workspace trust) and
 * agents get stuck.
 *
 * This wrapper:
 * 1. Merges onboarding settings into ~/.claude.json before launch
 * 2. Starts a background guardian that re-applies settings if Claude clobbers them
 * 3. Execs into claude with all original arguments
 *
 * The guardian checks every 500ms for 15 seconds. Once settings survive 3
 * consecutive checks (1.5s stable), it exits. This covers the startup window
 * where Claude may overwrite the config.
 */
export function buildClaudeLauncherScript(): string {
  // The node one-liner that merges onboarding settings into ~/.claude.json.
  // Uses Node.js (always available in containers) instead of jq for reliability.
  const applySettingsScript = `
      const fs = require("fs");
      const f = require("os").homedir() + "/.claude.json";
      let s = {};
      try { s = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
      if (s.hasCompletedOnboarding === true) process.exit(0);
      s.hasCompletedOnboarding = true;
      s.numStartups = Math.max(s.numStartups || 0, 1);
      s.theme = s.theme || "dark";
      s.effortCalloutDismissed = true;
      s.tipsHistory = Object.assign(s.tipsHistory || {}, {"new-user-warmup": 1});
      s.projects = s.projects || {};
      ["/workspace", "/hq", "/"].forEach(function(p) {
        s.projects[p] = Object.assign(s.projects[p] || {}, {
          hasTrustDialogAccepted: true,
          hasCompletedProjectOnboarding: true
        });
      });
      fs.writeFileSync(f, JSON.stringify(s));
      process.exit(1);
  `.trim()

  return `#!/bin/bash
# claude-launcher.sh — PRLT-1240: Ensure onboarding settings survive Claude startup
# Claude Code >=2.1.86 overwrites ~/.claude.json on startup with runtime cache,
# clobbering hasCompletedOnboarding=true. This wrapper applies settings before
# launch and runs a background guardian that re-applies if clobbered.

# Pre-launch: ensure onboarding settings exist in .claude.json
node -e '${applySettingsScript}' 2>/dev/null || true

# Background guardian: re-apply settings if Claude clobbers them during startup.
# Checks every 500ms for up to 15s. Exits early once settings are stable (3 consecutive OKs).
(
  settled=0
  for i in $(seq 1 30); do
    sleep 0.5
    node -e '${applySettingsScript}' 2>/dev/null
    if [ $? -eq 0 ]; then
      settled=$((settled + 1))
      [ $settled -ge 6 ] && break
    else
      settled=0
    fi
  done
) &

# Launch Claude Code with all original arguments
exec claude "$@"
`
}

/**
 * Install the claude-launcher.sh wrapper script into a running container.
 * Writes to /usr/local/bin/ (requires --user root for docker exec).
 */
export function installClaudeLauncherInContainer(containerId: string): void {
  const script = buildClaudeLauncherScript()
  execSync(
    `docker exec --user root -i ${containerId} bash -c 'cat > /usr/local/bin/${CLAUDE_LAUNCHER_CMD} && chmod +x /usr/local/bin/${CLAUDE_LAUNCHER_CMD}'`,
    { input: script, stdio: ['pipe', 'pipe', 'pipe'] }
  )
}
