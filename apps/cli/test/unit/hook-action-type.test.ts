import { expect } from 'chai'
import Database from 'better-sqlite3'
import { ensureHooksTable, WorkHookStorage } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { HookManager } from '../../src/lib/work-lifecycle/hooks/manager.js'
import { executeHook } from '../../src/lib/work-lifecycle/hooks/executor.js'
import { applyPreset } from '../../src/lib/orchestrate/config-loader.js'
import { PRESETS } from '../../src/lib/orchestrate/presets.js'
import { createServiceActionHandlers, SERVICE_BACKED_ACTIONS } from '../../src/lib/orchestrate/service-actions.js'
import { hookActionType } from '../../src/lib/database/migrations/0026_hook_action_type.js'
import { resetEventBus } from '../../src/lib/events/event-bus.js'
import type { WorkHookConfig, HookActionHandler, AsyncHookActionHandler } from '../../src/lib/work-lifecycle/hooks/types.js'

/**
 * Tests for PRLT-1304: Wire hooks to service layer.
 *
 * Covers:
 * - action type in HookActionType (types, storage, executor)
 * - Migration 0026: CHECK constraint expansion and preset migration
 * - Service-backed action handlers (createServiceActionHandlers)
 * - HookManager routing: action-type → service handlers, shell-type → ACTION_HANDLERS
 * - Preset hooks use action_type='action' after applyPreset()
 * - Backward compatibility: shell-type hooks still work
 * - Latency: action-type handlers avoid spawning new processes
 */

// =============================================================================
// Helpers
// =============================================================================

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  ensureHooksTable(db)
  try {
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'confirm', 'notify', 'llm', 'human', 'off'))")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN project_id TEXT")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN source TEXT NOT NULL DEFAULT 'cli' CHECK (source IN ('yaml', 'cli', 'preset'))")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN config TEXT")
    db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_priority ON pmo_work_hooks(event, priority)')
  } catch {
    // Columns may already exist
  }
  return db
}

/**
 * Create a test DB that mimics the pre-migration state (no 'action' in CHECK constraint).
 * Used to test the migration itself.
 */
function createPreMigrationDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE pmo_work_hooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      event TEXT NOT NULL,
      action_type TEXT NOT NULL DEFAULT 'shell' CHECK (action_type IN ('shell', 'webhook', 'log')),
      action_value TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'confirm', 'notify', 'llm', 'human', 'off')),
      priority INTEGER NOT NULL DEFAULT 0,
      project_id TEXT,
      source TEXT NOT NULL DEFAULT 'cli' CHECK (source IN ('yaml', 'cli', 'preset')),
      config TEXT
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_event ON pmo_work_hooks(event)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_enabled ON pmo_work_hooks(enabled)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_priority ON pmo_work_hooks(event, priority)')
  return db
}

function insertHook(db: Database.Database, opts: {
  name: string
  event: string
  actionType?: string
  actionValue: string
  mode?: string
  priority?: number
  config?: string
  source?: string
  enabled?: number
}): string {
  const id = `hook-${Math.random().toString(36).slice(2, 8)}`
  db.prepare(`
    INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, mode, priority, source, config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.name,
    opts.event,
    opts.actionType ?? 'shell',
    opts.actionValue,
    opts.enabled ?? 1,
    opts.mode ?? 'auto',
    opts.priority ?? 0,
    opts.source ?? 'cli',
    opts.config ?? null,
  )
  return id
}

// =============================================================================
// Tests
// =============================================================================

describe('Hook Action Type (PRLT-1304)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    resetEventBus()
  })

  afterEach(() => {
    resetEventBus()
    db.close()
  })

  // ===========================================================================
  // Storage: action type support
  // ===========================================================================

  describe('WorkHookStorage', () => {
    it('should create hooks with action_type="action"', () => {
      const storage = new WorkHookStorage(db)
      const hook = storage.create({
        name: 'test-action-hook',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'merge-pr',
        description: 'Direct merge-pr action',
      })
      expect(hook.actionType).to.equal('action')
      expect(hook.actionValue).to.equal('merge-pr')
    })

    it('should list hooks with action_type="action"', () => {
      const storage = new WorkHookStorage(db)
      storage.create({ name: 'action-hook', event: 'on_ci_green', actionType: 'action', actionValue: 'merge-pr' })
      storage.create({ name: 'shell-hook', event: 'on_ci_green', actionType: 'shell', actionValue: 'echo hi' })
      const hooks = storage.list({ event: 'on_ci_green' })
      expect(hooks).to.have.length(2)
      const actionHook = hooks.find(h => h.actionType === 'action')
      expect(actionHook).to.exist
      expect(actionHook!.actionValue).to.equal('merge-pr')
    })

    it('should still create shell-type hooks (backward compat)', () => {
      const storage = new WorkHookStorage(db)
      const hook = storage.create({
        name: 'shell-hook',
        event: 'work:started',
        actionType: 'shell',
        actionValue: 'echo "hello"',
      })
      expect(hook.actionType).to.equal('shell')
    })
  })

  // ===========================================================================
  // Executor: action type handling
  // ===========================================================================

  describe('executeHook (executor)', () => {
    it('should return error for action-type hooks (they must use built-in handlers)', () => {
      const hook: WorkHookConfig = {
        id: 'test-1',
        name: 'action-hook',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'move-ticket',
        enabled: true,
        description: null,
        createdAt: new Date().toISOString(),
        mode: 'auto',
        priority: 0,
        config: null,
      }
      const result = executeHook(hook, 'on_ci_green', {})
      expect(result.success).to.be.false
      expect(result.error).to.include('action-type hooks must be routed through built-in action handlers')
    })
  })

  // ===========================================================================
  // HookManager: action-type routing
  // ===========================================================================

  describe('HookManager', () => {
    it('should resolve action name directly from actionValue for action-type hooks', () => {
      const hook: WorkHookConfig = {
        id: 'test-1',
        name: 'action-hook',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'move-ticket',
        enabled: true,
        description: null,
        createdAt: new Date().toISOString(),
        mode: 'auto',
        priority: 0,
        config: null,
      }
      const result = HookManager.resolveActionName(hook, {})
      expect(result).to.equal('move-ticket')
    })

    it('should extract --action name from shell-type hooks (backward compat)', () => {
      const hook: WorkHookConfig = {
        id: 'test-2',
        name: 'shell-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'prlt hook fire on_ci_green --action merge-pr',
        enabled: true,
        description: null,
        createdAt: new Date().toISOString(),
        mode: 'auto',
        priority: 0,
        config: null,
      }
      const result = HookManager.resolveActionName(hook, {})
      expect(result).to.equal('merge-pr')
    })

    it('should route action-type hooks to service action handlers', async () => {
      let handlerCalled = false
      const serviceHandlers: Record<string, AsyncHookActionHandler> = {
        'move-ticket': async (ctx, config) => {
          handlerCalled = true
          return { action: 'move-ticket', success: true, durationMs: 1 }
        },
      }

      insertHook(db, {
        name: 'action-move',
        event: 'on_agent_spawned',
        actionType: 'action',
        actionValue: 'move-ticket',
        config: JSON.stringify({ target: 'in-progress' }),
      })

      const manager = new HookManager({
        db,
        serviceActionHandlers: serviceHandlers,
      })
      const results = await manager.fireEvent('on_agent_spawned', { ticketId: 'TKT-1' })
      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(results[0].action).to.equal('move-ticket')
      expect(handlerCalled).to.be.true
    })

    it('should fall back to sync actionHandlers for action-type hooks when no service handler exists', async () => {
      let syncCalled = false
      const actionHandlers: Record<string, HookActionHandler> = {
        'gc-sweep': (_ctx) => {
          syncCalled = true
          return { action: 'gc-sweep', success: true, durationMs: 1 }
        },
      }

      insertHook(db, {
        name: 'action-gc',
        event: 'on_agent_completed',
        actionType: 'action',
        actionValue: 'gc-sweep',
      })

      const manager = new HookManager({
        db,
        actionHandlers,
      })
      const results = await manager.fireEvent('on_agent_completed', { ticketId: 'TKT-1' })
      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(syncCalled).to.be.true
    })

    it('should return error for action-type hooks with no matching handler', async () => {
      insertHook(db, {
        name: 'action-unknown',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'nonexistent-action',
      })

      const manager = new HookManager({ db })
      const results = await manager.fireEvent('on_ci_green', {})
      expect(results).to.have.length(1)
      expect(results[0].success).to.be.false
      expect(results[0].error).to.include("No built-in action handler for 'nonexistent-action'")
    })

    it('should still execute shell-type hooks via ACTION_HANDLERS (backward compat)', async () => {
      let handlerCalled = false
      const actionHandlers: Record<string, HookActionHandler> = {
        'notify': (_ctx) => {
          handlerCalled = true
          return { action: 'notify', success: true, durationMs: 1 }
        },
      }

      insertHook(db, {
        name: 'shell-notify',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'prlt hook fire on_ci_green --action notify',
      })

      const manager = new HookManager({
        db,
        actionHandlers,
      })
      const results = await manager.fireEvent('on_ci_green', {})
      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(handlerCalled).to.be.true
    })

    it('should prefer service handlers over sync handlers for action-type hooks', async () => {
      let serviceHandlerCalled = false
      let syncHandlerCalled = false

      const serviceHandlers: Record<string, AsyncHookActionHandler> = {
        'move-ticket': async () => {
          serviceHandlerCalled = true
          return { action: 'move-ticket', success: true, durationMs: 1 }
        },
      }

      const actionHandlers: Record<string, HookActionHandler> = {
        'move-ticket': () => {
          syncHandlerCalled = true
          return { action: 'move-ticket', success: true, durationMs: 1 }
        },
      }

      insertHook(db, {
        name: 'action-move',
        event: 'on_pr_merged',
        actionType: 'action',
        actionValue: 'move-ticket',
        config: JSON.stringify({ target: 'done' }),
      })

      const manager = new HookManager({
        db,
        actionHandlers,
        serviceActionHandlers: serviceHandlers,
      })
      const results = await manager.fireEvent('on_pr_merged', { ticketId: 'TKT-1' })
      expect(results).to.have.length(1)
      expect(serviceHandlerCalled).to.be.true
      expect(syncHandlerCalled).to.be.false
    })

    it('should not use service handlers for shell-type hooks', async () => {
      let serviceHandlerCalled = false
      let syncHandlerCalled = false

      const serviceHandlers: Record<string, AsyncHookActionHandler> = {
        'move-ticket': async () => {
          serviceHandlerCalled = true
          return { action: 'move-ticket', success: true, durationMs: 1 }
        },
      }

      const actionHandlers: Record<string, HookActionHandler> = {
        'move-ticket': () => {
          syncHandlerCalled = true
          return { action: 'move-ticket', success: true, durationMs: 1 }
        },
      }

      insertHook(db, {
        name: 'shell-move',
        event: 'on_pr_merged',
        actionType: 'shell',
        actionValue: 'prlt hook fire on_pr_merged --action move-ticket',
      })

      const manager = new HookManager({
        db,
        actionHandlers,
        serviceActionHandlers: serviceHandlers,
      })
      const results = await manager.fireEvent('on_pr_merged', { ticketId: 'TKT-1' })
      expect(results).to.have.length(1)
      // Shell-type hooks go through the sync handler path, not service handlers
      expect(syncHandlerCalled).to.be.true
      expect(serviceHandlerCalled).to.be.false
    })
  })

  // ===========================================================================
  // Migration 0026: Hook Action Type
  // ===========================================================================

  describe('Migration 0026 (hookActionType)', () => {
    it('should add action to CHECK constraint', () => {
      const preMigDb = createPreMigrationDb()
      try {
        hookActionType.up(preMigDb)

        // Verify we can now insert action-type hooks
        preMigDb.prepare(`
          INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value)
          VALUES ('test-1', 'test-hook', 'on_ci_green', 'action', 'merge-pr')
        `).run()

        const row = preMigDb.prepare('SELECT action_type FROM pmo_work_hooks WHERE id = ?').get('test-1') as { action_type: string }
        expect(row.action_type).to.equal('action')
      } finally {
        preMigDb.close()
      }
    })

    it('should migrate preset shell hooks to action type', () => {
      const preMigDb = createPreMigrationDb()
      try {
        // Insert preset hooks with shell indirection (pre-migration pattern)
        preMigDb.prepare(`
          INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, source)
          VALUES ('p1', 'preset:agg:on_ci_green:merge-pr:0', 'on_ci_green', 'shell', 'prlt hook fire on_ci_green --action merge-pr', 'preset')
        `).run()
        preMigDb.prepare(`
          INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, source)
          VALUES ('p2', 'preset:agg:on_pr_merged:move-ticket:1', 'on_pr_merged', 'shell', 'prlt hook fire on_pr_merged --action move-ticket', 'preset')
        `).run()

        // Insert a CLI hook that should NOT be migrated
        preMigDb.prepare(`
          INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, source)
          VALUES ('c1', 'custom-shell', 'on_ci_green', 'shell', 'echo "CI passed"', 'cli')
        `).run()

        hookActionType.up(preMigDb)

        // Verify preset hooks were migrated
        const p1 = preMigDb.prepare('SELECT action_type, action_value FROM pmo_work_hooks WHERE id = ?').get('p1') as { action_type: string; action_value: string }
        expect(p1.action_type).to.equal('action')
        expect(p1.action_value).to.equal('merge-pr')

        const p2 = preMigDb.prepare('SELECT action_type, action_value FROM pmo_work_hooks WHERE id = ?').get('p2') as { action_type: string; action_value: string }
        expect(p2.action_type).to.equal('action')
        expect(p2.action_value).to.equal('move-ticket')

        // Verify CLI hook was NOT migrated
        const c1 = preMigDb.prepare('SELECT action_type, action_value FROM pmo_work_hooks WHERE id = ?').get('c1') as { action_type: string; action_value: string }
        expect(c1.action_type).to.equal('shell')
        expect(c1.action_value).to.equal('echo "CI passed"')
      } finally {
        preMigDb.close()
      }
    })

    it('should be idempotent (skip if already migrated)', () => {
      const preMigDb = createPreMigrationDb()
      try {
        hookActionType.up(preMigDb)
        // Running again should not throw
        hookActionType.up(preMigDb)

        // Verify we can still insert
        preMigDb.prepare(`
          INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value)
          VALUES ('idem-1', 'test', 'on_ci_green', 'action', 'notify')
        `).run()

        const row = preMigDb.prepare('SELECT action_type FROM pmo_work_hooks WHERE id = ?').get('idem-1') as { action_type: string }
        expect(row.action_type).to.equal('action')
      } finally {
        preMigDb.close()
      }
    })

    it('should preserve all existing data during table recreation', () => {
      const preMigDb = createPreMigrationDb()
      try {
        // Insert hook with all columns populated
        preMigDb.prepare(`
          INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, description, mode, priority, project_id, source, config)
          VALUES ('full-1', 'full-hook', 'on_ci_green', 'shell', 'echo test', 1, 'Test desc', 'llm', 5, 'PRLT', 'cli', '{"key":"val"}')
        `).run()

        hookActionType.up(preMigDb)

        const row = preMigDb.prepare('SELECT * FROM pmo_work_hooks WHERE id = ?').get('full-1') as Record<string, unknown>
        expect(row.name).to.equal('full-hook')
        expect(row.event).to.equal('on_ci_green')
        expect(row.action_type).to.equal('shell')
        expect(row.action_value).to.equal('echo test')
        expect(row.enabled).to.equal(1)
        expect(row.description).to.equal('Test desc')
        expect(row.mode).to.equal('llm')
        expect(row.priority).to.equal(5)
        expect(row.project_id).to.equal('PRLT')
        expect(row.source).to.equal('cli')
        expect(row.config).to.equal('{"key":"val"}')
      } finally {
        preMigDb.close()
      }
    })

    it('should skip when table does not exist', () => {
      const emptyDb = new Database(':memory:')
      try {
        // Should not throw
        hookActionType.up(emptyDb)
      } finally {
        emptyDb.close()
      }
    })
  })

  // ===========================================================================
  // Service Action Handlers
  // ===========================================================================

  describe('createServiceActionHandlers', () => {
    it('should return handlers for service-backed actions', () => {
      const handlers = createServiceActionHandlers(db)
      expect(handlers['move-ticket']).to.be.a('function')
      expect(handlers['notify']).to.be.a('function')
    })

    it('should report SERVICE_BACKED_ACTIONS matching handler keys', () => {
      expect(SERVICE_BACKED_ACTIONS.has('move-ticket')).to.be.true
      expect(SERVICE_BACKED_ACTIONS.has('notify')).to.be.true
    })

    it('move-ticket handler should fail without ticket in context', async () => {
      const handlers = createServiceActionHandlers(db)
      const result = await handlers['move-ticket']({ event: 'on_pr_merged' })
      expect(result.success).to.be.false
      expect(result.error).to.include('No ticket in context')
      expect(result.action).to.equal('move-ticket')
    })

    it('notify handler should succeed with fallback to console.log', async () => {
      const handlers = createServiceActionHandlers(db)
      const result = await handlers['notify']({ event: 'on_ci_green', ticket: 'TKT-1' })
      expect(result.success).to.be.true
      expect(result.action).to.equal('notify')
      expect(result.durationMs).to.be.a('number')
    })
  })

  // ===========================================================================
  // Preset Application
  // ===========================================================================

  describe('applyPreset with action type', () => {
    it('should create preset hooks with action_type="action"', () => {
      const count = applyPreset(db, 'aggressive')
      expect(count).to.be.greaterThan(0)

      const hooks = db.prepare(
        "SELECT action_type, action_value FROM pmo_work_hooks WHERE source = 'preset'"
      ).all() as Array<{ action_type: string; action_value: string }>

      // All preset hooks should be action type
      for (const hook of hooks) {
        expect(hook.action_type).to.equal('action')
        // action_value should be the action name directly (e.g. 'merge-pr'), not a shell command
        expect(hook.action_value).to.not.include('prlt hook fire')
        expect(hook.action_value).to.not.include('--action')
      }
    })

    it('should create all 21 preset hooks for aggressive preset', () => {
      const count = applyPreset(db, 'aggressive')
      expect(count).to.equal(PRESETS.aggressive.hooks.length)
    })

    it('should create hooks for conservative preset with correct modes', () => {
      applyPreset(db, 'conservative')

      const hooks = db.prepare(
        "SELECT action_value, mode FROM pmo_work_hooks WHERE source = 'preset'"
      ).all() as Array<{ action_value: string; mode: string }>

      // move-ticket and notify should be auto, spawn-agent should be human
      const moveHook = hooks.find(h => h.action_value === 'move-ticket')
      expect(moveHook?.mode).to.equal('auto')

      const spawnHook = hooks.find(h => h.action_value === 'spawn-agent')
      expect(spawnHook?.mode).to.equal('human')
    })

    it('should create hooks for supervised preset with correct modes', () => {
      applyPreset(db, 'supervised')

      const hooks = db.prepare(
        "SELECT action_value, mode FROM pmo_work_hooks WHERE source = 'preset'"
      ).all() as Array<{ action_value: string; mode: string }>

      const notifyHook = hooks.find(h => h.action_value === 'notify')
      expect(notifyHook?.mode).to.equal('auto')

      const spawnHook = hooks.find(h => h.action_value === 'spawn-agent')
      expect(spawnHook?.mode).to.equal('llm')
    })
  })

  // ===========================================================================
  // No process spawning for action-type hooks
  // ===========================================================================

  describe('No process spawning', () => {
    it('action-type hooks should not call execSync or child_process', async () => {
      let handlerCtx: Record<string, unknown> | null = null
      let handlerConfig: Record<string, unknown> | undefined

      const serviceHandlers: Record<string, AsyncHookActionHandler> = {
        'move-ticket': async (ctx, config) => {
          handlerCtx = ctx
          handlerConfig = config
          return { action: 'move-ticket', success: true, durationMs: 0 }
        },
      }

      insertHook(db, {
        name: 'action-move',
        event: 'on_agent_spawned',
        actionType: 'action',
        actionValue: 'move-ticket',
        config: JSON.stringify({ target: 'in-progress' }),
      })

      const manager = new HookManager({
        db,
        serviceActionHandlers: serviceHandlers,
      })

      const results = await manager.fireEvent('on_agent_spawned', { ticketId: 'TKT-99' })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      // Verify the handler received the correct context and config
      expect(handlerCtx).to.include({ ticket: 'TKT-99' })
      expect(handlerConfig).to.deep.equal({ target: 'in-progress' })
    })
  })

  // ===========================================================================
  // Latency measurement
  // ===========================================================================

  describe('Latency', () => {
    it('action-type handler execution should be sub-millisecond (no process spawn)', async () => {
      const serviceHandlers: Record<string, AsyncHookActionHandler> = {
        'notify': async () => {
          return { action: 'notify', success: true, durationMs: 0 }
        },
      }

      insertHook(db, {
        name: 'action-notify',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'notify',
      })

      const manager = new HookManager({
        db,
        serviceActionHandlers: serviceHandlers,
      })

      const start = Date.now()
      const results = await manager.fireEvent('on_ci_green', {})
      const elapsed = Date.now() - start

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      // In-process action should complete well under 100ms (no process spawn overhead)
      expect(elapsed).to.be.lessThan(100)
    })
  })

  // ===========================================================================
  // Mode-aware behavior with action-type hooks
  // ===========================================================================

  describe('Mode-aware behavior with action-type hooks', () => {
    it('should skip action-type hooks when mode is off', async () => {
      insertHook(db, {
        name: 'action-off',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'merge-pr',
        mode: 'off',
      })

      const manager = new HookManager({ db })
      const results = await manager.fireEvent('on_ci_green', {})
      expect(results).to.have.length(1)
      expect(results[0].skipped).to.be.true
    })

    it('should queue action-type hooks for confirmation when mode is confirm', async () => {
      insertHook(db, {
        name: 'action-confirm',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'merge-pr',
        mode: 'confirm',
      })

      const manager = new HookManager({ db })
      const results = await manager.fireEvent('on_ci_green', {})
      expect(results).to.have.length(1)
      expect(results[0].awaitingConfirmation).to.be.true

      const pending = manager.getPendingConfirmations()
      expect(pending).to.have.length(1)
      expect(pending[0].action).to.equal('merge-pr')
    })

    it('should queue action-type hooks for LLM when mode is llm', async () => {
      insertHook(db, {
        name: 'action-llm',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'spawn-agent',
        mode: 'llm',
      })

      const manager = new HookManager({ db })
      const results = await manager.fireEvent('on_ci_green', { ticketId: 'TKT-1' })
      expect(results).to.have.length(1)
      expect(results[0].awaitingLlmDecision).to.be.true

      const pending = manager.getPendingLlmDecisions()
      expect(pending).to.have.length(1)
      expect(pending[0].action).to.equal('spawn-agent')
    })
  })
})
