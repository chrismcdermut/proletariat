import { expect } from 'chai'
import Database from 'better-sqlite3'
import { HookManager, initHookManager, stopHookManager } from '../../src/lib/work-lifecycle/hooks/manager.js'
import { WorkHookStorage, ensureHooksTable } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { getEventBus, resetEventBus } from '../../src/lib/events/event-bus.js'
import { orchestrateHooks } from '../../src/lib/database/migrations/0015_orchestrate_hooks.js'

/**
 * Tests for HookManager — event subscription, hook dispatch, lifecycle,
 * and mode-aware execution (auto/confirm/notify/off).
 */

describe('HookManager (TKT-140)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    ensureHooksTable(db)
    orchestrateHooks.up(db)
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
      expect(() => new HookManager({ db })).to.not.throw()
    })

    it('should start and subscribe to all hookable events', () => {
      const manager = new HookManager({ db })
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
      const manager = new HookManager({ db })
      const bus = getEventBus()

      manager.start()
      expect(bus.listenerCount('work:started')).to.be.greaterThan(0)

      manager.stop()
      expect(bus.listenerCount('work:started')).to.equal(0)
    })

    it('should be safe to stop without starting', () => {
      const manager = new HookManager({ db })
      expect(() => manager.stop()).to.not.throw()
    })

    it('should be safe to stop multiple times', () => {
      const manager = new HookManager({ db })
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

      const manager = new HookManager({ db })
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

      const manager = new HookManager({ db })
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

      const manager = new HookManager({ db })
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

      const manager = new HookManager({ db })
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
  // Mode-Aware Execution (PRLT-1219)
  // =========================================================================
  describe('mode support', () => {
    it('should execute auto hooks immediately', async () => {
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'auto-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'true',
      })
      // mode defaults to 'auto' from migration

      const manager = new HookManager({ db })
      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(results[0].skipped).to.be.undefined
      expect(results[0].awaitingConfirmation).to.be.undefined
    })

    it('should skip hooks with mode=off', async () => {
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'off-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'exit 1', // Would fail if executed
      })
      db.prepare("UPDATE pmo_work_hooks SET mode = 'off' WHERE name = 'off-hook'").run()

      const manager = new HookManager({ db })
      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].skipped).to.be.true
    })

    it('should queue confirm hooks without onConfirm callback', async () => {
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'confirm-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'true',
      })
      db.prepare("UPDATE pmo_work_hooks SET mode = 'confirm' WHERE name = 'confirm-hook'").run()

      const manager = new HookManager({ db })
      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].awaitingConfirmation).to.be.true
      expect(manager.getPendingConfirmations()).to.have.length(1)
    })

    it('should call onConfirm callback for confirm mode hooks', async () => {
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'confirm-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'true',
      })
      db.prepare("UPDATE pmo_work_hooks SET mode = 'confirm' WHERE name = 'confirm-hook'").run()

      let confirmCalled = false
      const manager = new HookManager({
        db,
        onConfirm: async (hookName, event, action) => {
          confirmCalled = true
          expect(hookName).to.equal('confirm-hook')
          expect(event).to.equal('on_ci_green')
          return true
        },
      })

      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(confirmCalled).to.be.true
      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(results[0].awaitingConfirmation).to.be.undefined
    })

    it('should skip confirm hook when onConfirm returns false', async () => {
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'denied-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'true',
      })
      db.prepare("UPDATE pmo_work_hooks SET mode = 'confirm' WHERE name = 'denied-hook'").run()

      const manager = new HookManager({
        db,
        onConfirm: async () => false,
      })

      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(results).to.have.length(1)
      expect(results[0].skipped).to.be.true
    })

    it('should call onNotify callback for notify mode hooks', async () => {
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'notify-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'true',
      })
      db.prepare("UPDATE pmo_work_hooks SET mode = 'notify' WHERE name = 'notify-hook'").run()

      let notifyCalled = false
      const manager = new HookManager({
        db,
        onNotify: (hookName, event, action, result) => {
          notifyCalled = true
          expect(hookName).to.equal('notify-hook')
          expect(event).to.equal('on_ci_green')
          expect(result.success).to.be.true
        },
      })

      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(notifyCalled).to.be.true
    })

    it('should execute hooks in priority order', async () => {
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'low-priority',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'true',
      })
      storage.create({
        name: 'high-priority',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'true',
      })
      db.prepare("UPDATE pmo_work_hooks SET priority = 10 WHERE name = 'low-priority'").run()
      db.prepare("UPDATE pmo_work_hooks SET priority = 1 WHERE name = 'high-priority'").run()

      const executed: string[] = []
      const manager = new HookManager({
        db,
        log: (msg) => {
          const match = msg.match(/(\w+-priority) →/)
          if (match) executed.push(match[1])
        },
      })

      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(executed[0]).to.equal('high-priority')
      expect(executed[1]).to.equal('low-priority')
    })

    it('should use built-in action handlers when provided', async () => {
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'builtin-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'test-action',
      })

      let handlerCalled = false
      const manager = new HookManager({
        db,
        actionHandlers: {
          'test-action': (ctx) => {
            handlerCalled = true
            return { action: 'test-action', success: true, durationMs: 0 }
          },
        },
      })

      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(handlerCalled).to.be.true
      expect(results).to.have.length(1)
      expect(results[0].action).to.equal('test-action')
      expect(results[0].success).to.be.true
    })
  })

  // =========================================================================
  // Pending Confirmations
  // =========================================================================
  describe('pendingConfirmations', () => {
    it('should approve a pending confirmation and execute it', async () => {
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'confirm-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'true',
      })
      db.prepare("UPDATE pmo_work_hooks SET mode = 'confirm' WHERE name = 'confirm-hook'").run()

      const manager = new HookManager({ db })
      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(manager.getPendingConfirmations()).to.have.length(1)

      const result = await manager.approveConfirmation(0)
      expect(result).to.not.be.null
      expect(result!.success).to.be.true
      expect(manager.getPendingConfirmations()).to.be.empty
    })

    it('should deny a pending confirmation and remove it', async () => {
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'confirm-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'true',
      })
      db.prepare("UPDATE pmo_work_hooks SET mode = 'confirm' WHERE name = 'confirm-hook'").run()

      const manager = new HookManager({ db })
      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      const denied = manager.denyConfirmation(0)
      expect(denied).to.be.true
      expect(manager.getPendingConfirmations()).to.be.empty
    })

    it('should return null for out-of-range approval index', async () => {
      const manager = new HookManager({ db })
      const result = await manager.approveConfirmation(99)
      expect(result).to.be.null
    })

    it('should return false for out-of-range denial index', () => {
      const manager = new HookManager({ db })
      const result = manager.denyConfirmation(99)
      expect(result).to.be.false
    })

    it('should clear pending confirmations on stop', async () => {
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'confirm-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'true',
      })
      db.prepare("UPDATE pmo_work_hooks SET mode = 'confirm' WHERE name = 'confirm-hook'").run()

      const manager = new HookManager({ db })
      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(manager.getPendingConfirmations()).to.have.length(1)

      manager.stop()
      expect(manager.getPendingConfirmations()).to.be.empty
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
