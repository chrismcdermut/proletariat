import { expect } from 'chai'
import { EventBus } from '../../src/lib/events/event-bus.js'
import {
  ContainerCleanupListener,
  initContainerCleanupListener,
  stopContainerCleanupListener,
} from '../../src/lib/docker/cleanup-listener.js'

/**
 * Unit tests for the container cleanup event listener.
 * TKT-172 / PRLT-1005: Container lifecycle tied to agent completion events.
 *
 * Tests the event subscription/unsubscription lifecycle and event routing
 * without requiring Docker or a database.
 */

describe('ContainerCleanupListener (TKT-172)', () => {
  let bus: EventBus
  let logMessages: string[]

  beforeEach(() => {
    bus = new EventBus()
    logMessages = []
  })

  afterEach(() => {
    stopContainerCleanupListener()
  })

  // ===========================================================================
  // Listener lifecycle — subscribes to correct events
  // ===========================================================================
  describe('start/stop lifecycle', () => {
    it('should subscribe to all completion events on start', () => {
      const listener = new ContainerCleanupListener({
        eventBus: bus,
        log: (msg) => logMessages.push(msg),
      })

      listener.start()

      expect(bus.listenerCount('agent:stopped')).to.equal(1)
      expect(bus.listenerCount('agent:error')).to.equal(1)
      expect(bus.listenerCount('work:completed')).to.equal(1)
      expect(bus.listenerCount('work:pr_created')).to.equal(1)

      listener.stop()
    })

    it('should unsubscribe from all events on stop', () => {
      const listener = new ContainerCleanupListener({
        eventBus: bus,
        log: (msg) => logMessages.push(msg),
      })

      listener.start()
      listener.stop()

      expect(bus.listenerCount('agent:stopped')).to.equal(0)
      expect(bus.listenerCount('agent:error')).to.equal(0)
      expect(bus.listenerCount('work:completed')).to.equal(0)
      expect(bus.listenerCount('work:pr_created')).to.equal(0)
    })

    it('should not subscribe to unrelated events', () => {
      const listener = new ContainerCleanupListener({
        eventBus: bus,
        log: (msg) => logMessages.push(msg),
      })

      listener.start()

      // These events should NOT have listeners from the cleanup listener
      expect(bus.listenerCount('agent:spawned')).to.equal(0)
      expect(bus.listenerCount('agent:poked')).to.equal(0)
      expect(bus.listenerCount('agent:output')).to.equal(0)

      listener.stop()
    })
  })

  // ===========================================================================
  // Event handling without execution storage (no-op path)
  // ===========================================================================
  describe('without execution storage', () => {
    it('should handle agent:stopped gracefully (no crash)', () => {
      const listener = new ContainerCleanupListener({
        eventBus: bus,
        log: (msg) => logMessages.push(msg),
      })
      listener.start()

      // Should not throw — just silently skip when no storage is available
      bus.emit('agent:stopped', {
        sessionId: 'ses-abc',
        runner: 'claude-code',
        reason: 'completed',
        timestamp: new Date(),
      })

      expect(logMessages).to.have.length(0)

      listener.stop()
    })

    it('should handle agent:error gracefully (no crash)', () => {
      const listener = new ContainerCleanupListener({
        eventBus: bus,
        log: (msg) => logMessages.push(msg),
      })
      listener.start()

      bus.emit('agent:error', {
        sessionId: 'ses-abc',
        runner: 'claude-code',
        error: 'something failed',
        timestamp: new Date(),
      })

      expect(logMessages).to.have.length(0)

      listener.stop()
    })

    it('should handle work:completed gracefully (no crash)', () => {
      const listener = new ContainerCleanupListener({
        eventBus: bus,
        log: (msg) => logMessages.push(msg),
      })
      listener.start()

      bus.emit('work:completed', {
        workItemId: 'TKT-001',
        source: 'pmo',
        status: 'Done',
        timestamp: new Date(),
      })

      expect(logMessages).to.have.length(0)

      listener.stop()
    })

    it('should handle work:pr_created gracefully (no crash)', () => {
      const listener = new ContainerCleanupListener({
        eventBus: bus,
        log: (msg) => logMessages.push(msg),
      })
      listener.start()

      bus.emit('work:pr_created', {
        workItemId: 'TKT-002',
        source: 'github',
        prUrl: 'https://github.com/org/repo/pull/42',
        prTitle: 'feat: add feature',
        timestamp: new Date(),
      })

      expect(logMessages).to.have.length(0)

      listener.stop()
    })
  })

  // ===========================================================================
  // Singleton management
  // ===========================================================================
  describe('singleton', () => {
    it('should initialize and stop cleanly', () => {
      const listener = initContainerCleanupListener({
        eventBus: bus,
        log: (msg) => logMessages.push(msg),
      })

      expect(listener).to.be.instanceOf(ContainerCleanupListener)
      expect(bus.listenerCount('agent:stopped')).to.equal(1)

      stopContainerCleanupListener()
      expect(bus.listenerCount('agent:stopped')).to.equal(0)
    })

    it('should be idempotent on multiple init calls', () => {
      const listener1 = initContainerCleanupListener({
        eventBus: bus,
        log: (msg) => logMessages.push(msg),
      })

      // Second call should return the same listener
      const listener2 = initContainerCleanupListener({
        eventBus: bus,
        log: (msg) => logMessages.push(msg),
      })

      expect(listener1).to.equal(listener2)
      // Should still have only 1 listener per event
      expect(bus.listenerCount('agent:stopped')).to.equal(1)

      stopContainerCleanupListener()
    })
  })
})
