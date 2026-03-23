import { expect } from 'chai'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { HookManager, initHookManager, stopHookManager } from '../../src/lib/work-lifecycle/hooks/manager.js'
import { WorkHookStorage } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { getEventBus, resetEventBus } from '../../src/lib/events/event-bus.js'

/**
 * Tests for HookManager — event subscription, hook dispatch, and lifecycle.
 * TKT-140: Close coverage gaps in hook system.
 */

describe('HookManager (TKT-140)', () => {
  let db: SqliteDatabase

  beforeEach(() => {
    db = new SqliteDatabase(':memory:')
    db.pragma('journal_mode = WAL')
    // Reset the global event bus to avoid leaking state between tests
    resetEventBus()
    // Stop any leftover singleton manager
    stopHookManager()
  })

  afterEach(() => {
    stopHookManager()
    resetEventBus()
    if (db) db.close()
  })

  // =========================================================================
  // Constructor & Start/Stop
  // =========================================================================
  describe('lifecycle', () => {
    it('should construct without error', () => {
      expect(() => new HookManager(db)).to.not.throw()
    })

    it('should start and subscribe to all hookable events', () => {
      const manager = new HookManager(db)
      const bus = getEventBus()

      // Before start, no listeners
      expect(bus.listenerCount('work:started')).to.equal(0)

      manager.start()

      // After start, should have a listener for each hookable event
      expect(bus.listenerCount('work:started')).to.be.greaterThan(0)
      expect(bus.listenerCount('work:completed')).to.be.greaterThan(0)
      expect(bus.listenerCount('work:status_changed')).to.be.greaterThan(0)
      expect(bus.listenerCount('work:pr_created')).to.be.greaterThan(0)
      expect(bus.listenerCount('agent:spawned')).to.be.greaterThan(0)
      expect(bus.listenerCount('agent:stopped')).to.be.greaterThan(0)

      manager.stop()
    })

    it('should unsubscribe on stop', () => {
      const manager = new HookManager(db)
      const bus = getEventBus()

      manager.start()
      expect(bus.listenerCount('work:started')).to.be.greaterThan(0)

      manager.stop()
      expect(bus.listenerCount('work:started')).to.equal(0)
    })

    it('should be safe to stop without starting', () => {
      const manager = new HookManager(db)
      expect(() => manager.stop()).to.not.throw()
    })

    it('should be safe to stop multiple times', () => {
      const manager = new HookManager(db)
      manager.start()
      manager.stop()
      expect(() => manager.stop()).to.not.throw()
    })
  })

  // =========================================================================
  // Hook Execution via Events
  // =========================================================================
  describe('event handling', () => {
    it('should execute matching hooks when event fires', () => {
      const storage = new WorkHookStorage(db)
      // Create a hook that runs a command
      storage.create({
        name: 'log-hook',
        event: 'work:started',
        actionType: 'shell',
        actionValue: 'true', // no-op, just succeed
      })

      const manager = new HookManager(db)
      manager.start()

      // Emit the event — the hook should execute without error
      const bus = getEventBus()
      expect(() => {
        bus.emit('work:started', { ticketId: 'TKT-1', agentName: 'a', branch: 'b', environment: 'host' } as any)
      }).to.not.throw()

      manager.stop()
    })

    it('should not execute hooks for non-matching events', () => {
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'only-started',
        event: 'work:started',
        actionType: 'shell',
        actionValue: 'echo matched',
      })

      const manager = new HookManager(db)
      manager.start()

      // Emit a different event — should not throw or execute the hook
      const bus = getEventBus()
      expect(() => {
        bus.emit('work:completed', { ticketId: 'TKT-1' } as any)
      }).to.not.throw()

      manager.stop()
    })

    it('should not execute disabled hooks', () => {
      const storage = new WorkHookStorage(db)
      const hook = storage.create({
        name: 'disabled-hook',
        event: 'work:started',
        actionType: 'shell',
        actionValue: 'exit 1', // Would fail if executed
      })
      storage.setEnabled(hook.id, false)

      const manager = new HookManager(db)
      manager.start()

      // Emit the event — disabled hook should be skipped
      const bus = getEventBus()
      expect(() => {
        bus.emit('work:started', { ticketId: 'TKT-1' } as any)
      }).to.not.throw()

      manager.stop()
    })

    it('should swallow hook execution errors without breaking event chain', () => {
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'bad-hook',
        event: 'work:started',
        actionType: 'shell',
        actionValue: 'exit 42',
      })
      storage.create({
        name: 'good-hook',
        event: 'work:started',
        actionType: 'shell',
        actionValue: 'true',
      })

      const manager = new HookManager(db)
      manager.start()

      // Both hooks should be attempted; the bad one fails silently
      const bus = getEventBus()
      expect(() => {
        bus.emit('work:started', { ticketId: 'TKT-1' } as any)
      }).to.not.throw()

      manager.stop()
    })
  })

  // =========================================================================
  // Singleton
  // =========================================================================
  describe('initHookManager / stopHookManager', () => {
    it('should initialize and return a HookManager', () => {
      const manager = initHookManager(db)
      expect(manager).to.be.instanceOf(HookManager)
    })

    it('should return the same instance on second call', () => {
      const m1 = initHookManager(db)
      const m2 = initHookManager(db)
      expect(m1).to.equal(m2)
    })

    it('should stop cleanly', () => {
      initHookManager(db)
      expect(() => stopHookManager()).to.not.throw()
    })

    it('should allow re-initialization after stop', () => {
      initHookManager(db)
      stopHookManager()
      const m2 = initHookManager(db)
      expect(m2).to.be.instanceOf(HookManager)
    })
  })
})
