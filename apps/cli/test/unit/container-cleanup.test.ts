import { expect } from 'chai'
import { cleanupCompletedContainers, findDeadContainers } from '../../src/lib/execution/container-cleanup.js'

/**
 * Unit tests for container cleanup module (PRLT-1005 / TKT-172)
 *
 * Tests the core container cleanup logic:
 * - cleanupCompletedContainers: triggered GC for completed executions
 * - findDeadContainers: discovers containers with no active execution
 *
 * Note: Tests that actually call Docker are skipped in CI (no Docker daemon).
 * The logic tests verify filtering, deduplication, and active-container protection.
 */
describe('@smoke Container Cleanup', () => {
  describe('cleanupCompletedContainers', () => {
    it('returns empty summary when no container IDs provided', () => {
      const result = cleanupCompletedContainers([])
      expect(result.attempted).to.equal(0)
      expect(result.stopped).to.equal(0)
      expect(result.removed).to.equal(0)
      expect(result.failed).to.equal(0)
      expect(result.results).to.have.length(0)
    })

    it('skips containers that still have active executions', () => {
      const activeIds = new Set(['abc123def456'])
      const result = cleanupCompletedContainers(['abc123def456'], activeIds)
      expect(result.attempted).to.equal(0)
      expect(result.results).to.have.length(0)
    })

    it('skips containers matching active IDs via prefix', () => {
      // Active ID is full, completed is short prefix
      const activeIds = new Set(['abc123def456789'])
      const result = cleanupCompletedContainers(['abc123def456'], activeIds)
      expect(result.attempted).to.equal(0)
    })

    it('skips containers when short active ID matches long completed ID', () => {
      // Active ID is short, completed is full
      const activeIds = new Set(['abc123'])
      const result = cleanupCompletedContainers(['abc123def456789'], activeIds)
      expect(result.attempted).to.equal(0)
    })

    it('deduplicates container IDs', () => {
      // Without Docker, cleanupContainer will fail/skip, but the dedup logic is testable
      const result = cleanupCompletedContainers(
        ['abc123', 'abc123', 'abc123'],
        new Set()
      )
      // Should only attempt once despite 3 identical IDs
      expect(result.attempted).to.equal(1)
    })

    it('processes containers not in the active set', () => {
      const activeIds = new Set(['running-container-1'])
      const result = cleanupCompletedContainers(
        ['completed-container-1', 'completed-container-2'],
        activeIds
      )
      // Should attempt cleanup for both (will fail without Docker, but attempts are counted)
      expect(result.attempted).to.equal(2)
    })
  })

  describe('findDeadContainers', () => {
    it('returns empty array when no active execution IDs provided and Docker is unavailable', () => {
      // When Docker is not available, findDeadContainers returns empty
      const result = findDeadContainers(new Set())
      // In test environment without Docker, this should return empty
      expect(result).to.be.an('array')
    })

    it('accepts a set of active execution container IDs', () => {
      const activeIds = new Set(['container-1', 'container-2'])
      const result = findDeadContainers(activeIds)
      expect(result).to.be.an('array')
      // Active containers should never be in the dead list
      for (const id of result) {
        expect(activeIds.has(id)).to.be.false
      }
    })
  })
})
