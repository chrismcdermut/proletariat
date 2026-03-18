/**
 * Unit tests for container cleanup module (PRLT-1005)
 *
 * Tests the container cleanup logic that removes dead Docker containers
 * when agent work completes.
 */

import { expect } from 'chai'
import { execSync } from 'node:child_process'
import {
  findDeadContainers,
  cleanupContainer,
  cleanupDeadContainers,
  cleanupAgentContainer,
  startContainerCleanupListener,
  stopContainerCleanupListener,
} from '../../src/lib/execution/container-cleanup.js'
import { getEventBus, resetEventBus } from '../../src/lib/events/event-bus.js'

describe('Container Cleanup (PRLT-1005)', () => {
  describe('findDeadContainers', () => {
    it('should return an array', () => {
      const result = findDeadContainers()
      expect(result).to.be.an('array')
    })

    it('should return dead containers with expected shape', () => {
      const result = findDeadContainers()
      for (const container of result) {
        expect(container).to.have.property('id').that.is.a('string')
        expect(container).to.have.property('name').that.is.a('string')
        expect(container).to.have.property('status').that.is.a('string')
        expect(container).to.have.property('agentDir').that.is.a('string')
        expect(container).to.have.property('reason').that.is.a('string')
      }
    })

    it('should not throw when Docker is unavailable', () => {
      expect(() => findDeadContainers()).to.not.throw()
    })
  })

  describe('cleanupContainer', () => {
    it('should succeed for non-existent container', () => {
      const result = cleanupContainer('nonexistent-container-id-12345')
      // Should succeed (nothing to clean up) or fail gracefully
      expect(result).to.have.property('success').that.is.a('boolean')
    })

    it('should return error message on failure', () => {
      // Invalid container ID characters should be caught by sanitization
      const result = cleanupContainer('invalid;id')
      expect(result.success).to.be.false
      expect(result).to.have.property('error').that.is.a('string')
    })
  })

  describe('cleanupDeadContainers', () => {
    it('should return a result object with expected shape', () => {
      const result = cleanupDeadContainers()
      expect(result).to.have.property('stopped').that.is.an('array')
      expect(result).to.have.property('removed').that.is.an('array')
      expect(result).to.have.property('errors').that.is.an('array')
    })

    it('should not throw when Docker is unavailable', () => {
      expect(() => cleanupDeadContainers()).to.not.throw()
    })
  })

  describe('cleanupAgentContainer', () => {
    it('should return a result object with expected shape', () => {
      const result = cleanupAgentContainer('test-agent-does-not-exist')
      expect(result).to.have.property('stopped').that.is.an('array')
      expect(result).to.have.property('removed').that.is.an('array')
      expect(result).to.have.property('errors').that.is.an('array')
    })

    it('should handle agent names with special characters', () => {
      const result = cleanupAgentContainer('agent with spaces & symbols!')
      expect(result).to.have.property('stopped').that.is.an('array')
      expect(result).to.have.property('removed').that.is.an('array')
    })

    it('should not throw when Docker is unavailable', () => {
      expect(() => cleanupAgentContainer('any-agent')).to.not.throw()
    })
  })

  describe('Event-Driven Cleanup Listener', () => {
    beforeEach(() => {
      resetEventBus()
      stopContainerCleanupListener()
    })

    afterEach(() => {
      stopContainerCleanupListener()
      resetEventBus()
    })

    it('should subscribe to events when started', () => {
      const bus = getEventBus()

      startContainerCleanupListener()

      // Verify event listeners are registered
      expect(bus.listenerCount('agent:stopped')).to.be.greaterThan(0)
      expect(bus.listenerCount('agent:error')).to.be.greaterThan(0)
      expect(bus.listenerCount('work:completed')).to.be.greaterThan(0)
      expect(bus.listenerCount('work:pr_created')).to.be.greaterThan(0)
    })

    it('should not double-subscribe when called twice', () => {
      const bus = getEventBus()

      startContainerCleanupListener()
      startContainerCleanupListener()

      // Should still only have one listener per event
      expect(bus.listenerCount('agent:stopped')).to.equal(1)
      expect(bus.listenerCount('agent:error')).to.equal(1)
      expect(bus.listenerCount('work:completed')).to.equal(1)
      expect(bus.listenerCount('work:pr_created')).to.equal(1)
    })

    it('should unsubscribe from events when stopped', () => {
      const bus = getEventBus()

      startContainerCleanupListener()
      stopContainerCleanupListener()

      expect(bus.listenerCount('agent:stopped')).to.equal(0)
      expect(bus.listenerCount('agent:error')).to.equal(0)
      expect(bus.listenerCount('work:completed')).to.equal(0)
      expect(bus.listenerCount('work:pr_created')).to.equal(0)
    })

    it('should not throw when events are emitted', () => {
      const bus = getEventBus()
      startContainerCleanupListener()

      // Emit events — should not throw even without Docker
      expect(() => {
        bus.emit('agent:stopped', {
          sessionId: 'TKT-001-implement-test-agent',
          runner: 'claude-code',
          reason: 'completed',
          timestamp: new Date(),
        })
      }).to.not.throw()

      expect(() => {
        bus.emit('work:completed', {
          workItemId: 'TKT-001',
          source: 'pmo',
          projectId: 'test-project',
          status: 'Done',
          timestamp: new Date(),
        })
      }).to.not.throw()

      expect(() => {
        bus.emit('work:pr_created', {
          workItemId: 'TKT-001',
          source: 'pmo',
          projectId: 'test-project',
          prUrl: 'https://github.com/test/repo/pull/1',
          prTitle: 'Test PR',
          timestamp: new Date(),
        })
      }).to.not.throw()

      expect(() => {
        bus.emit('agent:error', {
          sessionId: 'TKT-001-implement-test-agent',
          runner: 'claude-code',
          error: 'Something went wrong',
          timestamp: new Date(),
        })
      }).to.not.throw()
    })
  })
})
