import { expect } from 'chai'
import { execSync } from 'node:child_process'
import {
  type ContainerCleanupResult,
  cleanupExecutionContainer,
  listDeadContainers,
  listAllProletariatContainers,
} from '../../src/lib/docker/container-cleanup.js'
import { sanitizeContainerId } from '../../src/lib/docker/resolve.js'

/**
 * Unit tests for Docker container cleanup module.
 * TKT-172 / PRLT-1005: Auto-cleanup Docker containers when agent completes.
 *
 * These tests validate the container cleanup logic without requiring Docker.
 * Docker-dependent tests (actual container stop/remove) are in e2e tests.
 */

describe('Container Cleanup (TKT-172)', () => {
  // ===========================================================================
  // sanitizeContainerId (shared validation logic)
  // ===========================================================================
  describe('sanitizeContainerId (shell injection prevention)', () => {
    it('should accept valid hex container IDs', () => {
      expect(sanitizeContainerId('abc123def456')).to.equal('abc123def456')
    })

    it('should accept full-length SHA256 IDs', () => {
      const fullId = 'a'.repeat(64)
      expect(sanitizeContainerId(fullId)).to.equal(fullId)
    })

    it('should accept container names with hyphens and underscores', () => {
      expect(sanitizeContainerId('prlt-agent-alice_1')).to.equal('prlt-agent-alice_1')
    })

    it('should accept container names with periods', () => {
      expect(sanitizeContainerId('prlt.agent.alice')).to.equal('prlt.agent.alice')
    })

    it('should reject IDs with semicolons (command injection)', () => {
      expect(() => sanitizeContainerId('abc; rm -rf /')).to.throw('Invalid container ID')
    })

    it('should reject IDs with pipe characters', () => {
      expect(() => sanitizeContainerId('abc | cat /etc/passwd')).to.throw('Invalid container ID')
    })

    it('should reject IDs with backticks', () => {
      expect(() => sanitizeContainerId('abc`whoami`')).to.throw('Invalid container ID')
    })

    it('should reject IDs with dollar signs', () => {
      expect(() => sanitizeContainerId('abc$(whoami)')).to.throw('Invalid container ID')
    })

    it('should reject IDs that are too long', () => {
      const longId = 'a'.repeat(200)
      expect(() => sanitizeContainerId(longId)).to.throw('Invalid container ID')
    })

    it('should reject empty IDs', () => {
      expect(() => sanitizeContainerId('')).to.throw('Invalid container ID')
    })
  })

  // ===========================================================================
  // ContainerCleanupResult type validation
  // ===========================================================================
  describe('ContainerCleanupResult structure', () => {
    it('should have the expected shape for empty result', () => {
      const result: ContainerCleanupResult = {
        removed: [],
        errors: [],
        alreadyStopped: [],
      }
      expect(result.removed).to.be.an('array').that.is.empty
      expect(result.errors).to.be.an('array').that.is.empty
      expect(result.alreadyStopped).to.be.an('array').that.is.empty
    })

    it('should support error entries with container ID and message', () => {
      const result: ContainerCleanupResult = {
        removed: [],
        errors: [
          { containerId: 'abc123', error: 'permission denied' },
        ],
        alreadyStopped: [],
      }
      expect(result.errors[0].containerId).to.equal('abc123')
      expect(result.errors[0].error).to.equal('permission denied')
    })

    it('should track already-stopped containers separately', () => {
      const result: ContainerCleanupResult = {
        removed: ['abc123'],
        errors: [],
        alreadyStopped: ['abc123'],
      }
      // A container can be both already-stopped and successfully removed
      expect(result.removed).to.include('abc123')
      expect(result.alreadyStopped).to.include('abc123')
    })
  })

  // ===========================================================================
  // Integration with Docker (requires Docker, gracefully skipped)
  // ===========================================================================
  describe('Docker integration (requires Docker)', () => {
    let dockerAvailable = false

    before(() => {
      try {
        execSync('docker ps -q', { stdio: 'pipe', timeout: 5000 })
        dockerAvailable = true
      } catch {
        dockerAvailable = false
      }
    })

    it('should list dead containers (or return empty if Docker unavailable)', () => {
      if (!dockerAvailable) return

      const result = listDeadContainers()
      expect(result).to.be.an('array')
    })

    it('should list all proletariat containers (or return empty if Docker unavailable)', () => {
      if (!dockerAvailable) return

      const result = listAllProletariatContainers()
      expect(result).to.be.an('array')
    })

    it('should handle cleanupExecutionContainer with non-existent container', () => {
      if (!dockerAvailable) return

      const result = cleanupExecutionContainer('nonexistent123abc')
      // Should not crash — error is recorded in result
      expect(result).to.have.property('removed')
      expect(result).to.have.property('errors')
    })

    it('should handle cleanupExecutionContainer with empty string', () => {
      const result = cleanupExecutionContainer('')
      expect(result.removed).to.have.length(0)
      expect(result.errors).to.have.length(0)
    })
  })
})
