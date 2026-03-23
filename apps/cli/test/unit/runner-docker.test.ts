import { expect } from 'chai'
import {
  getAgentContainerName,
  getContainerName,
  getImageName,
  buildClaudeStopHookConfig,
} from '../../src/lib/execution/runners/docker-management.js'

/**
 * Smoke tests for Docker runner — container naming, image naming.
 * TKT-140: Close coverage gaps in execution runner modules.
 */

describe('Docker Runner Utilities (TKT-140)', () => {
  // =========================================================================
  // Container Naming
  // =========================================================================
  describe('getAgentContainerName', () => {
    it('should prefix with prlt-agent-', () => {
      expect(getAgentContainerName('myagent')).to.equal('prlt-agent-myagent')
    })

    it('should sanitize special characters to hyphens', () => {
      expect(getAgentContainerName('my@agent!name')).to.equal('prlt-agent-my-agent-name')
    })

    it('should preserve alphanumerics, underscores, and hyphens', () => {
      expect(getAgentContainerName('my_agent-1')).to.equal('prlt-agent-my_agent-1')
    })

    it('should handle empty agent name', () => {
      expect(getAgentContainerName('')).to.equal('prlt-agent-')
    })
  })

  describe('getContainerName', () => {
    it('should be the same function as getAgentContainerName', () => {
      expect(getContainerName('test')).to.equal(getAgentContainerName('test'))
    })
  })

  // =========================================================================
  // Claude Code Stop Hook Config (PRLT-1082)
  // =========================================================================
  describe('buildClaudeStopHookConfig', () => {
    it('should use new matcher+hooks array format', () => {
      const config = buildClaudeStopHookConfig() as {
        hooks: { Stop: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> }
      }
      expect(config.hooks).to.exist
      expect(config.hooks.Stop).to.be.an('array').with.lengthOf(1)
      const entry = config.hooks.Stop[0]
      // Must have matcher field (new format) — without this, Claude Code skips settings.json
      expect(entry).to.have.property('matcher')
      // Must have hooks array wrapper (new format) — not flat type/command at top level
      expect(entry).to.have.property('hooks').that.is.an('array').with.lengthOf(1)
      expect(entry.hooks[0]).to.have.property('type', 'command')
      expect(entry.hooks[0]).to.have.property('command').that.includes('prlt session report')
      // Regression: old format had type/command at same level as Stop array entries
      expect(entry).to.not.have.property('type')
      expect(entry).to.not.have.property('command')
    })
  })

  // =========================================================================
  // Image Naming
  // =========================================================================
  describe('getImageName', () => {
    it('should include :latest tag', () => {
      expect(getImageName('myagent')).to.equal('prlt-agent-myagent:latest')
    })

    it('should sanitize special characters', () => {
      expect(getImageName('my@agent')).to.equal('prlt-agent-my-agent:latest')
    })

    it('should prefix with prlt-agent-', () => {
      expect(getImageName('test')).to.match(/^prlt-agent-/)
    })
  })
})
