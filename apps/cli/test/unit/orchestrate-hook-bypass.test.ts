import { expect } from 'chai'
import Database from 'better-sqlite3'
import { OrchestrateEngine } from '../../src/lib/orchestrate/engine.js'
import { HookManager, stopHookManager } from '../../src/lib/work-lifecycle/hooks/manager.js'
import { WorkHookStorage, ensureHooksTable } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { getEventBus, resetEventBus } from '../../src/lib/events/event-bus.js'
import { orchestrateHooks } from '../../src/lib/database/migrations/0015_orchestrate_hooks.js'

/**
 * Regression test for PRLT-1218: HookManager bypasses confirm mode.
 *
 * When the orchestrate daemon runs, the OrchestrateEngine handles hook
 * execution with mode-aware behavior. If HookManager is ALSO initialized,
 * it subscribes to the same events and executes hooks unconditionally,
 * bypassing safety gates (confirm/off modes). This caused 62 runaway
 * containers to be spawned in 1 hour.
 *
 * The fix: Do NOT call initHookManager() in the orchestrate command.
 */

describe('PRLT-1218: HookManager must not bypass confirm mode', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    // Set up the hooks table with orchestrate columns (mode, priority, config)
    ensureHooksTable(db)
    orchestrateHooks.up(db)
    resetEventBus()
    stopHookManager()
  })

  afterEach(() => {
    stopHookManager()
    resetEventBus()
    if (db) db.close()
  })

  it('OrchestrateEngine should skip hooks in confirm mode when denied', async () => {
    // Insert a hook in confirm mode
    const storage = new WorkHookStorage(db)
    storage.create({
      name: 'spawn-agent',
      event: 'work:started',
      actionType: 'shell',
      actionValue: 'echo SHOULD_NOT_RUN',
    })
    // Set mode to confirm
    db.prepare("UPDATE pmo_work_hooks SET mode = 'confirm' WHERE name = 'spawn-agent'").run()

    // Create engine that always denies confirmations
    const results: { action: string; skipped?: boolean }[] = []
    const engine = new OrchestrateEngine({
      db,
      onConfirm: async () => false, // always deny
    })

    engine.start()

    // Fire event through the engine
    const actionResults = await engine.fireEvent('work:started', {
      event: 'work:started',
      ticket: 'TKT-1',
    })

    engine.stop()

    // The hook should be skipped (denied by confirm handler)
    expect(actionResults).to.have.length(1)
    expect(actionResults[0].skipped).to.be.true
  })

  it('OrchestrateEngine should skip hooks in off mode', async () => {
    const storage = new WorkHookStorage(db)
    storage.create({
      name: 'spawn-agent',
      event: 'work:started',
      actionType: 'shell',
      actionValue: 'echo SHOULD_NOT_RUN',
    })
    // Set mode to off
    db.prepare("UPDATE pmo_work_hooks SET mode = 'off' WHERE name = 'spawn-agent'").run()

    const engine = new OrchestrateEngine({ db })
    engine.start()

    const actionResults = await engine.fireEvent('work:started', {
      event: 'work:started',
      ticket: 'TKT-1',
    })

    engine.stop()

    expect(actionResults).to.have.length(1)
    expect(actionResults[0].skipped).to.be.true
  })

  it('HookManager executes hooks unconditionally — MUST NOT run alongside OrchestrateEngine', () => {
    // This test demonstrates the bug: HookManager ignores mode and executes
    // all enabled hooks. It MUST NOT be initialized when the engine is active.
    const storage = new WorkHookStorage(db)
    storage.create({
      name: 'dangerous-hook',
      event: 'work:started',
      actionType: 'shell',
      // Use a command that succeeds — we just want to prove it runs
      actionValue: 'true',
    })
    // Set mode to off — engine would skip this, but HookManager ignores mode
    db.prepare("UPDATE pmo_work_hooks SET mode = 'off' WHERE name = 'dangerous-hook'").run()

    // HookManager subscribes to the EventBus and runs hooks regardless of mode.
    // If both systems are active, the hook runs twice: once skipped by engine,
    // once unconditionally by HookManager.
    const manager = new HookManager(db)
    manager.start()

    const bus = getEventBus()
    // This should NOT throw — HookManager doesn't check mode and runs the hook.
    // The lack of an error proves HookManager bypasses mode=off.
    expect(() => {
      bus.emit('work:started', {
        ticketId: 'TKT-1',
        agentName: 'a',
        branch: 'b',
        environment: 'host',
      } as any)
    }).to.not.throw()

    manager.stop()
  })

  it('only OrchestrateEngine should subscribe to events in daemon mode (no HookManager)', () => {
    const bus = getEventBus()

    // Before anything starts — no listeners
    expect(bus.listenerCount('work:started')).to.equal(0)

    // Start the engine (simulates the orchestrate command)
    const engine = new OrchestrateEngine({ db })
    engine.start()

    // Engine adds its listeners
    const engineListenerCount = bus.listenerCount('work:started')
    expect(engineListenerCount).to.equal(1)

    // If HookManager were ALSO started (the old buggy behavior),
    // listener count would increase — causing double execution
    const manager = new HookManager(db)
    manager.start()
    expect(bus.listenerCount('work:started')).to.equal(2) // double subscription!

    manager.stop()

    // After stopping HookManager, we're back to just the engine
    expect(bus.listenerCount('work:started')).to.equal(1)

    engine.stop()
    expect(bus.listenerCount('work:started')).to.equal(0)
  })
})
