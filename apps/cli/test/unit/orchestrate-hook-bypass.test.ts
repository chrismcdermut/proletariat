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
 * After PRLT-1219, both HookManager and OrchestrateEngine share the same
 * execution path. HookManager now supports mode-aware execution, and
 * OrchestrateEngine delegates to HookManager internally.
 *
 * The original bug (62 runaway containers) was caused by two separate
 * execution systems running in parallel. The consolidation prevents this
 * by having a single hook execution path with mode support.
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

  it('HookManager now respects mode — off-mode hooks are skipped (PRLT-1219 fix)', async () => {
    // After PRLT-1219, HookManager itself supports modes.
    // This test verifies the fix: HookManager no longer bypasses mode=off.
    const storage = new WorkHookStorage(db)
    storage.create({
      name: 'dangerous-hook',
      event: 'on_ci_green',
      actionType: 'shell',
      actionValue: 'exit 1', // Would fail if executed
    })
    // Set mode to off
    db.prepare("UPDATE pmo_work_hooks SET mode = 'off' WHERE name = 'dangerous-hook'").run()

    const manager = new HookManager({ db })

    // Fire via fireEvent — the hook should be skipped due to mode=off
    const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

    expect(results).to.have.length(1)
    expect(results[0].skipped).to.be.true
    // The command (exit 1) was NOT executed — mode=off prevented it

    manager.stop()
  })

  it('HookManager now respects confirm mode — queues without executing (PRLT-1219 fix)', async () => {
    const storage = new WorkHookStorage(db)
    storage.create({
      name: 'dangerous-hook',
      event: 'on_ci_green',
      actionType: 'shell',
      actionValue: 'exit 1', // Would fail if executed
    })
    db.prepare("UPDATE pmo_work_hooks SET mode = 'confirm' WHERE name = 'dangerous-hook'").run()

    const manager = new HookManager({ db })

    const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

    expect(results).to.have.length(1)
    expect(results[0].awaitingConfirmation).to.be.true
    // The command (exit 1) was NOT executed — confirm mode queued it

    manager.stop()
  })

  it('only one system should subscribe to events — no double execution', () => {
    const bus = getEventBus()

    // Before anything starts — no listeners
    expect(bus.listenerCount('work:started')).to.equal(0)

    // Start the engine (which internally creates a HookManager)
    const engine = new OrchestrateEngine({ db })
    engine.start()

    // Engine's internal HookManager adds its listeners
    const engineListenerCount = bus.listenerCount('work:started')
    expect(engineListenerCount).to.equal(1)

    // If a separate HookManager is also started (the old buggy pattern),
    // listener count would double — causing double execution
    const extraManager = new HookManager({ db })
    extraManager.start()
    expect(bus.listenerCount('work:started')).to.equal(2) // BAD: double subscription!

    extraManager.stop()

    // After stopping the extra manager, we're back to just the engine
    expect(bus.listenerCount('work:started')).to.equal(1)

    engine.stop()
    expect(bus.listenerCount('work:started')).to.equal(0)
  })
})
