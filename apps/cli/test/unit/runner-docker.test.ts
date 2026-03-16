import { expect } from 'chai'
import {
  getAgentContainerName,
  getContainerName,
  getImageName,
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
