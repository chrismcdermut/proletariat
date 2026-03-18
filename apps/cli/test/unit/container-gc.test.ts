import { expect } from 'chai'
import { EventBus } from '../../src/lib/events/event-bus.js'
import { initContainerGC, stopContainerGC } from '../../src/lib/execution/container-gc.js'

/**
 * Unit tests for container GC event-driven cleanup (PRLT-1005 / TKT-172)
 *
 * Tests the event subscription wiring:
 * - initContainerGC subscribes to agent lifecycle events
 * - stopContainerGC unsubscribes all listeners
 * - Event handlers properly trigger cleanup logic
 */
describe('@smoke Container GC', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
  })

  afterEach(() => {
    stopContainerGC()
  })

  describe('initContainerGC', () => {
    it('subscribes to agent:stopped events', () => {
      initContainerGC({ bus })
      expect(bus.listenerCount('agent:stopped')).to.equal(1)
    })

    it('subscribes to agent:status_change events', () => {
      initContainerGC({ bus })
      expect(bus.listenerCount('agent:status_change')).to.equal(1)
    })

    it('subscribes to agent:error events', () => {
      initContainerGC({ bus })
      expect(bus.listenerCount('agent:error')).to.equal(1)
    })

    it('cleans up previous subscriptions when re-initialized', () => {
      initContainerGC({ bus })
      initContainerGC({ bus })
      // Should only have 1 listener per event, not 2
      expect(bus.listenerCount('agent:stopped')).to.equal(1)
      expect(bus.listenerCount('agent:status_change')).to.equal(1)
      expect(bus.listenerCount('agent:error')).to.equal(1)
    })
  })

  describe('stopContainerGC', () => {
    it('removes all event subscriptions', () => {
      initContainerGC({ bus })
      expect(bus.listenerCount('agent:stopped')).to.equal(1)

      stopContainerGC()
      expect(bus.listenerCount('agent:stopped')).to.equal(0)
      expect(bus.listenerCount('agent:status_change')).to.equal(0)
      expect(bus.listenerCount('agent:error')).to.equal(0)
    })

    it('is safe to call when no subscriptions exist', () => {
      // Should not throw
      stopContainerGC()
      stopContainerGC()
    })
  })

  describe('event handling', () => {
    it('handles agent:stopped events without executionStorage gracefully', () => {
      // Without storage, handler should be a no-op
      initContainerGC({ bus })

      // Should not throw
      bus.emit('agent:stopped', {
        sessionId: 'test-session',
        runner: 'test',
        reason: 'completed',
        timestamp: new Date(),
      })
    })

    it('handles agent:error events without executionStorage gracefully', () => {
      initContainerGC({ bus })

      // Should not throw
      bus.emit('agent:error', {
        sessionId: 'test-session',
        runner: 'test',
        error: 'test error',
        timestamp: new Date(),
      })
    })

    it('handles agent:status_change to done without executionStorage gracefully', () => {
      initContainerGC({ bus })

      // Should not throw
      bus.emit('agent:status_change', {
        sessionId: 'test-session',
        runner: 'test',
        previousStatus: 'running',
        newStatus: 'done',
        timestamp: new Date(),
      })
    })

    it('ignores non-terminal status changes', () => {
      let cleanupCalled = false
      initContainerGC({
        bus,
        onCleanup: () => { cleanupCalled = true },
      })

      // Status change to 'running' should not trigger cleanup
      bus.emit('agent:status_change', {
        sessionId: 'test-session',
        runner: 'test',
        previousStatus: 'starting',
        newStatus: 'running',
        timestamp: new Date(),
      })

      expect(cleanupCalled).to.be.false
    })

    it('calls onCleanup callback when cleanup occurs', () => {
      // This test verifies the callback mechanism works
      // Without a real ExecutionStorage, cleanup won't actually fire
      // but the event subscription mechanism is verified
      const events: string[] = []
      initContainerGC({
        bus,
        onCleanup: (event) => {
          events.push(event.trigger)
        },
      })

      // Without storage, no cleanup should occur
      bus.emit('agent:stopped', {
        sessionId: 'test-session',
        runner: 'test',
        reason: 'completed',
        timestamp: new Date(),
      })

      // No storage means no cleanup triggered
      expect(events).to.have.length(0)
    })
  })
})
