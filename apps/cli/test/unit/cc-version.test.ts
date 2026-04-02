import { expect } from 'chai'

import {
  CC_BREAKING_VERSION,
  CLAUDE_LAUNCHER_CMD,
  parseCCVersionOutput,
  compareCCVersion,
  isPostBreakingVersion,
  getCCUserPermissionSettings,
  getCCAppPermissionSettings,
  buildClaudeLauncherScript,
} from '../../src/lib/execution/cc-version.js'

/**
 * Unit tests for Claude Code version management (PRLT-1240)
 *
 * Verifies version detection, comparison, version-aware permission settings,
 * and the claude-launcher.sh wrapper that ensures onboarding settings persist
 * through Claude Code's startup config write.
 */
describe('Claude Code Version Management (PRLT-1240)', () => {
  // ===========================================================================
  // Constants
  // ===========================================================================

  describe('CLAUDE_LAUNCHER_CMD', () => {
    it('should be claude-launcher.sh', () => {
      expect(CLAUDE_LAUNCHER_CMD).to.equal('claude-launcher.sh')
    })
  })

  describe('CC_BREAKING_VERSION', () => {
    it('should be a valid semver string', () => {
      expect(CC_BREAKING_VERSION).to.match(/^\d+\.\d+\.\d+$/)
    })

    it('should be 2.1.86', () => {
      expect(CC_BREAKING_VERSION).to.equal('2.1.86')
    })
  })

  // ===========================================================================
  // Version Parsing
  // ===========================================================================

  describe('parseCCVersionOutput', () => {
    it('should parse plain version string', () => {
      expect(parseCCVersionOutput('2.1.81')).to.equal('2.1.81')
    })

    it('should parse "claude X.Y.Z" format', () => {
      expect(parseCCVersionOutput('claude 2.1.86')).to.equal('2.1.86')
    })

    it('should parse version with pre-release suffix', () => {
      expect(parseCCVersionOutput('2.1.86-beta.1')).to.equal('2.1.86-beta.1')
    })

    it('should parse version from multi-line output', () => {
      expect(parseCCVersionOutput('Claude Code v2.1.90\nSome other info')).to.equal('2.1.90')
    })

    it('should return undefined for empty string', () => {
      expect(parseCCVersionOutput('')).to.be.undefined
    })

    it('should return undefined for non-version string', () => {
      expect(parseCCVersionOutput('no version here')).to.be.undefined
    })

    it('should return undefined for undefined-like input', () => {
      expect(parseCCVersionOutput('')).to.be.undefined
    })
  })

  // ===========================================================================
  // Version Comparison
  // ===========================================================================

  describe('compareCCVersion', () => {
    it('should return 0 for equal versions', () => {
      expect(compareCCVersion('2.1.81', '2.1.81')).to.equal(0)
    })

    it('should return -1 when a < b (patch)', () => {
      expect(compareCCVersion('2.1.81', '2.1.86')).to.equal(-1)
    })

    it('should return 1 when a > b (patch)', () => {
      expect(compareCCVersion('2.1.86', '2.1.81')).to.equal(1)
    })

    it('should return -1 when a < b (minor)', () => {
      expect(compareCCVersion('2.1.86', '2.2.0')).to.equal(-1)
    })

    it('should return 1 when a > b (minor)', () => {
      expect(compareCCVersion('2.2.0', '2.1.86')).to.equal(1)
    })

    it('should return -1 when a < b (major)', () => {
      expect(compareCCVersion('2.1.86', '3.0.0')).to.equal(-1)
    })

    it('should return 1 when a > b (major)', () => {
      expect(compareCCVersion('3.0.0', '2.1.86')).to.equal(1)
    })

    it('should handle versions with different segment counts', () => {
      // parseCCVersionOutput always returns X.Y.Z, but compareCCVersion handles missing parts
      expect(compareCCVersion('2.1', '2.1.0')).to.equal(0)
    })
  })

  // ===========================================================================
  // isPostBreakingVersion
  // ===========================================================================

  describe('isPostBreakingVersion', () => {
    it('should return false for pre-breaking versions', () => {
      expect(isPostBreakingVersion('2.1.81')).to.be.false
      expect(isPostBreakingVersion('2.1.85')).to.be.false
    })

    it('should return true for the breaking version itself', () => {
      expect(isPostBreakingVersion('2.1.86')).to.be.true
    })

    it('should return true for post-breaking versions', () => {
      expect(isPostBreakingVersion('2.1.87')).to.be.true
      expect(isPostBreakingVersion('2.2.0')).to.be.true
      expect(isPostBreakingVersion('3.0.0')).to.be.true
    })
  })

  // ===========================================================================
  // Version-Aware Permission Settings
  // ===========================================================================

  describe('getCCUserPermissionSettings', () => {
    it('should always include bypassPermissionsModeAccepted', () => {
      const settings = getCCUserPermissionSettings('2.1.81')
      expect(settings.bypassPermissionsModeAccepted).to.be.true
    })

    it('should NOT include new format for pre-breaking versions', () => {
      const settings = getCCUserPermissionSettings('2.1.81')
      expect(settings.dangerouslySkipPermissionsAccepted).to.be.undefined
    })

    it('should include new format for post-breaking versions', () => {
      const settings = getCCUserPermissionSettings('2.1.86')
      expect(settings.bypassPermissionsModeAccepted).to.be.true
      expect(settings.dangerouslySkipPermissionsAccepted).to.be.true
    })

    it('should include new format for future versions', () => {
      const settings = getCCUserPermissionSettings('3.0.0')
      expect(settings.dangerouslySkipPermissionsAccepted).to.be.true
    })

    it('should include new format when version is undefined (forward compat)', () => {
      const settings = getCCUserPermissionSettings(undefined)
      expect(settings.bypassPermissionsModeAccepted).to.be.true
      expect(settings.dangerouslySkipPermissionsAccepted).to.be.true
    })
  })

  describe('getCCAppPermissionSettings', () => {
    it('should always include skipDangerousModePermissionPrompt', () => {
      const settings = getCCAppPermissionSettings('2.1.81')
      expect(settings.skipDangerousModePermissionPrompt).to.be.true
    })

    it('should NOT include new format for pre-breaking versions', () => {
      const settings = getCCAppPermissionSettings('2.1.81')
      expect(settings.dangerouslySkipPermissions).to.be.undefined
    })

    it('should include new format for post-breaking versions', () => {
      const settings = getCCAppPermissionSettings('2.1.86')
      expect(settings.skipDangerousModePermissionPrompt).to.be.true
      expect(settings.dangerouslySkipPermissions).to.be.true
    })

    it('should include new format for future versions', () => {
      const settings = getCCAppPermissionSettings('3.0.0')
      expect(settings.dangerouslySkipPermissions).to.be.true
    })

    it('should include new format when version is undefined (forward compat)', () => {
      const settings = getCCAppPermissionSettings(undefined)
      expect(settings.skipDangerousModePermissionPrompt).to.be.true
      expect(settings.dangerouslySkipPermissions).to.be.true
    })
  })

  // ===========================================================================
  // Regression: settings written to container must include bypass keys
  // ===========================================================================

  describe('Regression: permission settings completeness', () => {
    it('pre-breaking version user settings should be spreadable into .claude.json', () => {
      const settings = getCCUserPermissionSettings('2.1.81')
      const claudeJson: Record<string, unknown> = { numStartups: 1 }
      Object.assign(claudeJson, settings)
      expect(claudeJson.bypassPermissionsModeAccepted).to.be.true
      expect(claudeJson.numStartups).to.equal(1)
    })

    it('post-breaking version user settings should be spreadable into .claude.json', () => {
      const settings = getCCUserPermissionSettings('2.1.86')
      const claudeJson: Record<string, unknown> = { numStartups: 1 }
      Object.assign(claudeJson, settings)
      expect(claudeJson.bypassPermissionsModeAccepted).to.be.true
      expect(claudeJson.dangerouslySkipPermissionsAccepted).to.be.true
      expect(claudeJson.numStartups).to.equal(1)
    })

    it('pre-breaking version app settings should be JSON-serializable', () => {
      const settings = getCCAppPermissionSettings('2.1.81')
      const json = JSON.stringify(settings)
      const parsed = JSON.parse(json)
      expect(parsed.skipDangerousModePermissionPrompt).to.be.true
      expect(parsed).to.not.have.property('dangerouslySkipPermissions')
    })

    it('post-breaking version app settings should be JSON-serializable', () => {
      const settings = getCCAppPermissionSettings('2.1.86')
      const json = JSON.stringify(settings)
      const parsed = JSON.parse(json)
      expect(parsed.skipDangerousModePermissionPrompt).to.be.true
      expect(parsed.dangerouslySkipPermissions).to.be.true
    })
  })

  // ===========================================================================
  // Claude Launcher Wrapper (PRLT-1240)
  // ===========================================================================

  describe('buildClaudeLauncherScript', () => {
    let script: string

    before(() => {
      script = buildClaudeLauncherScript()
    })

    it('should return a non-empty bash script', () => {
      expect(script).to.be.a('string')
      expect(script.length).to.be.greaterThan(0)
      expect(script).to.match(/^#!/)
    })

    it('should start with a bash shebang', () => {
      expect(script.startsWith('#!/bin/bash')).to.be.true
    })

    it('should exec into claude with all arguments', () => {
      expect(script).to.include('exec claude "$@"')
    })

    it('should set hasCompletedOnboarding to true', () => {
      expect(script).to.include('hasCompletedOnboarding')
    })

    it('should set theme to dark as default', () => {
      expect(script).to.include('s.theme = s.theme || "dark"')
    })

    it('should set hasTrustDialogAccepted for project paths', () => {
      expect(script).to.include('hasTrustDialogAccepted')
      expect(script).to.include('/workspace')
      expect(script).to.include('/hq')
    })

    it('should include a background guardian loop', () => {
      // Guardian runs in background subshell
      expect(script).to.include(') &')
      // Guardian checks periodically
      expect(script).to.include('sleep 0.5')
    })

    it('should include pre-launch settings application', () => {
      // The script applies settings BEFORE the background guardian starts
      const prelaunchIndex = script.indexOf('Pre-launch')
      const guardianIndex = script.indexOf('Background guardian')
      const execIndex = script.indexOf('exec claude')
      expect(prelaunchIndex).to.be.lessThan(guardianIndex)
      expect(guardianIndex).to.be.lessThan(execIndex)
    })

    it('should set effortCalloutDismissed', () => {
      expect(script).to.include('effortCalloutDismissed')
    })

    it('should set tipsHistory for new-user-warmup', () => {
      expect(script).to.include('new-user-warmup')
    })

    it('should use node for settings manipulation (not jq)', () => {
      // Node.js is always available in containers; jq may not be
      expect(script).to.include('node -e')
      expect(script).to.not.include('jq ')
    })

    // Regression: launcher must exit cleanly if .claude.json already has onboarding
    it('should exit 0 from node script when hasCompletedOnboarding is already true', () => {
      expect(script).to.include('if (s.hasCompletedOnboarding === true) process.exit(0)')
    })

    // Regression: guardian must self-terminate
    it('should have a bounded guardian loop that exits after settling', () => {
      expect(script).to.include('settled')
      expect(script).to.include('break')
    })
  })
})
