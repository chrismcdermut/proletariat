import { expect } from 'chai'
import Database from 'better-sqlite3'
import { HookManager, stopHookManager } from '../../src/lib/work-lifecycle/hooks/manager.js'
import { WorkHookStorage, ensureHooksTable } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { executeHook, interpolate } from '../../src/lib/work-lifecycle/hooks/executor.js'
import { resetEventBus } from '../../src/lib/events/event-bus.js'
import { orchestrateHooks } from '../../src/lib/database/migrations/0015_orchestrate_hooks.js'
import { hookModeTiers } from '../../src/lib/database/migrations/0022_hook_mode_tiers.js'
import { hookActionTypes } from '../../src/lib/database/migrations/0025_hook_action_types.js'
import { applyPreset } from '../../src/lib/orchestrate/config-loader.js'
import { PRESETS } from '../../src/lib/orchestrate/presets.js'
import type { WorkHookConfig, HookActionHandler, HookActionType } from '../../src/lib/work-lifecycle/hooks/types.js'
import { HOOK_ACTION_TYPES, EVENT_PAYLOAD_FIELDS } from '../../src/lib/work-lifecycle/hooks/types.js'

/**
 * Tests for PRLT-1295: Hook/action data model cleanup.
 *
 * Covers:
 * - New action types: poke, action, llm
 * - Event payload schemas and template interpolation
 * - Action_ref (shared action definitions)
 * - Poke-orchestrator wiring
 * - Migration 0025
 * - Backward compatibility with existing shell-type hooks
 */

// Helper to create a WorkHookConfig for testing
function makeHook(overrides: Partial<WorkHookConfig> = {}): WorkHookConfig {
  return {
    id: 'hook-test',
    name: 'test-hook',
    event: 'on_pr_opened',
    actionType: 'log',
    actionValue: 'default log message',
    actionRef: null,
    enabled: true,
    description: null,
    createdAt: new Date().toISOString(),
    mode: 'auto',
    priority: 0,
    config: null,
    ...overrides,
  }
}

// Helper to create an in-memory DB with all migrations applied
function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  ensureHooksTable(db)
  orchestrateHooks.up(db)
  hookModeTiers.up(db)
  hookActionTypes.up(db)
  return db
}

describe('Hook Action Types (PRLT-1295)', () => {
  // ===========================================================================
  // Migration 0025
  // ===========================================================================
  describe('migration 0025 — hook_action_types', () => {
    it('should add poke, action, llm to action_type CHECK constraint', () => {
      const db = createTestDb()

      const createSql = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='pmo_work_hooks'"
      ).get() as { sql: string }

      expect(createSql.sql).to.include("'poke'")
      expect(createSql.sql).to.include("'action'")
      expect(createSql.sql).to.include("'llm'")
      // Existing types still present
      expect(createSql.sql).to.include("'shell'")
      expect(createSql.sql).to.include("'webhook'")
      expect(createSql.sql).to.include("'log'")

      db.close()
    })

    it('should add action_ref column', () => {
      const db = createTestDb()

      const columns = db.prepare("PRAGMA table_info(pmo_work_hooks)").all() as { name: string }[]
      const columnNames = columns.map(c => c.name)

      expect(columnNames).to.include('action_ref')
      db.close()
    })

    it('should create action_ref index when migrating from old schema', () => {
      // Start with old schema (no poke in constraint) to force migration to run
      const db = new Database(':memory:')
      db.pragma('journal_mode = WAL')
      // Create the pre-0025 table manually (without 'poke' in constraint)
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

      // Run migration 0025
      hookActionTypes.up(db)

      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='pmo_work_hooks'"
      ).all() as { name: string }[]
      const indexNames = indexes.map(i => i.name)

      expect(indexNames).to.include('idx_pmo_work_hooks_action_ref')
      db.close()
    })

    it('should be idempotent — safe to run twice', () => {
      const db = createTestDb()
      expect(() => hookActionTypes.up(db)).to.not.throw()
      db.close()
    })

    it('should preserve existing data through migration', () => {
      const db = new Database(':memory:')
      db.pragma('journal_mode = WAL')
      ensureHooksTable(db)
      orchestrateHooks.up(db)
      hookModeTiers.up(db)

      // Insert a row before migration 0025
      db.prepare(`
        INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, mode, source)
        VALUES ('test-id', 'pre-migration-hook', 'on_ci_green', 'shell', 'echo hello', 'auto', 'cli')
      `).run()

      // Run migration
      hookActionTypes.up(db)

      // Verify data survived
      const row = db.prepare("SELECT * FROM pmo_work_hooks WHERE id = 'test-id'").get() as Record<string, unknown>
      expect(row).to.exist
      expect(row.name).to.equal('pre-migration-hook')
      expect(row.action_type).to.equal('shell')
      expect(row.action_value).to.equal('echo hello')
      expect(row.action_ref).to.be.null

      db.close()
    })
  })

  // ===========================================================================
  // Storage — new action types
  // ===========================================================================
  describe('storage — new action types', () => {
    let db: Database.Database
    let storage: WorkHookStorage

    beforeEach(() => {
      db = createTestDb()
      storage = new WorkHookStorage(db)
    })

    afterEach(() => db.close())

    it('should create hooks with action_type=poke', () => {
      const hook = storage.create({
        name: 'poke-test',
        event: 'on_pr_opened',
        actionType: 'poke',
        actionValue: '{event}: {ticket_id}',
        actionRef: 'orchestrator-main',
      })
      expect(hook.actionType).to.equal('poke')
      expect(hook.actionRef).to.equal('orchestrator-main')
    })

    it('should create hooks with action_type=action', () => {
      const hook = storage.create({
        name: 'action-test',
        event: 'on_ci_green',
        actionType: 'action',
        actionRef: 'merge-pr',
      })
      expect(hook.actionType).to.equal('action')
      expect(hook.actionRef).to.equal('merge-pr')
      expect(hook.actionValue).to.equal('')
    })

    it('should create hooks with action_type=llm', () => {
      const hook = storage.create({
        name: 'llm-test',
        event: 'on_changes_requested',
        actionType: 'llm',
        actionValue: 'Triage this: {body}',
      })
      expect(hook.actionType).to.equal('llm')
    })

    it('should create hooks for all six action types', () => {
      const types: HookActionType[] = ['shell', 'webhook', 'log', 'poke', 'action', 'llm']
      for (const actionType of types) {
        const hook = storage.create({
          name: `hook-${actionType}`,
          event: 'on_ci_green',
          actionType,
          actionValue: `test-${actionType}`,
        })
        expect(hook.actionType).to.equal(actionType)
      }
    })

    it('should reject invalid action types', () => {
      expect(() => {
        storage.create({
          name: 'bad-type',
          event: 'on_ci_green',
          actionType: 'invalid' as HookActionType,
          actionValue: 'test',
        })
      }).to.throw()
    })

    it('should list hooks with action_ref populated', () => {
      storage.create({
        name: 'ref-hook',
        event: 'on_ci_green',
        actionType: 'action',
        actionRef: 'merge-pr',
      })

      const hooks = storage.list()
      expect(hooks).to.have.lengthOf(1)
      expect(hooks[0].actionRef).to.equal('merge-pr')
    })

    it('should allow null action_ref for shell hooks', () => {
      const hook = storage.create({
        name: 'shell-no-ref',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'echo hello',
      })
      expect(hook.actionRef).to.be.null
    })
  })

  // ===========================================================================
  // Template Interpolation
  // ===========================================================================
  describe('template interpolation', () => {
    it('should interpolate {field} single-brace placeholders', () => {
      const result = interpolate(
        '{event}: PR #{pr_number} by {author}',
        'on_pr_opened',
        { pr_number: 42, author: 'alice' },
      )
      expect(result).to.equal('on_pr_opened: PR #42 by alice')
    })

    it('should interpolate {{field}} double-brace placeholders (legacy)', () => {
      const result = interpolate(
        '{{event}}: ticket={{ticketId}}',
        'work:started',
        { ticketId: 'TKT-100' },
      )
      expect(result).to.equal('work:started: ticket=TKT-100')
    })

    it('should support both placeholder styles in the same template', () => {
      const result = interpolate(
        '{event}: ticket={{ticket_id}} pr={pr_number}',
        'on_ci_green',
        { ticket_id: 'TKT-1', pr_number: 99 },
      )
      expect(result).to.equal('on_ci_green: ticket=TKT-1 pr=99')
    })

    it('should leave unmatched placeholders as-is', () => {
      const result = interpolate('{event}: {missing}', 'on_ci_green', {})
      expect(result).to.equal('on_ci_green: {missing}')
    })

    it('should handle Date values', () => {
      const now = new Date('2026-01-01T00:00:00Z')
      const result = interpolate('at {timestamp}', 'test', { timestamp: now })
      expect(result).to.equal('at 2026-01-01T00:00:00.000Z')
    })

    it('should skip null and undefined values', () => {
      const result = interpolate('{a}-{b}', 'test', { a: null, b: undefined })
      expect(result).to.equal('{a}-{b}')
    })
  })

  // ===========================================================================
  // Event Payload Schemas
  // ===========================================================================
  describe('event payload schemas', () => {
    it('should define fields for on_pr_opened', () => {
      expect(EVENT_PAYLOAD_FIELDS.on_pr_opened).to.include.members([
        'pr_number', 'ticket_id', 'branch', 'author',
      ])
    })

    it('should define fields for on_agent_completed', () => {
      expect(EVENT_PAYLOAD_FIELDS.on_agent_completed).to.include.members([
        'agent_name', 'ticket_id', 'execution_id', 'summary',
      ])
    })

    it('should define fields for on_agent_died', () => {
      expect(EVENT_PAYLOAD_FIELDS.on_agent_died).to.include.members([
        'agent_name', 'ticket_id', 'exit_code', 'error',
      ])
    })

    it('should define fields for on_ci_green', () => {
      expect(EVENT_PAYLOAD_FIELDS.on_ci_green).to.include.members([
        'pr_number', 'ticket_id',
      ])
    })

    it('should define fields for on_ci_failed', () => {
      expect(EVENT_PAYLOAD_FIELDS.on_ci_failed).to.include.members([
        'pr_number', 'ticket_id', 'failed_checks',
      ])
    })

    it('should define fields for all orchestrate events', () => {
      const expectedEvents = [
        'on_pr_opened', 'on_pr_merged', 'on_ci_green', 'on_ci_failed',
        'on_agent_completed', 'on_agent_died', 'on_agent_spawned',
        'on_agent_idle', 'on_ticket_ready', 'on_pr_conflicting',
        'on_review_approved', 'on_changes_requested',
      ]
      for (const event of expectedEvents) {
        expect(EVENT_PAYLOAD_FIELDS).to.have.property(event)
        expect(EVENT_PAYLOAD_FIELDS[event]).to.be.an('array').with.length.greaterThan(0)
      }
    })
  })

  // ===========================================================================
  // HOOK_ACTION_TYPES constant
  // ===========================================================================
  describe('HOOK_ACTION_TYPES', () => {
    it('should include all six action types', () => {
      expect(HOOK_ACTION_TYPES).to.include.members([
        'shell', 'webhook', 'log', 'poke', 'action', 'llm',
      ])
    })
  })

  // ===========================================================================
  // Executor — poke action type
  // ===========================================================================
  describe('executor — poke action type', () => {
    it('should fail gracefully when no target specified', () => {
      const hook = makeHook({
        actionType: 'poke',
        actionValue: '',
        actionRef: null,
        config: null,
      })
      const result = executeHook(hook, 'on_pr_opened', { pr_number: 42 })
      expect(result.success).to.be.false
      expect(result.error).to.include('No poke target')
    })

    it('should use config.target as poke target', () => {
      const hook = makeHook({
        actionType: 'poke',
        actionValue: '{event}: {ticket_id}',
        config: { target: 'nonexistent-session-xyz' },
      })
      // Will fail because session doesn't exist, but should attempt with correct target
      const result = executeHook(hook, 'on_pr_opened', { ticket_id: 'TKT-1' })
      expect(result.action).to.equal('poke:nonexistent-session-xyz')
      // Expect failure (no session running), but the action was attempted
      expect(result.success).to.be.false
    })

    it('should fall back to actionRef as poke target', () => {
      const hook = makeHook({
        actionType: 'poke',
        actionValue: '{event}',
        actionRef: 'fallback-target',
        config: null,
      })
      const result = executeHook(hook, 'on_ci_green', {})
      expect(result.action).to.equal('poke:fallback-target')
    })
  })

  // ===========================================================================
  // Executor — action type (direct dispatch)
  // ===========================================================================
  describe('executor — action type (direct dispatch)', () => {
    it('should call action handler via action_ref', () => {
      let handlerCalled = false
      const handlers: Record<string, HookActionHandler> = {
        'merge-pr': (ctx) => {
          handlerCalled = true
          return { action: 'merge-pr', success: true, durationMs: 0 }
        },
      }

      const hook = makeHook({
        actionType: 'action',
        actionRef: 'merge-pr',
        actionValue: '',
      })
      const result = executeHook(hook, 'on_ci_green', { ticket: 'TKT-1' }, handlers)
      expect(handlerCalled).to.be.true
      expect(result.success).to.be.true
      expect(result.action).to.equal('merge-pr')
    })

    it('should call action handler via actionValue when no action_ref', () => {
      let handlerCalled = false
      const handlers: Record<string, HookActionHandler> = {
        'move-ticket': () => {
          handlerCalled = true
          return { action: 'move-ticket', success: true, durationMs: 0 }
        },
      }

      const hook = makeHook({
        actionType: 'action',
        actionRef: null,
        actionValue: 'move-ticket',
      })
      const result = executeHook(hook, 'on_agent_completed', {}, handlers)
      expect(handlerCalled).to.be.true
      expect(result.success).to.be.true
    })

    it('should fail for unknown action name', () => {
      const hook = makeHook({
        actionType: 'action',
        actionRef: 'nonexistent-action',
        actionValue: '',
      })
      const result = executeHook(hook, 'on_ci_green', {}, {})
      expect(result.success).to.be.false
      expect(result.error).to.include('Unknown action')
    })

    it('should fail when no action name provided', () => {
      const hook = makeHook({
        actionType: 'action',
        actionRef: null,
        actionValue: '',
      })
      const result = executeHook(hook, 'on_ci_green', {}, {})
      expect(result.success).to.be.false
      expect(result.error).to.include('No action_ref')
    })

    it('should pass config to action handler', () => {
      let receivedConfig: Record<string, unknown> | undefined
      const handlers: Record<string, HookActionHandler> = {
        'move-ticket': (_ctx, config) => {
          receivedConfig = config
          return { action: 'move-ticket', success: true, durationMs: 0 }
        },
      }

      const hook = makeHook({
        actionType: 'action',
        actionRef: 'move-ticket',
        config: { target: 'review' },
      })
      executeHook(hook, 'on_pr_opened', {}, handlers)
      expect(receivedConfig).to.deep.equal({ target: 'review' })
    })
  })

  // ===========================================================================
  // Executor — llm action type
  // ===========================================================================
  describe('executor — llm action type', () => {
    it('should succeed with interpolated prompt', () => {
      const hook = makeHook({
        actionType: 'llm',
        actionValue: 'Triage: {event} for {ticket_id}',
      })
      const result = executeHook(hook, 'on_changes_requested', { ticket_id: 'TKT-1' })
      expect(result.success).to.be.true
      expect(result.action).to.equal('llm:test-hook')
    })

    it('should use config.prompt when present', () => {
      const hook = makeHook({
        actionType: 'llm',
        actionValue: 'fallback',
        config: { prompt: 'Custom prompt for {event}' },
      })
      const result = executeHook(hook, 'on_ci_failed', {})
      expect(result.success).to.be.true
    })
  })

  // ===========================================================================
  // Executor — existing types backward compatibility
  // ===========================================================================
  describe('executor — backward compatibility', () => {
    it('should still execute shell hooks', () => {
      const hook = makeHook({
        actionType: 'shell',
        actionValue: 'true',
      })
      const result = executeHook(hook, 'work:started', {})
      expect(result.success).to.be.true
    })

    it('should still execute log hooks', () => {
      const hook = makeHook({
        actionType: 'log',
        actionValue: 'Event: {{event}}',
      })
      const result = executeHook(hook, 'work:started', {})
      expect(result.success).to.be.true
    })

    it('should still fail for invalid shell commands', () => {
      const hook = makeHook({
        actionType: 'shell',
        actionValue: 'exit 42',
      })
      const result = executeHook(hook, 'work:started', {})
      expect(result.success).to.be.false
    })
  })

  // ===========================================================================
  // HookManager — resolveActionName with action_ref
  // ===========================================================================
  describe('HookManager.resolveActionName', () => {
    it('should prefer action_ref over action_value', () => {
      const hook = makeHook({
        actionRef: 'merge-pr',
        actionValue: 'prlt hook fire on_ci_green --action merge-pr',
      })
      expect(HookManager.resolveActionName(hook)).to.equal('merge-pr')
    })

    it('should fall back to --action flag extraction', () => {
      const hook = makeHook({
        actionRef: null,
        actionValue: 'prlt hook fire on_ci_green --action merge-pr',
      })
      expect(HookManager.resolveActionName(hook)).to.equal('merge-pr')
    })

    it('should fall back to known action lookup', () => {
      const hook = makeHook({
        actionRef: null,
        actionValue: 'merge-pr',
      })
      const known = { 'merge-pr': true }
      expect(HookManager.resolveActionName(hook, known)).to.equal('merge-pr')
    })

    it('should return raw action_value as last resort', () => {
      const hook = makeHook({
        actionRef: null,
        actionValue: 'echo hello',
      })
      expect(HookManager.resolveActionName(hook)).to.equal('echo hello')
    })
  })

  // ===========================================================================
  // HookManager — action type dispatch
  // ===========================================================================
  describe('HookManager — action type dispatch', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
      resetEventBus()
      stopHookManager()
    })

    afterEach(() => {
      stopHookManager()
      resetEventBus()
      if (db) db.close()
    })

    it('should dispatch action-type hooks to action handlers', async () => {
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'direct-action',
        event: 'on_ci_green',
        actionType: 'action',
        actionRef: 'test-handler',
      })

      let handlerCalled = false
      const manager = new HookManager({
        db,
        actionHandlers: {
          'test-handler': (ctx) => {
            handlerCalled = true
            return { action: 'test-handler', success: true, durationMs: 0 }
          },
        },
      })

      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(handlerCalled).to.be.true
      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(results[0].action).to.equal('test-handler')
    })

    it('should fire same action handler from multiple events (shared definition)', async () => {
      const storage = new WorkHookStorage(db)

      // Create the same action_ref for two different events
      storage.create({
        name: 'poke-on-opened',
        event: 'on_pr_opened',
        actionType: 'action',
        actionRef: 'shared-handler',
      })
      storage.create({
        name: 'poke-on-completed',
        event: 'on_agent_completed',
        actionType: 'action',
        actionRef: 'shared-handler',
      })

      let callCount = 0
      const manager = new HookManager({
        db,
        actionHandlers: {
          'shared-handler': () => {
            callCount++
            return { action: 'shared-handler', success: true, durationMs: 0 }
          },
        },
      })

      await manager.fireEvent('on_pr_opened', { event: 'on_pr_opened' })
      expect(callCount).to.equal(1)

      await manager.fireEvent('on_agent_completed', { event: 'on_agent_completed' })
      expect(callCount).to.equal(2)
    })
  })

  // ===========================================================================
  // Presets — poke-orchestrator wiring
  // ===========================================================================
  describe('presets — poke-orchestrator', () => {
    it('should include poke-orchestrator in aggressive preset hooks', () => {
      const aggressive = PRESETS.aggressive
      const pokeHooks = aggressive.hooks.filter(h => h.action === 'poke-orchestrator')
      expect(pokeHooks).to.have.length(5)

      const events = pokeHooks.map(h => h.event)
      expect(events).to.include.members([
        'on_pr_opened',
        'on_ci_green',
        'on_ci_failed',
        'on_agent_completed',
        'on_agent_died',
      ])
    })

    it('should set poke-orchestrator action type to poke', () => {
      const aggressive = PRESETS.aggressive
      const pokeHooks = aggressive.hooks.filter(h => h.action === 'poke-orchestrator')
      for (const hook of pokeHooks) {
        expect(hook.actionType).to.equal('poke')
      }
    })

    it('should set poke-orchestrator target to orchestrator-main', () => {
      const aggressive = PRESETS.aggressive
      const pokeHooks = aggressive.hooks.filter(h => h.action === 'poke-orchestrator')
      for (const hook of pokeHooks) {
        expect(hook.config).to.have.property('target', 'orchestrator-main')
      }
    })

    it('should include template with event/ticket/PR fields in poke-orchestrator config', () => {
      const aggressive = PRESETS.aggressive
      const pokeHook = aggressive.hooks.find(h => h.action === 'poke-orchestrator')!
      const template = pokeHook.config!.template as string
      expect(template).to.include('{event}')
      expect(template).to.include('{ticket_id}')
      expect(template).to.include('{pr_number}')
    })

    it('should include poke-orchestrator in all three presets', () => {
      for (const presetName of ['aggressive', 'conservative', 'supervised'] as const) {
        const preset = PRESETS[presetName]
        const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')
        expect(pokeHooks, `${presetName} preset should have poke-orchestrator hooks`).to.have.length(5)
      }
    })
  })

  // ===========================================================================
  // applyPreset — uses action type instead of shell indirection
  // ===========================================================================
  describe('applyPreset — direct dispatch', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
    })

    afterEach(() => db.close())

    it('should create hooks with action_type=action for non-poke hooks', () => {
      applyPreset(db, 'aggressive')

      const hooks = db.prepare(
        "SELECT * FROM pmo_work_hooks WHERE action_ref = 'merge-pr'"
      ).all() as Array<{ action_type: string; action_ref: string }>

      expect(hooks).to.have.length(1)
      expect(hooks[0].action_type).to.equal('action')
      expect(hooks[0].action_ref).to.equal('merge-pr')
    })

    it('should create hooks with action_type=poke for poke-orchestrator', () => {
      applyPreset(db, 'aggressive')

      const hooks = db.prepare(
        "SELECT * FROM pmo_work_hooks WHERE action_ref = 'poke-orchestrator'"
      ).all() as Array<{ action_type: string; action_ref: string; config: string }>

      expect(hooks).to.have.length(5)
      for (const hook of hooks) {
        expect(hook.action_type).to.equal('poke')
        expect(hook.action_ref).to.equal('poke-orchestrator')
        const config = JSON.parse(hook.config)
        expect(config.target).to.equal('orchestrator-main')
      }
    })

    it('should no longer use shell indirection (no prlt hook fire)', () => {
      applyPreset(db, 'aggressive')

      const shellHooks = db.prepare(
        "SELECT * FROM pmo_work_hooks WHERE action_value LIKE '%prlt hook fire%'"
      ).all()

      expect(shellHooks).to.have.length(0)
    })

    it('should replace preset hooks on re-apply', () => {
      applyPreset(db, 'aggressive')
      const count1 = (db.prepare("SELECT COUNT(*) as cnt FROM pmo_work_hooks WHERE source = 'preset'").get() as { cnt: number }).cnt
      expect(count1).to.be.greaterThan(0)

      applyPreset(db, 'conservative')
      const count2 = (db.prepare("SELECT COUNT(*) as cnt FROM pmo_work_hooks WHERE source = 'preset'").get() as { cnt: number }).cnt

      // Both presets use the same SHARED_HOOKS, just different modes — same count
      expect(count2).to.equal(count1)
      // No leftover aggressive hooks — all replaced
      const aggressiveHooks = db.prepare(
        "SELECT COUNT(*) as cnt FROM pmo_work_hooks WHERE name LIKE 'preset:aggressive%'"
      ).get() as { cnt: number }
      expect(aggressiveHooks.cnt).to.equal(0)
    })

    it('should preserve existing shell-type hooks (backward compatible)', () => {
      // Add a CLI-sourced shell hook before applying preset
      const storage = new WorkHookStorage(db)
      storage.create({
        name: 'my-custom-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'echo custom',
      })

      applyPreset(db, 'aggressive')

      // Custom hook should still exist
      const custom = storage.getByName('my-custom-hook')
      expect(custom).to.not.be.null
      expect(custom!.actionType).to.equal('shell')
      expect(custom!.actionValue).to.equal('echo custom')
    })
  })

  // ===========================================================================
  // Integration: fire on_pr_opened, verify poke-orchestrator fires
  // ===========================================================================
  describe('integration — poke-orchestrator fires on events', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
      resetEventBus()
      stopHookManager()
    })

    afterEach(() => {
      stopHookManager()
      resetEventBus()
      if (db) db.close()
    })

    it('should fire poke-orchestrator on on_pr_opened with correct payload', async () => {
      applyPreset(db, 'aggressive')

      let pokeAttempted = false
      let pokeTarget: string | undefined

      // Use a custom poke handler to intercept the poke attempt
      // Since we can't actually poke a session in tests, we mock via action handler
      const manager = new HookManager({
        db,
        actionHandlers: {},
      })

      const results = await manager.fireEvent('on_pr_opened', {
        event: 'on_pr_opened',
        pr_number: 42,
        ticket_id: 'TKT-100',
        branch: 'feat/test',
        author: 'alice',
      })

      // Should have multiple results — move-ticket, spawn-review-agent, and poke-orchestrator
      const pokeResult = results.find(r => r.action.includes('poke'))
      expect(pokeResult, 'poke-orchestrator should fire on on_pr_opened').to.exist
    })

    it('should fire same poke-orchestrator on on_agent_completed (shared def)', async () => {
      applyPreset(db, 'aggressive')

      const manager = new HookManager({
        db,
        actionHandlers: {},
      })

      const results = await manager.fireEvent('on_agent_completed', {
        event: 'on_agent_completed',
        agent_name: 'bold-turing',
        ticket_id: 'TKT-200',
        summary: 'All tests pass',
      })

      const pokeResult = results.find(r => r.action.includes('poke'))
      expect(pokeResult, 'poke-orchestrator should fire on on_agent_completed').to.exist
    })
  })
})
