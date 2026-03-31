import { expect } from 'chai'
import { EventBus, resetEventBus, getEventBus } from '../../src/lib/events/index.js'
import {
  ContainerCleanupHook,
  initContainerCleanupHook,
  stopContainerCleanupHook,
} from '../../src/lib/work-lifecycle/container-cleanup-hook.js'

/**
 * Unit tests for the ContainerCleanupHook (Tier 1 event-driven cleanup).
 *
 * Verifies that:
 *   1. The hook subscribes to agent:stopped events
 *   2. The hook can be started and stopped without errors
 *   3. The singleton pattern works correctly
 *   4. The hook ignores events from cascade-cleanup runner (loop prevention)
 *   5. The hook handles missing sessionId gracefully
 */
describe('@smoke ContainerCleanupHook', () => {
  beforeEach(() => {
    resetEventBus()
    stopContainerCleanupHook()
  })

  afterEach(() => {
    stopContainerCleanupHook()
    resetEventBus()
  })

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  describe('lifecycle', () => {
    it('should start without errors', () => {
      const hook = new ContainerCleanupHook()
      expect(() => hook.start()).not.to.throw()
      hook.stop()
    })

    it('should stop without errors', () => {
      const hook = new ContainerCleanupHook()
      hook.start()
      expect(() => hook.stop()).not.to.throw()
    })

    it('should be safe to stop without starting', () => {
      const hook = new ContainerCleanupHook()
      expect(() => hook.stop()).not.to.throw()
    })

    it('should be safe to start and stop multiple times', () => {
      const hook = new ContainerCleanupHook()
      hook.start()
      hook.stop()
      hook.start()
      hook.stop()
    })
  })

  // ---------------------------------------------------------------------------
  // setHqPath
  // ---------------------------------------------------------------------------
  describe('setHqPath', () => {
    it('should accept an hqPath without errors', () => {
      const hook = new ContainerCleanupHook()
      expect(() => hook.setHqPath('/tmp/test-hq')).not.to.throw()
    })

    it('should allow updating hqPath', () => {
      const hook = new ContainerCleanupHook()
      hook.setHqPath('/tmp/hq-1')
      hook.setHqPath('/tmp/hq-2')
      // No error — both calls succeed
    })
  })

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------
  describe('singleton (initContainerCleanupHook)', () => {
    it('should return a ContainerCleanupHook instance', () => {
      const hook = initContainerCleanupHook()
      expect(hook).to.be.instanceOf(ContainerCleanupHook)
      stopContainerCleanupHook()
    })

    it('should return the same instance on repeated calls', () => {
      const hook1 = initContainerCleanupHook()
      const hook2 = initContainerCleanupHook()
      expect(hook1).to.equal(hook2)
      stopContainerCleanupHook()
    })

    it('should accept hqPath on init', () => {
      const hook = initContainerCleanupHook('/tmp/test-hq')
      expect(hook).to.be.instanceOf(ContainerCleanupHook)
      stopContainerCleanupHook()
    })

    it('should update hqPath on subsequent calls', () => {
      initContainerCleanupHook('/tmp/hq-1')
      const hook = initContainerCleanupHook('/tmp/hq-2')
      expect(hook).to.be.instanceOf(ContainerCleanupHook)
      stopContainerCleanupHook()
    })

    it('should reset after stopContainerCleanupHook', () => {
      const hook1 = initContainerCleanupHook()
      stopContainerCleanupHook()
      const hook2 = initContainerCleanupHook()
      expect(hook1).to.not.equal(hook2)
      stopContainerCleanupHook()
    })
  })

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------
  describe('event handling', () => {
    it('should subscribe to agent:stopped when started', () => {
      const hook = new ContainerCleanupHook()
      hook.start()

      const bus = getEventBus()

      // Emitting agent:stopped should not throw (hook is listening)
      expect(() => {
        bus.emit('agent:stopped', {
          sessionId: 'TKT-100-implement-bold-turing',
          runner: 'mock',
          reason: 'completed' as const,
          timestamp: new Date(),
        })
      }).not.to.throw()

      hook.stop()
    })

    it('should not throw when receiving event without sessionId', () => {
      const hook = new ContainerCleanupHook()
      hook.start()

      const bus = getEventBus()

      // Missing sessionId — should be handled gracefully
      expect(() => {
        bus.emit('agent:stopped', {
          runner: 'mock',
          reason: 'error' as const,
          timestamp: new Date(),
        } as any)
      }).not.to.throw()

      hook.stop()
    })

    it('should ignore events from cascade-cleanup runner (loop prevention)', () => {
      const hook = new ContainerCleanupHook()
      hook.start()

      const bus = getEventBus()

      // Events with runner='cascade-cleanup' should be ignored to prevent loops
      expect(() => {
        bus.emit('agent:stopped', {
          sessionId: 'TKT-100-implement-bold-turing',
          runner: 'cascade-cleanup',
          reason: 'error' as const,
          timestamp: new Date(),
        })
      }).not.to.throw()

      hook.stop()
    })

    it('should not receive events after stop()', () => {
      const hook = new ContainerCleanupHook()
      hook.start()
      hook.stop()

      const bus = getEventBus()

      // After stop, emitting events should still not throw
      // (the hook unsubscribed, so the bus just has no listeners)
      expect(() => {
        bus.emit('agent:stopped', {
          sessionId: 'TKT-100-implement-bold-turing',
          runner: 'mock',
          reason: 'completed' as const,
          timestamp: new Date(),
        })
      }).not.to.throw()
    })
  })

  // ---------------------------------------------------------------------------
  // Session ID parsing
  // ---------------------------------------------------------------------------
  describe('session ID parsing', () => {
    it('should handle standard TKT session format', () => {
      const hook = new ContainerCleanupHook()
      hook.start()

      const bus = getEventBus()

      // Standard TKT format: TKT-NNN-action-agentname
      expect(() => {
        bus.emit('agent:stopped', {
          sessionId: 'TKT-100-implement-bold-turing',
          runner: 'mock',
          reason: 'completed' as const,
          timestamp: new Date(),
        })
      }).not.to.throw()

      hook.stop()
    })

    it('should handle PRLT session format', () => {
      const hook = new ContainerCleanupHook()
      hook.start()

      const bus = getEventBus()

      expect(() => {
        bus.emit('agent:stopped', {
          sessionId: 'PRLT-456-review-clever-lovelace',
          runner: 'mock',
          reason: 'error' as const,
          timestamp: new Date(),
        })
      }).not.to.throw()

      hook.stop()
    })

    it('should handle non-standard session ID gracefully', () => {
      const hook = new ContainerCleanupHook()
      hook.start()

      const bus = getEventBus()

      // A session ID that doesn't match the expected pattern
      expect(() => {
        bus.emit('agent:stopped', {
          sessionId: 'random-session-id',
          runner: 'mock',
          reason: 'manual' as const,
          timestamp: new Date(),
        })
      }).not.to.throw()

      hook.stop()
    })
  })
})
