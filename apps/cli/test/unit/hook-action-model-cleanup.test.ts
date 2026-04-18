import { expect } from 'chai'
import Database from 'better-sqlite3'
import { ensureHooksTable, WorkHookStorage } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { HookManager } from '../../src/lib/work-lifecycle/hooks/manager.js'
import { executeHook } from '../../src/lib/work-lifecycle/hooks/executor.js'
import {
  interpolateTemplate,
  EVENT_PAYLOAD_FIELDS,
} from '../../src/lib/work-lifecycle/hooks/types.js'
import type {
  WorkHookConfig,
  HookActionHandler,
  AsyncHookActionHandler,
} from '../../src/lib/work-lifecycle/hooks/types.js'
import { applyPreset } from '../../src/lib/orchestrate/config-loader.js'
import { PRESETS } from '../../src/lib/orchestrate/presets.js'
import { createServiceActionHandlers, SERVICE_BACKED_ACTIONS } from '../../src/lib/orchestrate/service-actions.js'
import { hookActionTypesExpand } from '../../src/lib/database/migrations/0027_hook_action_types_expand.js'
import { resetEventBus } from '../../src/lib/events/event-bus.js'

/**
 * Tests for PRLT-1295: Clean up hook/action data model.
 *
 * Covers:
 * - New action types: poke, llm (alongside existing shell, webhook, log, action)
 * - Event payload schemas and template interpolation
 * - action_ref for shared action definitions
 * - poke-orchestrator wired to multiple events
 * - Migration 0027: CHECK constraint expansion + action_ref column
 * - Backward compatibility with existing hooks
 */

// =============================================================================
// Helpers
// =============================================================================

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  // Create the table with the expanded CHECK constraint directly
  db.exec(`
    CREATE TABLE pmo_work_hooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      event TEXT NOT NULL,
      action_type TEXT NOT NULL DEFAULT 'shell' CHECK (action_type IN ('shell', 'webhook', 'log', 'action', 'poke', 'llm')),
      action_value TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'confirm', 'notify', 'llm', 'human', 'off')),
      priority INTEGER NOT NULL DEFAULT 0,
      project_id TEXT,
      source TEXT NOT NULL DEFAULT 'cli' CHECK (source IN ('yaml', 'cli', 'preset')),
      config TEXT,
      action_ref TEXT
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_event ON pmo_work_hooks(event)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_enabled ON pmo_work_hooks(enabled)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_priority ON pmo_work_hooks(event, priority)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_action_ref ON pmo_work_hooks(action_ref)')
  return db
}

/**
 * Create a pre-migration DB (has 'action' in CHECK but NOT 'poke'/'llm', no action_ref).
 */
function createPreMigrationDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE pmo_work_hooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      event TEXT NOT NULL,
      action_type TEXT NOT NULL DEFAULT 'shell' CHECK (action_type IN ('shell', 'webhook', 'log', 'action')),
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
  actionRef?: string
}): string {
  const id = `hook-${Math.random().toString(36).slice(2, 8)}`
  db.prepare(`
    INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, mode, priority, source, config, action_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    opts.actionRef ?? null,
  )
  return id
}

// =============================================================================
// Tests
// =============================================================================

describe('Hook/Action Data Model Cleanup (PRLT-1295)', () => {
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
  // 1. Expanded action_type support
  // ===========================================================================

  describe('action_type supports shell, poke, action, webhook, llm', () => {
    it('should insert and read hooks with action_type="poke"', () => {
      insertHook(db, {
        name: 'poke-hook',
        event: 'on_pr_opened',
        actionType: 'poke',
        actionValue: 'poke-orchestrator',
        config: JSON.stringify({ target: 'orchestrator-main', template: '{event}: {ticket_id}' }),
      })

      const row = db.prepare('SELECT action_type, action_value FROM pmo_work_hooks WHERE name = ?').get('poke-hook') as { action_type: string; action_value: string }
      expect(row.action_type).to.equal('poke')
      expect(row.action_value).to.equal('poke-orchestrator')
    })

    it('should insert and read hooks with action_type="llm"', () => {
      insertHook(db, {
        name: 'llm-hook',
        event: 'on_changes_requested',
        actionType: 'llm',
        actionValue: 'triage-comment',
        config: JSON.stringify({ prompt: 'Triage this event: {body}' }),
      })

      const row = db.prepare('SELECT action_type, action_value FROM pmo_work_hooks WHERE name = ?').get('llm-hook') as { action_type: string; action_value: string }
      expect(row.action_type).to.equal('llm')
      expect(row.action_value).to.equal('triage-comment')
    })

    it('should still allow all existing action types', () => {
      for (const actionType of ['shell', 'webhook', 'log', 'action']) {
        insertHook(db, {
          name: `test-${actionType}`,
          event: 'on_ci_green',
          actionType,
          actionValue: `test-${actionType}`,
        })
      }
      const count = db.prepare('SELECT COUNT(*) as cnt FROM pmo_work_hooks').get() as { cnt: number }
      expect(count.cnt).to.equal(4)
    })
  })

  // ===========================================================================
  // 2. Poke type sends message without shelling out
  // ===========================================================================

  describe('poke type routes through service action handlers', () => {
    it('should route poke-type hooks to service action handlers', async () => {
      let handlerCalled = false
      let receivedCtx: Record<string, unknown> | null = null
      let receivedConfig: Record<string, unknown> | undefined

      const serviceHandlers: Record<string, AsyncHookActionHandler> = {
        'poke-orchestrator': async (ctx, config) => {
          handlerCalled = true
          receivedCtx = ctx
          receivedConfig = config
          return { action: 'poke-orchestrator', success: true, durationMs: 1 }
        },
      }

      insertHook(db, {
        name: 'poke-test',
        event: 'on_pr_opened',
        actionType: 'poke',
        actionValue: 'poke-orchestrator',
        config: JSON.stringify({ target: 'orchestrator-main', template: '{event}: {ticket_id}' }),
      })

      const manager = new HookManager({
        db,
        serviceActionHandlers: serviceHandlers,
      })
      const results = await manager.fireEvent('on_pr_opened', { ticketId: 'TKT-1', prNumber: 42 })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(results[0].action).to.equal('poke-orchestrator')
      expect(handlerCalled).to.be.true
      expect(receivedConfig).to.deep.equal({ target: 'orchestrator-main', template: '{event}: {ticket_id}' })
    })

    it('executor should reject poke-type hooks (must go through handlers)', () => {
      const hook: WorkHookConfig = {
        id: 'test-1',
        name: 'poke-hook',
        event: 'on_pr_opened',
        actionType: 'poke',
        actionValue: 'poke-orchestrator',
        enabled: true,
        description: null,
        createdAt: new Date().toISOString(),
        mode: 'auto',
        priority: 0,
        config: null,
        actionRef: null,
      }
      const result = executeHook(hook, 'on_pr_opened', {})
      expect(result.success).to.be.false
      expect(result.error).to.include('poke-type hooks must be routed through built-in action handlers')
    })
  })

  // ===========================================================================
  // 3. Action type resolves named pmo_action directly
  // ===========================================================================

  describe('action type direct dispatch', () => {
    it('should resolve action name from actionValue for action-type hooks', () => {
      const hook: WorkHookConfig = {
        id: 'test-1',
        name: 'action-hook',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'merge-pr',
        enabled: true,
        description: null,
        createdAt: new Date().toISOString(),
        mode: 'auto',
        priority: 0,
        config: null,
        actionRef: null,
      }
      const result = HookManager.resolveActionName(hook, {})
      expect(result).to.equal('merge-pr')
    })

    it('should route action-type hooks to service handlers (no shell)', async () => {
      let handlerCalled = false
      const serviceHandlers: Record<string, AsyncHookActionHandler> = {
        'move-ticket': async () => {
          handlerCalled = true
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

      const manager = new HookManager({ db, serviceActionHandlers: serviceHandlers })
      const results = await manager.fireEvent('on_pr_merged', { ticketId: 'TKT-1' })
      expect(handlerCalled).to.be.true
      expect(results[0].success).to.be.true
    })
  })

  // ===========================================================================
  // 4. Event payloads are typed and documented
  // ===========================================================================

  describe('event payload schemas', () => {
    it('should have payload fields defined for all key events', () => {
      const expectedEvents = [
        'on_pr_opened', 'on_pr_merged', 'on_ci_green', 'on_ci_failed',
        'on_agent_completed', 'on_agent_died', 'on_pr_comment',
        'on_ticket_ready', 'on_agent_spawned', 'on_review_approved',
        'on_changes_requested',
      ]
      for (const event of expectedEvents) {
        expect(EVENT_PAYLOAD_FIELDS[event]).to.be.an('array').with.length.greaterThan(0)
      }
    })

    it('on_pr_opened should have pr_number, ticket_id, branch, author, repo', () => {
      expect(EVENT_PAYLOAD_FIELDS['on_pr_opened']).to.include.members([
        'pr_number', 'ticket_id', 'branch', 'author', 'repo',
      ])
    })

    it('on_agent_completed should have agent_name, ticket_id, execution_id, summary', () => {
      expect(EVENT_PAYLOAD_FIELDS['on_agent_completed']).to.include.members([
        'agent_name', 'ticket_id', 'execution_id', 'summary',
      ])
    })

    it('on_agent_died should have agent_name, ticket_id, exit_code, error', () => {
      expect(EVENT_PAYLOAD_FIELDS['on_agent_died']).to.include.members([
        'agent_name', 'ticket_id', 'exit_code', 'error',
      ])
    })
  })

  // ===========================================================================
  // 5. Action templates can reference payload fields
  // ===========================================================================

  describe('template interpolation', () => {
    it('should interpolate {ticket_id}, {pr_number}, {author}', () => {
      const template = 'PR #{pr_number} opened for {ticket_id} by {author}'
      const payload = { pr_number: 42, ticket_id: 'TKT-123', author: 'alice' }
      const result = interpolateTemplate(template, payload)
      expect(result).to.equal('PR #42 opened for TKT-123 by alice')
    })

    it('should leave unresolved fields as-is', () => {
      const template = '{event}: {ticket_id} — {unknown_field}'
      const payload = { event: 'on_ci_green', ticket_id: 'TKT-1' }
      const result = interpolateTemplate(template, payload)
      expect(result).to.equal('on_ci_green: TKT-1 — {unknown_field}')
    })

    it('should handle missing payload values', () => {
      const template = '{event}: {ticket_id}'
      const payload = { event: 'on_ci_green' }
      const result = interpolateTemplate(template, payload)
      expect(result).to.equal('on_ci_green: {ticket_id}')
    })

    it('should fall back to context for field resolution', () => {
      const template = '{event}: ticket={ticket}'
      const payload = { event: 'on_ci_green' }
      const ctx = { ticket: 'TKT-99' }
      const result = interpolateTemplate(template, payload, ctx)
      expect(result).to.equal('on_ci_green: ticket=TKT-99')
    })

    it('should handle Date objects in payload', () => {
      const template = 'Created at {created_at}'
      const date = new Date('2026-01-15T10:00:00Z')
      const payload = { created_at: date }
      const result = interpolateTemplate(template, payload)
      expect(result).to.equal('Created at 2026-01-15T10:00:00.000Z')
    })

    it('should handle array/object values as JSON', () => {
      const template = 'Failed: {failed_checks}'
      const payload = { failed_checks: ['lint', 'test'] }
      const result = interpolateTemplate(template, payload)
      expect(result).to.equal('Failed: ["lint","test"]')
    })
  })

  // ===========================================================================
  // 6. Multiple events reference same action definition (action_ref)
  // ===========================================================================

  describe('action_ref for shared action definitions', () => {
    it('should use action_ref to resolve action name when set', () => {
      const hook: WorkHookConfig = {
        id: 'test-ref',
        name: 'poke-on-pr',
        event: 'on_pr_opened',
        actionType: 'action',
        actionValue: '',
        enabled: true,
        description: null,
        createdAt: new Date().toISOString(),
        mode: 'auto',
        priority: 0,
        config: null,
        actionRef: 'poke-orchestrator',
      }
      const result = HookManager.resolveActionName(hook, {})
      expect(result).to.equal('poke-orchestrator')
    })

    it('should prioritize action_ref over action_value', () => {
      const hook: WorkHookConfig = {
        id: 'test-ref',
        name: 'ref-vs-value',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'merge-pr',
        enabled: true,
        description: null,
        createdAt: new Date().toISOString(),
        mode: 'auto',
        priority: 0,
        config: null,
        actionRef: 'custom-action',
      }
      const result = HookManager.resolveActionName(hook, {})
      expect(result).to.equal('custom-action')
    })

    it('should store and retrieve action_ref from database', () => {
      insertHook(db, {
        name: 'ref-hook-1',
        event: 'on_pr_opened',
        actionType: 'action',
        actionValue: 'poke-orchestrator',
        actionRef: 'poke-orchestrator',
      })
      insertHook(db, {
        name: 'ref-hook-2',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'poke-orchestrator',
        actionRef: 'poke-orchestrator',
      })

      const storage = new WorkHookStorage(db)
      const hooks = storage.list()
      expect(hooks).to.have.length(2)
      expect(hooks[0].actionRef).to.equal('poke-orchestrator')
      expect(hooks[1].actionRef).to.equal('poke-orchestrator')
    })

    it('should fire same handler for different events via action_ref', async () => {
      let callCount = 0
      const serviceHandlers: Record<string, AsyncHookActionHandler> = {
        'poke-orchestrator': async () => {
          callCount++
          return { action: 'poke-orchestrator', success: true, durationMs: 1 }
        },
      }

      insertHook(db, {
        name: 'ref-pr',
        event: 'on_pr_opened',
        actionType: 'action',
        actionValue: 'poke-orchestrator',
        actionRef: 'poke-orchestrator',
      })
      insertHook(db, {
        name: 'ref-ci',
        event: 'on_ci_green',
        actionType: 'action',
        actionValue: 'poke-orchestrator',
        actionRef: 'poke-orchestrator',
      })

      const manager = new HookManager({ db, serviceActionHandlers: serviceHandlers })

      await manager.fireEvent('on_pr_opened', { ticketId: 'TKT-1' })
      expect(callCount).to.equal(1)

      await manager.fireEvent('on_ci_green', { ticketId: 'TKT-1' })
      expect(callCount).to.equal(2)
    })
  })

  // ===========================================================================
  // 7. poke-orchestrator wired to 5 events
  // ===========================================================================

  describe('poke-orchestrator in presets', () => {
    it('aggressive preset should include poke-orchestrator hooks', () => {
      const preset = PRESETS.aggressive
      const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')
      expect(pokeHooks).to.have.length(5)

      const pokeEvents = pokeHooks.map(h => h.event)
      expect(pokeEvents).to.include('on_pr_opened')
      expect(pokeEvents).to.include('on_ci_green')
      expect(pokeEvents).to.include('on_ci_failed')
      expect(pokeEvents).to.include('on_agent_completed')
      expect(pokeEvents).to.include('on_agent_died')
    })

    it('poke-orchestrator hooks should all have config with target and template', () => {
      const preset = PRESETS.aggressive
      const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')
      for (const hook of pokeHooks) {
        expect(hook.config).to.exist
        expect(hook.config!.target).to.equal('orchestrator-main')
        expect(hook.config!.template).to.be.a('string')
      }
    })

    it('poke-orchestrator should be a safe action (auto mode in all presets)', () => {
      for (const presetName of ['aggressive', 'conservative', 'supervised'] as const) {
        const preset = PRESETS[presetName]
        const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')
        for (const hook of pokeHooks) {
          expect(hook.mode).to.equal('auto', `poke-orchestrator should be auto in ${presetName} preset`)
        }
      }
    })

    it('applyPreset should create poke-orchestrator hooks in DB', () => {
      applyPreset(db, 'aggressive')

      const pokeHooks = db.prepare(
        "SELECT * FROM pmo_work_hooks WHERE action_value = 'poke-orchestrator' AND source = 'preset'"
      ).all() as Array<{ event: string; action_type: string; config: string }>

      expect(pokeHooks).to.have.length(5)

      for (const hook of pokeHooks) {
        expect(hook.action_type).to.equal('action')
        const config = JSON.parse(hook.config)
        expect(config.target).to.equal('orchestrator-main')
      }
    })
  })

  // ===========================================================================
  // 8. Backward compatibility: existing shell-type hooks work
  // ===========================================================================

  describe('backward compatibility', () => {
    it('should execute shell-type hooks unchanged', async () => {
      insertHook(db, {
        name: 'shell-hook',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'true',
      })

      const manager = new HookManager({ db })
      const results = await manager.fireEvent('on_ci_green', {})
      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
    })

    it('should still resolve --action flag from shell hooks', () => {
      const hook: WorkHookConfig = {
        id: 'compat-1',
        name: 'old-shell',
        event: 'on_ci_green',
        actionType: 'shell',
        actionValue: 'prlt hook fire on_ci_green --action merge-pr',
        enabled: true,
        description: null,
        createdAt: new Date().toISOString(),
        mode: 'auto',
        priority: 0,
        config: null,
        actionRef: null,
      }
      const result = HookManager.resolveActionName(hook, {})
      expect(result).to.equal('merge-pr')
    })

    it('should execute log-type hooks unchanged', () => {
      const hook: WorkHookConfig = {
        id: 'log-1',
        name: 'log-hook',
        event: 'on_ci_green',
        actionType: 'log',
        actionValue: 'CI passed for {{event}}',
        enabled: true,
        description: null,
        createdAt: new Date().toISOString(),
        mode: 'auto',
        priority: 0,
        config: null,
        actionRef: null,
      }
      const result = executeHook(hook, 'on_ci_green', {})
      expect(result.success).to.be.true
    })
  })

  // ===========================================================================
  // 9. hook list displays new action types correctly
  // ===========================================================================

  describe('hook list JSON output', () => {
    it('should list hooks with poke and llm action types', () => {
      insertHook(db, { name: 'poke-hook', event: 'on_pr_opened', actionType: 'poke', actionValue: 'poke-orchestrator' })
      insertHook(db, { name: 'llm-hook', event: 'on_changes_requested', actionType: 'llm', actionValue: 'triage-comment' })
      insertHook(db, { name: 'shell-hook', event: 'on_ci_green', actionType: 'shell', actionValue: 'echo test' })

      const storage = new WorkHookStorage(db)
      const hooks = storage.list()
      expect(hooks).to.have.length(3)

      const pokeHook = hooks.find(h => h.actionType === 'poke')
      expect(pokeHook).to.exist
      expect(pokeHook!.actionValue).to.equal('poke-orchestrator')

      const llmHook = hooks.find(h => h.actionType === 'llm')
      expect(llmHook).to.exist
      expect(llmHook!.actionValue).to.equal('triage-comment')
    })
  })

  // ===========================================================================
  // 10. hook add supports new action types
  // ===========================================================================

  describe('hook add with new action types', () => {
    it('should create hooks with action_type="poke" via WorkHookStorage', () => {
      const storage = new WorkHookStorage(db)
      const hook = storage.create({
        name: 'poke-add-test',
        event: 'on_pr_opened',
        actionType: 'poke',
        actionValue: 'poke-orchestrator',
      })
      expect(hook.actionType).to.equal('poke')
    })

    it('should create hooks with action_type="llm" via WorkHookStorage', () => {
      const storage = new WorkHookStorage(db)
      const hook = storage.create({
        name: 'llm-add-test',
        event: 'on_changes_requested',
        actionType: 'llm',
        actionValue: 'triage-comment',
      })
      expect(hook.actionType).to.equal('llm')
    })
  })

  // ===========================================================================
  // 11. Fire on_pr_opened → poke lands with correct payload fields
  // ===========================================================================

  describe('fire on_pr_opened → poke-orchestrator with payload', () => {
    it('should fire poke-orchestrator with correct payload fields', async () => {
      let receivedCtx: Record<string, unknown> | null = null
      let receivedConfig: Record<string, unknown> | undefined

      const serviceHandlers: Record<string, AsyncHookActionHandler> = {
        'poke-orchestrator': async (ctx, config) => {
          receivedCtx = ctx
          receivedConfig = config
          return { action: 'poke-orchestrator', success: true, durationMs: 1 }
        },
      }

      insertHook(db, {
        name: 'poke-pr',
        event: 'on_pr_opened',
        actionType: 'action',
        actionValue: 'poke-orchestrator',
        config: JSON.stringify({ target: 'orchestrator-main', template: '{event}: {ticket_id} PR#{pr_number} by {author}' }),
      })

      const manager = new HookManager({ db, serviceActionHandlers: serviceHandlers })
      const results = await manager.fireEvent('on_pr_opened', {
        ticketId: 'TKT-42',
        prNumber: 123,
        branch: 'feat/my-feature',
        author: 'alice',
        repo: 'proletariat',
      })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(receivedCtx).to.exist
      // The context should include the normalized fields
      expect(receivedCtx!.ticket).to.equal('TKT-42')
      expect(receivedCtx!.pr).to.equal(123)
      expect(receivedCtx!.event).to.equal('on_pr_opened')
      // Config with template should be passed through
      expect(receivedConfig!.template).to.equal('{event}: {ticket_id} PR#{pr_number} by {author}')
    })
  })

  // ===========================================================================
  // 12. Fire on_agent_completed → same poke-orchestrator fires (shared def)
  // ===========================================================================

  describe('fire on_agent_completed → shared poke-orchestrator', () => {
    it('should fire the same poke-orchestrator action for on_agent_completed', async () => {
      const firedEvents: string[] = []

      const serviceHandlers: Record<string, AsyncHookActionHandler> = {
        'poke-orchestrator': async (ctx) => {
          firedEvents.push(ctx.event as string)
          return { action: 'poke-orchestrator', success: true, durationMs: 1 }
        },
      }

      // Wire same action to two events (simulating shared definition)
      insertHook(db, {
        name: 'poke-pr-opened',
        event: 'on_pr_opened',
        actionType: 'action',
        actionValue: 'poke-orchestrator',
        config: JSON.stringify({ target: 'orchestrator-main' }),
      })
      insertHook(db, {
        name: 'poke-agent-completed',
        event: 'on_agent_completed',
        actionType: 'action',
        actionValue: 'poke-orchestrator',
        config: JSON.stringify({ target: 'orchestrator-main' }),
      })

      const manager = new HookManager({ db, serviceActionHandlers: serviceHandlers })

      await manager.fireEvent('on_pr_opened', { ticketId: 'TKT-1' })
      await manager.fireEvent('on_agent_completed', { ticketId: 'TKT-1', agentName: 'bold-turing' })

      expect(firedEvents).to.have.length(2)
      expect(firedEvents[0]).to.equal('on_pr_opened')
      expect(firedEvents[1]).to.equal('on_agent_completed')
    })
  })

  // ===========================================================================
  // 13. Existing aggressive preset hooks still work after migration
  // ===========================================================================

  describe('aggressive preset backward compatibility', () => {
    it('should create all preset hooks including poke-orchestrator', () => {
      const count = applyPreset(db, 'aggressive')
      expect(count).to.equal(PRESETS.aggressive.hooks.length)

      // Verify existing hooks are still present
      const mergeHook = db.prepare(
        "SELECT * FROM pmo_work_hooks WHERE action_value = 'merge-pr' AND source = 'preset'"
      ).get()
      expect(mergeHook).to.exist

      const moveHooks = db.prepare(
        "SELECT * FROM pmo_work_hooks WHERE action_value = 'move-ticket' AND source = 'preset'"
      ).all()
      expect(moveHooks.length).to.be.greaterThan(0)

      // Verify poke-orchestrator hooks are present
      const pokeHooks = db.prepare(
        "SELECT * FROM pmo_work_hooks WHERE action_value = 'poke-orchestrator' AND source = 'preset'"
      ).all()
      expect(pokeHooks).to.have.length(5)
    })

    it('should execute preset hooks via action handlers', async () => {
      const executed: string[] = []
      const actionHandlers: Record<string, HookActionHandler> = {
        'merge-pr': () => { executed.push('merge-pr'); return { action: 'merge-pr', success: true, durationMs: 1 } },
        'notify': () => { executed.push('notify'); return { action: 'notify', success: true, durationMs: 1 } },
      }
      const serviceHandlers: Record<string, AsyncHookActionHandler> = {
        'poke-orchestrator': async () => { executed.push('poke-orchestrator'); return { action: 'poke-orchestrator', success: true, durationMs: 1 } },
      }

      applyPreset(db, 'aggressive')

      const manager = new HookManager({ db, actionHandlers, serviceActionHandlers: serviceHandlers })
      await manager.fireEvent('on_ci_green', { ticketId: 'TKT-1', prNumber: 42 })

      // on_ci_green should trigger merge-pr and poke-orchestrator
      expect(executed).to.include('merge-pr')
      expect(executed).to.include('poke-orchestrator')
    })
  })

  // ===========================================================================
  // Migration 0027 Tests
  // ===========================================================================

  describe('Migration 0027 (hookActionTypesExpand)', () => {
    it('should add poke and llm to CHECK constraint', () => {
      const preMigDb = createPreMigrationDb()
      try {
        hookActionTypesExpand.up(preMigDb)

        // Should be able to insert poke-type hooks
        preMigDb.prepare(`
          INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value)
          VALUES ('test-poke', 'test-poke', 'on_pr_opened', 'poke', 'poke-orchestrator')
        `).run()

        // Should be able to insert llm-type hooks
        preMigDb.prepare(`
          INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value)
          VALUES ('test-llm', 'test-llm', 'on_changes_requested', 'llm', 'triage-comment')
        `).run()

        const rows = preMigDb.prepare('SELECT action_type FROM pmo_work_hooks').all() as Array<{ action_type: string }>
        const types = rows.map(r => r.action_type)
        expect(types).to.include('poke')
        expect(types).to.include('llm')
      } finally {
        preMigDb.close()
      }
    })

    it('should add action_ref column', () => {
      const preMigDb = createPreMigrationDb()
      try {
        hookActionTypesExpand.up(preMigDb)

        // Should be able to insert with action_ref
        preMigDb.prepare(`
          INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, action_ref)
          VALUES ('test-ref', 'test-ref', 'on_ci_green', 'action', 'poke-orchestrator', 'poke-orchestrator')
        `).run()

        const row = preMigDb.prepare('SELECT action_ref FROM pmo_work_hooks WHERE id = ?').get('test-ref') as { action_ref: string }
        expect(row.action_ref).to.equal('poke-orchestrator')
      } finally {
        preMigDb.close()
      }
    })

    it('should preserve all existing data during migration', () => {
      const preMigDb = createPreMigrationDb()
      try {
        // Insert hook with all columns populated
        preMigDb.prepare(`
          INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, description, mode, priority, project_id, source, config)
          VALUES ('full-1', 'full-hook', 'on_ci_green', 'action', 'merge-pr', 1, 'Test desc', 'llm', 5, 'PRLT', 'preset', '{"key":"val"}')
        `).run()

        hookActionTypesExpand.up(preMigDb)

        const row = preMigDb.prepare('SELECT * FROM pmo_work_hooks WHERE id = ?').get('full-1') as Record<string, unknown>
        expect(row.name).to.equal('full-hook')
        expect(row.action_type).to.equal('action')
        expect(row.action_value).to.equal('merge-pr')
        expect(row.mode).to.equal('llm')
        expect(row.priority).to.equal(5)
        expect(row.source).to.equal('preset')
        expect(row.config).to.equal('{"key":"val"}')
        expect(row.action_ref).to.be.null
      } finally {
        preMigDb.close()
      }
    })

    it('should be idempotent', () => {
      const preMigDb = createPreMigrationDb()
      try {
        hookActionTypesExpand.up(preMigDb)
        hookActionTypesExpand.up(preMigDb) // Should not throw

        // Verify functionality still works
        preMigDb.prepare(`
          INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value)
          VALUES ('idem-1', 'idem-test', 'on_ci_green', 'poke', 'test')
        `).run()

        const row = preMigDb.prepare('SELECT action_type FROM pmo_work_hooks WHERE id = ?').get('idem-1') as { action_type: string }
        expect(row.action_type).to.equal('poke')
      } finally {
        preMigDb.close()
      }
    })

    it('should skip when table does not exist', () => {
      const emptyDb = new Database(':memory:')
      try {
        hookActionTypesExpand.up(emptyDb) // Should not throw
      } finally {
        emptyDb.close()
      }
    })

    it('should create action_ref index', () => {
      const preMigDb = createPreMigrationDb()
      try {
        hookActionTypesExpand.up(preMigDb)

        const idx = preMigDb.prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_pmo_work_hooks_action_ref'"
        ).get()
        expect(idx).to.exist
      } finally {
        preMigDb.close()
      }
    })
  })

  // ===========================================================================
  // Service action handlers
  // ===========================================================================

  describe('service action handlers', () => {
    it('should include poke-orchestrator in SERVICE_BACKED_ACTIONS', () => {
      expect(SERVICE_BACKED_ACTIONS.has('poke-orchestrator')).to.be.true
    })

    it('should return poke-orchestrator handler from createServiceActionHandlers', () => {
      const handlers = createServiceActionHandlers(db)
      expect(handlers['poke-orchestrator']).to.be.a('function')
    })
  })
})
