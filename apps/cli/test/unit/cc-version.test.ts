import { expect } from 'chai'

import {
  CC_BREAKING_VERSION,
  parseCCVersionOutput,
  compareCCVersion,
  isPostBreakingVersion,
  getCCUserPermissionSettings,
  getCCAppPermissionSettings,
} from '../../src/lib/execution/cc-version.js'

/**
 * Unit tests for Claude Code version management (PRLT-1240)
 *
 * Verifies version detection, comparison, and version-aware permission settings
 * for ~/.claude/settings.json. CC_DEFAULT_VERSION was removed — container agents
 * now use -p (print) mode which skips all onboarding prompts.
 */
describe('Claude Code Version Management (PRLT-1240)', () => {
  // ===========================================================================
  // Constants
  // ===========================================================================

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
})
