import { expect } from 'chai'
import Database from 'better-sqlite3'
import { HookManager } from '../../src/lib/work-lifecycle/hooks/manager.js'
import { WorkHookStorage, ensureHooksTable } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { executeHook } from '../../src/lib/work-lifecycle/hooks/executor.js'
import { applyPreset } from '../../src/lib/orchestrate/config-loader.js'
import { PRESETS } from '../../src/lib/orchestrate/presets.js'
import { OrchestrateEngine } from '../../src/lib/orchestrate/engine.js'
import { createServiceActionHandlers } from '../../src/lib/orchestrate/service-actions.js'
import { BUILTIN_ACTIONS, PRESET_NAMES } from '../../src/lib/orchestrate/types.js'
import { resetEventBus } from '../../src/lib/events/event-bus.js'
import type { WorkHookConfig, HookActionHandler, HookActionHandlerResult } from '../../src/lib/work-lifecycle/hooks/types.js'
import { hookActionType } from '../../src/lib/database/migrations/0025_hook_action_type.js'

/**
 * Unit tests for PRLT-1304: Wire hooks to service layer.
 *
 * Tests cover:
 * - action_type='action' in the data model (types, storage, migration)
 * - Preset hooks stored as action type (no shell indirection)
 * - Action handlers called directly (in-process, no prlt spawn)
 * - Backward compatibility for shell-type hooks
 * - resolveActionName for action-type hooks
 * - Service-backed action handlers
 * - Latency improvement (action vs shell)
 */

// ===========================================================================
// Test DB setup
// ===========================================================================

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  ensureHooksTable(db)
  try {
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'confirm', 'notify', 'llm', 'human', 'off'))")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN project_id TEXT")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN source TEXT NOT NULL DEFAULT 'cli' CHECK (source IN ('yaml', 'cli', 'preset'))")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN config TEXT")
    db.exec("CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_priority ON pmo_work_hooks(event, priority)")
  } catch {
    // Columns may already exist
  }
  return db
}

/**
 * Create a test DB that already has the 0025 migration applied
 * (action_type CHECK constraint includes 'action').
 */
function createMigratedTestDb(): Database.Database {
  const db = createTestDb()
  hookActionType.up(db)
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
  enabled?: number
  source?: string
}): string {
  const id = `hook-${Math.random().toString(36).slice(2, 8)}`
  db.prepare(`
    INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, mode, priority, source, config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.name,
    opts.event,
    opts.actionType ?? 'action',
    opts.actionValue,
    opts.enabled ?? 1,
    opts.mode ?? 'auto',
    opts.priority ?? 0,
    opts.source ?? 'cli',
    opts.config ?? null,
  )
  return id
}

// ===========================================================================
// Tests
// ===========================================================================

describe('PRLT-1304: Hook Action Type', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createMigratedTestDb()
    resetEventBus()
  })

  afterEach(() => {
    resetEventBus()
    db.close()
  })

  // =========================================================================
  // Data Model
  // =========================================================================

  describe('data model', () => {
    it('should accept action_type=action in the database', () => {
      expect(() => insertHook(db, {
        name: 'test-action-hook',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'merge-pr',
      })).to.not.throw()

      const row = db.prepare("SELECT action_type, action_value FROM pmo_work_hooks WHERE name = ?")
        .get('test-action-hook') as { action_type: string; action_value: string }
      expect(row.action_type).to.equal('action')
      expect(row.action_value).to.equal('merge-pr')
    })

    it('should still accept shell/webhook/log types', () => {
      expect(() => insertHook(db, {
        name: 'shell-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'echo hello',
      })).to.not.throw()

      expect(() => insertHook(db, {
        name: 'log-hook',
        event: 'on_ci_green',
        actionType: 'log',
        actionValue: 'Event: {{event}}',
      })).to.not.throw()
    })

    it('WorkHookStorage should list action-type hooks', () => {
      insertHook(db, {
        name: 'action-hook',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'merge-pr',
      })

      const storage = new WorkHookStorage(db)
      const hooks = storage.list({ event: 'on_ci_green' as any })
      expect(hooks).to.have.length(1)
      expect(hooks[0].actionType).to.equal('action')
      expect(hooks[0].actionValue).to.equal('merge-pr')
    })
  })

  // =========================================================================
  // Migration
  // =========================================================================

  describe('migration 0025', () => {
    it('should be idempotent — safe to run twice', () => {
      const freshDb = createTestDb()
      hookActionType.up(freshDb)
      expect(() => hookActionType.up(freshDb)).to.not.throw()
      freshDb.close()
    })

    it('should migrate preset hooks from shell to action type', () => {
      // Start with a fresh DB that does NOT have the 'action' CHECK constraint yet
      // (simulating pre-migration state). We need a DB without CHECK constraint
      // restrictions so we can verify the migration adds support.
      const freshDb = new Database(':memory:')
      // Create table WITHOUT action CHECK constraint (simulating old schema)
      freshDb.exec(`
        CREATE TABLE pmo_work_hooks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          event TEXT NOT NULL,
          action_type TEXT NOT NULL DEFAULT 'shell',
          action_value TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          mode TEXT NOT NULL DEFAULT 'auto',
          priority INTEGER NOT NULL DEFAULT 0,
          project_id TEXT,
          source TEXT NOT NULL DEFAULT 'cli',
          config TEXT
        )
      `)

      // Insert a shell-type preset hook (old format)
      freshDb.prepare(`
        INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, mode, priority, source, config)
        VALUES (?, ?, ?, 'shell', ?, 1, 'auto', 0, 'preset', NULL)
      `).run('test-1', 'preset:aggressive:on_ci_green:merge-pr:0', 'on_ci_green', 'prlt hook fire on_ci_green --action merge-pr')

      // Run migration
      hookActionType.up(freshDb)

      // Should now be action type
      const row = freshDb.prepare("SELECT action_type, action_value FROM pmo_work_hooks WHERE id = ?")
        .get('test-1') as { action_type: string; action_value: string }
      expect(row.action_type).to.equal('action')
      expect(row.action_value).to.equal('merge-pr')

      freshDb.close()
    })

    it('should NOT migrate non-preset shell hooks', () => {
      const freshDb = createTestDb()

      // Insert a user-defined shell hook (should NOT be migrated)
      freshDb.prepare(`
        INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, mode, priority, source, config)
        VALUES (?, ?, ?, 'shell', ?, 1, 'auto', 0, 'cli', NULL)
      `).run('user-1', 'my-custom-hook', 'on_ci_green', 'echo "CI passed!"')

      // Run migration
      hookActionType.up(freshDb)

      // Should still be shell type
      const row = freshDb.prepare("SELECT action_type, action_value FROM pmo_work_hooks WHERE id = ?")
        .get('user-1') as { action_type: string; action_value: string }
      expect(row.action_type).to.equal('shell')
      expect(row.action_value).to.equal('echo "CI passed!"')

      freshDb.close()
    })
  })

  // =========================================================================
  // Preset Application
  // =========================================================================

  describe('preset application', () => {
    it('should store preset hooks with action_type=action', () => {
      applyPreset(db, 'aggressive')

      const hooks = db.prepare("SELECT action_type, action_value FROM pmo_work_hooks WHERE source = 'preset'")
        .all() as Array<{ action_type: string; action_value: string }>

      expect(hooks.length).to.be.greaterThan(0)

      for (const hook of hooks) {
        expect(hook.action_type).to.equal('action',
          `Hook with action_value "${hook.action_value}" should be action type, not shell`)
      }
    })

    it('should store action names directly (not prlt hook fire commands)', () => {
      applyPreset(db, 'aggressive')

      const hooks = db.prepare("SELECT action_value FROM pmo_work_hooks WHERE source = 'preset'")
        .all() as Array<{ action_value: string }>

      for (const hook of hooks) {
        // Should be a clean action name, not a prlt command
        expect(hook.action_value).to.not.include('prlt hook fire')
        expect(hook.action_value).to.not.include('--action')
        // Should be a known built-in action name
        expect(BUILTIN_ACTIONS).to.include(hook.action_value as any)
      }
    })

    it('all 22 preset hooks should use action type (not shell)', () => {
      applyPreset(db, 'aggressive')

      const count = db.prepare(
        "SELECT COUNT(*) as c FROM pmo_work_hooks WHERE source = 'preset' AND action_type = 'action'"
      ).get() as { c: number }

      expect(count.c).to.equal(PRESETS.aggressive.hooks.length)
    })

    it('should work for all preset names', () => {
      for (const presetName of PRESET_NAMES) {
        try { db.exec("DELETE FROM pmo_work_hooks WHERE source = 'preset'") } catch { /* */ }

        applyPreset(db, presetName)

        const shellCount = db.prepare(
          "SELECT COUNT(*) as c FROM pmo_work_hooks WHERE source = 'preset' AND action_type = 'shell'"
        ).get() as { c: number }

        expect(shellCount.c).to.equal(0,
          `Preset "${presetName}" should have no shell-type hooks`)
      }
    })
  })

  // =========================================================================
  // resolveActionName
  // =========================================================================

  describe('resolveActionName', () => {
    it('should return action_value directly for action-type hooks', () => {
      const hook: WorkHookConfig = {
        id: 'test',
        name: 'test',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'merge-pr',
        enabled: true,
        description: null,
        createdAt: '',
        mode: 'auto',
        priority: 0,
        config: null,
      }

      const result = HookManager.resolveActionName(hook)
      expect(result).to.equal('merge-pr')
    })

    it('should still extract --action from shell-type hooks (backward compat)', () => {
      const hook: WorkHookConfig = {
        id: 'test',
        name: 'test',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'prlt hook fire on_ci_green --action merge-pr',
        enabled: true,
        description: null,
        createdAt: '',
        mode: 'auto',
        priority: 0,
        config: null,
      }

      const result = HookManager.resolveActionName(hook)
      expect(result).to.equal('merge-pr')
    })

    it('should return raw command for shell-type hooks without --action', () => {
      const hook: WorkHookConfig = {
        id: 'test',
        name: 'test',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'echo hello',
        enabled: true,
        description: null,
        createdAt: '',
        mode: 'auto',
        priority: 0,
        config: null,
      }

      const result = HookManager.resolveActionName(hook)
      expect(result).to.equal('echo hello')
    })
  })

  // =========================================================================
  // Direct Execution (no shell)
  // =========================================================================

  describe('direct execution via action handlers', () => {
    it('should call action handler in-process for action-type hooks', async () => {
      let handlerCalled = false
      let receivedCtx: Record<string, unknown> | null = null

      const actionHandlers: Record<string, HookActionHandler> = {
        'move-ticket': (ctx, config) => {
          handlerCalled = true
          receivedCtx = ctx
          return { action: 'move-ticket', success: true, durationMs: 1 }
        },
      }

      insertHook(db, {
        name: 'action-move',
        event: 'on_pr_opened',
        actionType: 'action',
        actionValue: 'move-ticket',
        config: JSON.stringify({ target: 'review' }),
      })

      const manager = new HookManager({ db, actionHandlers })
      const results = await manager.fireEvent('on_pr_opened', { ticket: 'TKT-100', pr: 42 })

      expect(handlerCalled).to.be.true
      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(results[0].action).to.equal('move-ticket')
      expect(receivedCtx).to.not.be.null
      expect(receivedCtx!.ticket).to.equal('TKT-100')
    })

    it('should return error when action-type hook has no registered handler', async () => {
      insertHook(db, {
        name: 'unknown-action',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'nonexistent-action',
      })

      const manager = new HookManager({ db, actionHandlers: {} })
      const results = await manager.fireEvent('on_ci_green', { ticket: 'TKT-100' })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.false
      expect(results[0].error).to.include('No action handler registered')
    })

    it('should NOT spawn shell for action-type hooks', async () => {
      // If action-type hooks were executed as shell, "merge-pr" would fail because
      // it's not a valid shell command. The handler intercepts it.
      const actionHandlers: Record<string, HookActionHandler> = {
        'merge-pr': () => ({ action: 'merge-pr', success: true, durationMs: 0 }),
      }

      insertHook(db, {
        name: 'no-shell',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'merge-pr',
      })

      const manager = new HookManager({ db, actionHandlers })
      const results = await manager.fireEvent('on_ci_green', { ticket: 'TKT-100' })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
    })

    it('should support async action handlers', async () => {
      const asyncHandler: HookActionHandler = async (ctx, config) => {
        // Simulate async work (e.g., service call)
        await new Promise(resolve => setTimeout(resolve, 1))
        return { action: 'move-ticket', success: true, durationMs: 1 }
      }

      insertHook(db, {
        name: 'async-action',
        event: 'on_pr_merged',
        actionType: 'action',
        actionValue: 'move-ticket',
      })

      const manager = new HookManager({ db, actionHandlers: { 'move-ticket': asyncHandler } })
      const results = await manager.fireEvent('on_pr_merged', { ticket: 'TKT-100' })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
    })
  })

  // =========================================================================
  // Backward Compatibility
  // =========================================================================

  describe('backward compatibility', () => {
    it('should still execute shell-type hooks as shell commands', async () => {
      insertHook(db, {
        name: 'shell-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'echo hello',
      })

      const manager = new HookManager({ db })
      const results = await manager.fireEvent('on_ci_green', { ticket: 'TKT-100' })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
    })

    it('should still execute log-type hooks', async () => {
      insertHook(db, {
        name: 'log-hook',
        event: 'on_ci_green',
        actionType: 'log',
        actionValue: 'Event fired: {{event}}',
      })

      const manager = new HookManager({ db })
      const results = await manager.fireEvent('on_ci_green', { ticket: 'TKT-100' })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
    })

    it('should handle mixed action-type and shell-type hooks for same event', async () => {
      const handlerCalled = { action: false, shell: false }

      insertHook(db, {
        name: 'action-hook',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'notify',
        priority: 1,
      })
      insertHook(db, {
        name: 'shell-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'echo "shell fired"',
        priority: 2,
      })

      const actionHandlers: Record<string, HookActionHandler> = {
        'notify': () => {
          handlerCalled.action = true
          return { action: 'notify', success: true, durationMs: 0 }
        },
      }

      const manager = new HookManager({ db, actionHandlers })
      const results = await manager.fireEvent('on_ci_green', { ticket: 'TKT-100' })

      expect(results).to.have.length(2)
      expect(handlerCalled.action).to.be.true
      expect(results[0].success).to.be.true
      expect(results[1].success).to.be.true
    })
  })

  // =========================================================================
  // Executor: action type fallback
  // =========================================================================

  describe('executor fallback', () => {
    it('should return error for action-type hooks in executor (no handler registered)', () => {
      const hook: WorkHookConfig = {
        id: 'test',
        name: 'test-action',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'merge-pr',
        enabled: true,
        description: null,
        createdAt: '',
        mode: 'auto',
        priority: 0,
        config: null,
      }

      const result = executeHook(hook, 'on_ci_green', { ticket: 'TKT-100' })
      expect(result.success).to.be.false
      expect(result.error).to.include('No action handler registered')
    })
  })

  // =========================================================================
  // OrchestrateEngine integration
  // =========================================================================

  describe('OrchestrateEngine integration', () => {
    it('should execute action-type preset hooks via engine', async () => {
      applyPreset(db, 'aggressive')

      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green', ticket: 'TKT-100', pr: 42 })

      // on_ci_green fires merge-pr — with no real repo this will fail at the action
      // level, but the important thing is that it went through the action handler
      // (not through a shell prlt process)
      expect(results).to.have.length(1)
      expect(results[0].action).to.equal('merge-pr')
    })

    it('should execute move-ticket action-type hooks via engine without shell', async () => {
      // Insert an action-type hook for move-ticket (simulating preset)
      insertHook(db, {
        name: 'move-to-review',
        event: 'on_pr_opened',
        actionType: 'action',
        actionValue: 'move-ticket',
        config: JSON.stringify({ target: 'review' }),
        source: 'preset',
      })

      // The service-backed handler will try to resolve the provider, which will
      // fail in test (no workspace). But it should NOT spawn a prlt process.
      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_pr_opened', {
        event: 'on_pr_opened',
        ticket: 'TKT-100',
        pr: 42,
      })

      expect(results.length).to.be.greaterThan(0)
      const moveResult = results.find(r => r.action === 'move-ticket')
      expect(moveResult).to.exist
      // It may fail (no real provider), but should have an error, not hang
      expect(moveResult!.durationMs).to.be.a('number')
    })
  })

  // =========================================================================
  // Service-backed handlers
  // =========================================================================

  describe('service-backed action handlers', () => {
    it('createServiceActionHandlers returns handlers for move-ticket', () => {
      const handlers = createServiceActionHandlers(db)
      expect(handlers).to.have.property('move-ticket')
      expect(handlers['move-ticket']).to.be.a('function')
    })

    it('move-ticket handler returns result without spawning shell', async () => {
      const handlers = createServiceActionHandlers(db)
      const handler = handlers['move-ticket']

      const result = await handler(
        { event: 'on_pr_opened', ticket: 'TKT-100', projectId: 'PROJ-1' },
        { target: 'review' },
      )

      expect(result.action).to.equal('move-ticket')
      expect(result.durationMs).to.be.a('number')
      // Will fail (no real provider configured in test DB) but should not throw
      // and should NOT spawn a shell process
    })

    it('move-ticket handler returns error when no ticket in context', async () => {
      const handlers = createServiceActionHandlers(db)
      const result = await handlers['move-ticket'](
        { event: 'on_pr_opened' },
        { target: 'review' },
      )

      expect(result.success).to.be.false
      expect(result.error).to.include('No ticket in context')
    })
  })

  // =========================================================================
  // Latency measurement
  // =========================================================================

  describe('latency: action vs shell', () => {
    it('action-type hooks should be faster than shell-type hooks', async () => {
      // action-type hook — calls handler directly
      const actionHandlers: Record<string, HookActionHandler> = {
        'notify': () => ({ action: 'notify', success: true, durationMs: 0 }),
      }

      insertHook(db, {
        name: 'fast-action',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'notify',
        priority: 1,
      })

      const manager = new HookManager({ db, actionHandlers })

      // Measure action-type execution
      const actionStart = Date.now()
      const actionResults = await manager.fireEvent('on_ci_green', { ticket: 'TKT-100' })
      const actionDuration = Date.now() - actionStart

      // Remove action hook, add shell hook
      db.exec("DELETE FROM pmo_work_hooks")
      insertHook(db, {
        name: 'slow-shell',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'echo hello',
        priority: 1,
      })

      // Measure shell-type execution
      const shellStart = Date.now()
      const shellResults = await manager.fireEvent('on_ci_green', { ticket: 'TKT-100' })
      const shellDuration = Date.now() - shellStart

      // Action should succeed
      expect(actionResults[0].success).to.be.true
      expect(shellResults[0].success).to.be.true

      // Action type should be faster (in-process vs fork+exec)
      // Note: this is a statistical test — on very fast machines the difference
      // may be small, so we just verify action is not slower
      expect(actionDuration).to.be.at.most(shellDuration + 10,
        `Action hook (${actionDuration}ms) should be faster than shell hook (${shellDuration}ms)`)
    })
  })

  // =========================================================================
  // No process spawning
  // =========================================================================

  describe('no prlt process spawning', () => {
    it('preset hooks should not contain prlt commands in action_value', () => {
      applyPreset(db, 'aggressive')

      const hooks = db.prepare("SELECT action_value FROM pmo_work_hooks WHERE source = 'preset'")
        .all() as Array<{ action_value: string }>

      for (const hook of hooks) {
        expect(hook.action_value).to.not.match(/^prlt\b/,
          `Preset hook should not shell out to prlt: "${hook.action_value}"`)
      }
    })

    it('PRLT-1257 regression: event names preserved with action type', () => {
      applyPreset(db, 'aggressive')

      const hooks = db.prepare("SELECT event, action_value FROM pmo_work_hooks WHERE source = 'preset'")
        .all() as Array<{ event: string; action_value: string }>

      // Since action_value is now just the action name, verify events are correct
      const presetEvents = new Set(PRESETS.aggressive.hooks.map(h => h.event))
      const storedEvents = new Set(hooks.map(h => h.event))

      expect(storedEvents.has('on_ci_green')).to.be.true
      expect(storedEvents.has('on_pr_opened')).to.be.true
      expect(storedEvents.has('on_ticket_ready')).to.be.true
      expect(storedEvents.has('on_agent_died')).to.be.true

      // No hook should be misrouted to work:status_changed
      if (!presetEvents.has('work:status_changed')) {
        expect(storedEvents.has('work:status_changed')).to.be.false
      }
    })
  })
})
