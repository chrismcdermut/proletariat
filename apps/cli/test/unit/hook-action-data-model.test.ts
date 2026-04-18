import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  WorkHookStorage,
  ensureHooksTable,
} from '../../src/lib/work-lifecycle/hooks/storage.js'
import { executeHook } from '../../src/lib/work-lifecycle/hooks/executor.js'
import {
  HookManager,
  stopHookManager,
} from '../../src/lib/work-lifecycle/hooks/manager.js'
import { resetEventBus } from '../../src/lib/events/event-bus.js'
import { orchestrateHooks } from '../../src/lib/database/migrations/0015_orchestrate_hooks.js'
import { hookModeTiers } from '../../src/lib/database/migrations/0022_hook_mode_tiers.js'
import { hookActionTypes } from '../../src/lib/database/migrations/0026_hook_action_types.js'
import {
  interpolateTemplate,
  HOOK_ACTION_TYPES,
  EVENT_PAYLOAD_FIELDS,
} from '../../src/lib/work-lifecycle/hooks/types.js'
import type {
  WorkHookConfig,
  HookActionType,
} from '../../src/lib/work-lifecycle/hooks/types.js'
import { PRESETS, getPreset } from '../../src/lib/orchestrate/presets.js'
import { applyPreset } from '../../src/lib/orchestrate/config-loader.js'
import { ACTION_HANDLERS } from '../../src/lib/orchestrate/actions.js'
import { BUILTIN_ACTIONS, PRESET_NAMES } from '../../src/lib/orchestrate/types.js'

/**
 * Tests for PRLT-1295: Hook/Action Data Model Cleanup
 *
 * Covers:
 * - Expanded action_type support (shell, webhook, log, poke, action, llm)
 * - Event payload schemas
 * - Template interpolation with {field} syntax
 * - action_ref for shared action definitions
 * - poke-orchestrator wiring
 * - Backward compatibility of shell-type hooks
 * - Migration 0026
 */

function makeHook(overrides: Partial<WorkHookConfig> = {}): WorkHookConfig {
  return {
    id: 'hook-001',
    name: 'test-hook',
    event: 'work:started',
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

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  ensureHooksTable(db)
  orchestrateHooks.up(db)
  hookModeTiers.up(db)
  hookActionTypes.up(db)
  return db
}

// =============================================================================
// Template Interpolation
// =============================================================================

describe('Template Interpolation (PRLT-1295)', () => {
  it('should replace {field} placeholders with values', () => {
    const result = interpolateTemplate(
      'PR #{pr_number} opened for {ticket_id} by {author}',
      { pr_number: 123, ticket_id: 'TKT-100', author: 'alice' },
    )
    expect(result).to.equal('PR #123 opened for TKT-100 by alice')
  })

  it('should replace {{field}} placeholders (backward compat)', () => {
    const result = interpolateTemplate(
      'Event: {{event}}, Ticket: {{ticket_id}}',
      { event: 'on_pr_opened', ticket_id: 'TKT-200' },
    )
    expect(result).to.equal('Event: on_pr_opened, Ticket: TKT-200')
  })

  it('should handle mixed {field} and {{field}} syntax', () => {
    const result = interpolateTemplate(
      '{event}: {{ticket_id}} — PR #{pr_number}',
      { event: 'on_ci_green', ticket_id: 'TKT-300', pr_number: 42 },
    )
    expect(result).to.equal('on_ci_green: TKT-300 — PR #42')
  })

  it('should leave unmatched placeholders as-is', () => {
    const result = interpolateTemplate('{missing} is unknown', {})
    expect(result).to.equal('{missing} is unknown')
  })

  it('should skip null and undefined values', () => {
    const result = interpolateTemplate('{a} {b}', { a: null, b: undefined })
    expect(result).to.equal('{a} {b}')
  })

  it('should handle Date values', () => {
    const date = new Date('2025-01-01T00:00:00Z')
    const result = interpolateTemplate('Time: {ts}', { ts: date })
    expect(result).to.equal('Time: 2025-01-01T00:00:00.000Z')
  })

  it('should handle array values by joining with comma', () => {
    const result = interpolateTemplate('Checks: {failed_checks}', {
      failed_checks: ['lint', 'test', 'build'],
    })
    expect(result).to.equal('Checks: lint, test, build')
  })

  it('should handle numeric values', () => {
    const result = interpolateTemplate('Exit: {exit_code}', { exit_code: 1 })
    expect(result).to.equal('Exit: 1')
  })
})

// =============================================================================
// Event Payload Schemas
// =============================================================================

describe('Event Payload Schemas (PRLT-1295)', () => {
  it('should define fields for all orchestrate events', () => {
    const expectedEvents = [
      'on_pr_opened', 'on_pr_merged', 'on_ci_green', 'on_ci_failed',
      'on_agent_completed', 'on_agent_died', 'on_pr_comment',
      'on_ticket_ready', 'on_agent_spawned', 'on_agent_idle',
      'on_review_approved', 'on_changes_requested', 'on_pr_conflicting',
      'on_version_published',
    ]
    for (const event of expectedEvents) {
      expect(EVENT_PAYLOAD_FIELDS).to.have.property(event)
      expect(EVENT_PAYLOAD_FIELDS[event]).to.be.an('array').with.length.greaterThan(0)
    }
  })

  it('should include ticket_id in all event schemas', () => {
    for (const [event, fields] of Object.entries(EVENT_PAYLOAD_FIELDS)) {
      expect(fields).to.include('ticket_id', `${event} should include ticket_id`)
    }
  })

  it('should include pr_number for PR-related events', () => {
    const prEvents = ['on_pr_opened', 'on_pr_merged', 'on_ci_green', 'on_ci_failed', 'on_pr_comment', 'on_pr_conflicting']
    for (const event of prEvents) {
      expect(EVENT_PAYLOAD_FIELDS[event]).to.include('pr_number', `${event} should include pr_number`)
    }
  })

  it('should include agent_name for agent-related events', () => {
    const agentEvents = ['on_agent_completed', 'on_agent_died', 'on_agent_spawned', 'on_agent_idle']
    for (const event of agentEvents) {
      expect(EVENT_PAYLOAD_FIELDS[event]).to.include('agent_name', `${event} should include agent_name`)
    }
  })
})

// =============================================================================
// Action Types
// =============================================================================

describe('Hook Action Types (PRLT-1295)', () => {
  it('should define all six action types', () => {
    expect(HOOK_ACTION_TYPES).to.include.members(['shell', 'webhook', 'log', 'poke', 'action', 'llm'])
    expect(HOOK_ACTION_TYPES).to.have.lengthOf(6)
  })
})

// =============================================================================
// Migration 0026
// =============================================================================

describe('Migration 0026 — Hook Action Types (PRLT-1295)', () => {
  it('should add poke/action/llm to action_type constraint', () => {
    const db = createTestDb()
    try {
      const createSql = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='pmo_work_hooks'"
      ).get() as { sql: string }
      expect(createSql.sql).to.include("'poke'")
      expect(createSql.sql).to.include("'action'")
      expect(createSql.sql).to.include("'llm'")
    } finally {
      db.close()
    }
  })

  it('should add action_ref column', () => {
    const db = createTestDb()
    try {
      const createSql = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='pmo_work_hooks'"
      ).get() as { sql: string }
      expect(createSql.sql).to.include('action_ref')
    } finally {
      db.close()
    }
  })

  it('should be idempotent (safe to run twice)', () => {
    const db = createTestDb()
    try {
      expect(() => hookActionTypes.up(db)).to.not.throw()
    } finally {
      db.close()
    }
  })

  it('should preserve existing hook data', () => {
    const db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    ensureHooksTable(db)
    orchestrateHooks.up(db)
    hookModeTiers.up(db)

    // Insert a hook before migration
    const storage = new WorkHookStorage(db)
    storage.create({
      name: 'existing-hook',
      event: 'work:started',
      actionType: 'shell',
      actionValue: 'echo hello',
    })

    // Run migration
    hookActionTypes.up(db)

    // Verify the hook is still there
    const hooks = storage.list()
    expect(hooks).to.have.lengthOf(1)
    expect(hooks[0].name).to.equal('existing-hook')
    expect(hooks[0].actionType).to.equal('shell')
    expect(hooks[0].actionValue).to.equal('echo hello')
    expect(hooks[0].actionRef).to.be.null
    db.close()
  })
})

// =============================================================================
// Storage — New Action Types
// =============================================================================

describe('WorkHookStorage — New Action Types (PRLT-1295)', () => {
  let db: Database.Database
  let storage: WorkHookStorage

  beforeEach(() => {
    db = createTestDb()
    storage = new WorkHookStorage(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should create hooks with action_type=poke', () => {
    const hook = storage.create({
      name: 'poke-hook',
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
      name: 'action-hook',
      event: 'on_ci_green',
      actionType: 'action',
      actionValue: 'merge-pr',
      actionRef: 'merge-pr',
    })
    expect(hook.actionType).to.equal('action')
    expect(hook.actionRef).to.equal('merge-pr')
  })

  it('should create hooks with action_type=llm', () => {
    const hook = storage.create({
      name: 'llm-hook',
      event: 'on_changes_requested',
      actionType: 'llm',
      actionValue: 'Triage this comment: {body}',
    })
    expect(hook.actionType).to.equal('llm')
  })

  it('should store and retrieve action_ref', () => {
    const hook = storage.create({
      name: 'ref-hook',
      event: 'on_agent_completed',
      actionType: 'action',
      actionValue: 'move-ticket',
      actionRef: 'move-ticket',
    })
    const retrieved = storage.getById(hook.id)
    expect(retrieved!.actionRef).to.equal('move-ticket')
  })

  it('should default action_ref to null', () => {
    const hook = storage.create({
      name: 'no-ref-hook',
      event: 'work:started',
      actionType: 'shell',
      actionValue: 'echo test',
    })
    expect(hook.actionRef).to.be.null
  })

  it('should allow multiple events to reference the same action_ref', () => {
    const hook1 = storage.create({
      name: 'poke-1',
      event: 'on_pr_opened',
      actionType: 'poke',
      actionValue: '{event}',
      actionRef: 'poke-orchestrator',
    })
    const hook2 = storage.create({
      name: 'poke-2',
      event: 'on_ci_green',
      actionType: 'poke',
      actionValue: '{event}',
      actionRef: 'poke-orchestrator',
    })
    expect(hook1.actionRef).to.equal('poke-orchestrator')
    expect(hook2.actionRef).to.equal('poke-orchestrator')
    expect(hook1.id).to.not.equal(hook2.id)
  })

  it('should still accept all original action types', () => {
    const origTypes: HookActionType[] = ['shell', 'webhook', 'log']
    for (const t of origTypes) {
      const hook = storage.create({
        name: `orig-${t}`,
        event: 'work:started',
        actionType: t,
        actionValue: `test-${t}`,
      })
      expect(hook.actionType).to.equal(t)
    }
  })
})

// =============================================================================
// Executor — New Action Types
// =============================================================================

describe('Hook Executor — New Action Types (PRLT-1295)', () => {
  describe('action type', () => {
    it('should fail with error when no built-in handler found', () => {
      const hook = makeHook({
        actionType: 'action',
        actionValue: 'nonexistent-action',
        actionRef: 'nonexistent-action',
      })
      const result = executeHook(hook, 'on_ci_green', { ticket_id: 'TKT-1' })
      expect(result.success).to.be.false
      expect(result.error).to.include('No built-in handler found')
    })
  })

  describe('poke type', () => {
    it('should fail gracefully when session poke target is unavailable', () => {
      const hook = makeHook({
        actionType: 'poke',
        actionValue: '{event}: {ticket_id}',
        actionRef: 'nonexistent-session',
        config: {
          target: 'nonexistent-session',
          template: '{event}: {ticket_id}',
        },
      })
      const result = executeHook(hook, 'on_pr_opened', { ticket_id: 'TKT-1' })
      // Will fail because the session doesn't exist, but shouldn't throw
      expect(result.success).to.be.false
      expect(result.error).to.be.a('string')
    })
  })

  describe('llm type', () => {
    it('should succeed and log the LLM prompt', () => {
      const hook = makeHook({
        actionType: 'llm',
        actionValue: 'Triage: {event} for {ticket_id}',
        config: { prompt: 'Triage: {event} for {ticket_id}' },
      })
      const result = executeHook(hook, 'on_changes_requested', {
        ticket_id: 'TKT-1',
        body: 'Fix the bug',
      })
      expect(result.success).to.be.true
    })
  })

  describe('backward compatibility', () => {
    it('shell hooks should continue to work unchanged', () => {
      const hook = makeHook({ actionType: 'shell', actionValue: 'echo "hello"' })
      const result = executeHook(hook, 'work:started', { ticketId: 'TKT-1' })
      expect(result.success).to.be.true
    })

    it('webhook hooks should continue to work', () => {
      const hook = makeHook({
        actionType: 'webhook',
        actionValue: 'http://localhost:99999/nonexistent',
      })
      const result = executeHook(hook, 'work:started', {})
      // Will fail (no server) but shouldn't crash
      expect(result).to.have.property('success')
    })

    it('log hooks should continue to work', () => {
      const hook = makeHook({
        actionType: 'log',
        actionValue: 'Event: {{event}} Ticket: {{ticketId}}',
      })
      const result = executeHook(hook, 'work:started', { ticketId: 'TKT-1' })
      expect(result.success).to.be.true
    })
  })
})

// =============================================================================
// HookManager — Action Name Resolution
// =============================================================================

describe('HookManager — Action Resolution (PRLT-1295)', () => {
  it('should resolve action_ref for action_type=action', () => {
    const hook = makeHook({
      actionType: 'action',
      actionValue: 'merge-pr',
      actionRef: 'merge-pr',
    })
    const name = HookManager.resolveActionName(hook, ACTION_HANDLERS)
    expect(name).to.equal('merge-pr')
  })

  it('should resolve action_ref for action_type=poke', () => {
    const hook = makeHook({
      actionType: 'poke',
      actionValue: '{event}',
      actionRef: 'poke-orchestrator',
    })
    const name = HookManager.resolveActionName(hook, {})
    expect(name).to.equal('poke-orchestrator')
  })

  it('should fall back to "poke" for poke type with no action_ref', () => {
    const hook = makeHook({
      actionType: 'poke',
      actionValue: 'message',
      actionRef: null,
    })
    const name = HookManager.resolveActionName(hook, {})
    expect(name).to.equal('poke')
  })

  it('should resolve action_ref for action_type=llm', () => {
    const hook = makeHook({
      actionType: 'llm',
      actionValue: 'triage prompt',
      actionRef: 'triage-action',
    })
    const name = HookManager.resolveActionName(hook, {})
    expect(name).to.equal('triage-action')
  })

  it('should still extract --action from shell hooks (backward compat)', () => {
    const hook = makeHook({
      actionType: 'shell',
      actionValue: 'prlt hook fire on_ci_green --action merge-pr',
    })
    const name = HookManager.resolveActionName(hook, ACTION_HANDLERS)
    expect(name).to.equal('merge-pr')
  })

  it('should still use action_value directly for known actions', () => {
    const hook = makeHook({
      actionType: 'shell',
      actionValue: 'merge-pr',
    })
    const name = HookManager.resolveActionName(hook, ACTION_HANDLERS)
    expect(name).to.equal('merge-pr')
  })
})

// =============================================================================
// HookManager — action type dispatch
// =============================================================================

describe('HookManager — Action Type Dispatch (PRLT-1295)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    resetEventBus()
    stopHookManager()
  })

  afterEach(() => {
    stopHookManager()
    resetEventBus()
    db.close()
  })

  it('should execute action_type=action hooks via built-in handlers', async () => {
    const storage = new WorkHookStorage(db)
    const created = storage.create({
      name: 'action-hook-test',
      event: 'on_ci_green',
      actionType: 'action',
      actionValue: 'test-action',
      actionRef: 'test-action',
    })

    let handlerCalled = false
    const manager = new HookManager({
      db,
      actionHandlers: {
        'test-action': (ctx, config) => {
          handlerCalled = true
          return { action: 'test-action', success: true, durationMs: 0 }
        },
      },
    })

    const results = await manager.fireEvent('on_ci_green', { ticket_id: 'TKT-1' })
    expect(handlerCalled).to.be.true
    expect(results).to.have.lengthOf(1)
    expect(results[0].success).to.be.true
    expect(results[0].action).to.equal('test-action')
  })

  it('should return error for action_type=action with unknown action_ref', async () => {
    const storage = new WorkHookStorage(db)
    storage.create({
      name: 'bad-action-hook',
      event: 'on_ci_green',
      actionType: 'action',
      actionValue: 'nonexistent',
      actionRef: 'nonexistent',
    })

    const manager = new HookManager({ db, actionHandlers: {} })
    const results = await manager.fireEvent('on_ci_green', {})
    expect(results).to.have.lengthOf(1)
    expect(results[0].success).to.be.false
    expect(results[0].error).to.include('No built-in handler found')
  })
})

// =============================================================================
// Presets — poke-orchestrator wiring
// =============================================================================

describe('Presets — Poke Orchestrator (PRLT-1295)', () => {
  const POKE_EVENTS = ['on_pr_opened', 'on_ci_green', 'on_ci_failed', 'on_agent_completed', 'on_agent_died']

  it('should include poke-orchestrator hooks for all 5 events', () => {
    const preset = getPreset('aggressive')
    const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')

    expect(pokeHooks).to.have.lengthOf(POKE_EVENTS.length)
    const pokeEvents = pokeHooks.map(h => h.event)
    for (const event of POKE_EVENTS) {
      expect(pokeEvents).to.include(event, `Missing poke-orchestrator for ${event}`)
    }
  })

  it('should use action_type=poke for poke-orchestrator hooks', () => {
    const preset = getPreset('aggressive')
    const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')

    for (const hook of pokeHooks) {
      expect(hook.actionType).to.equal('poke', `poke-orchestrator for ${hook.event} should use actionType=poke`)
    }
  })

  it('should set poke-orchestrator target to orchestrator-main', () => {
    const preset = getPreset('aggressive')
    const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')

    for (const hook of pokeHooks) {
      expect(hook.config).to.have.property('target', 'orchestrator-main')
    }
  })

  it('should include event and ticket_id in poke template', () => {
    const preset = getPreset('aggressive')
    const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')

    for (const hook of pokeHooks) {
      expect(hook.config).to.have.property('template')
      const template = hook.config!.template as string
      expect(template).to.include('{event}')
      expect(template).to.include('{ticket_id}')
    }
  })

  it('poke-orchestrator should be auto in all presets (safe action)', () => {
    for (const name of PRESET_NAMES) {
      const preset = getPreset(name)
      const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')

      for (const hook of pokeHooks) {
        expect(hook.mode).to.equal('auto', `poke-orchestrator in ${name} should be auto (it's safe)`)
      }
    }
  })

  it('same poke-orchestrator definition is shared across events (not duplicated)', () => {
    const preset = getPreset('aggressive')
    const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')

    // All should reference orchestrator-main
    const targets = new Set(pokeHooks.map(h => (h.config as any)?.target))
    expect(targets.size).to.equal(1)
    expect(targets.has('orchestrator-main')).to.be.true
  })
})

// =============================================================================
// Presets — Direct Action Dispatch (no shell indirection)
// =============================================================================

describe('Presets — Direct Action Dispatch (PRLT-1295)', () => {
  it('should use action_type=action for built-in action hooks', () => {
    const preset = getPreset('aggressive')
    const actionHooks = preset.hooks.filter(h => h.actionType === 'action')

    // Most hooks should be action type (except poke-orchestrator which is poke)
    expect(actionHooks.length).to.be.greaterThan(0)

    // Verify they reference real action handlers
    for (const hook of actionHooks) {
      expect(ACTION_HANDLERS).to.have.property(hook.action,)
    }
  })

  it('should NOT use shell indirection for preset hooks', () => {
    // Preset hooks should NOT have 'prlt hook fire' in actionValue
    const preset = getPreset('aggressive')
    for (const hook of preset.hooks) {
      // The action type should be 'action' or 'poke', not 'shell'
      expect(['action', 'poke']).to.include(hook.actionType,
        `Hook ${hook.event}→${hook.action} should use direct dispatch, not shell`)
    }
  })
})

// =============================================================================
// Apply Preset — Database Integration
// =============================================================================

describe('applyPreset — New Action Types (PRLT-1295)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('should create hooks with action_type=action (not shell) for built-in actions', () => {
    const count = applyPreset(db, 'aggressive')
    expect(count).to.be.greaterThan(0)

    const hooks = db.prepare(
      "SELECT * FROM pmo_work_hooks WHERE action_type = 'action'"
    ).all() as any[]
    expect(hooks.length).to.be.greaterThan(0)
  })

  it('should create hooks with action_type=poke for poke-orchestrator', () => {
    applyPreset(db, 'aggressive')

    const hooks = db.prepare(
      "SELECT * FROM pmo_work_hooks WHERE action_type = 'poke'"
    ).all() as any[]
    expect(hooks.length).to.equal(5) // 5 poke-orchestrator events
  })

  it('should set action_ref on all preset hooks', () => {
    applyPreset(db, 'aggressive')

    const hooks = db.prepare(
      'SELECT * FROM pmo_work_hooks WHERE action_ref IS NOT NULL'
    ).all() as any[]
    expect(hooks.length).to.be.greaterThan(0)
  })

  it('should preserve existing preset behavior after re-apply', () => {
    applyPreset(db, 'aggressive')
    const count1 = db.prepare('SELECT COUNT(*) as c FROM pmo_work_hooks').get() as { c: number }

    // Re-apply should replace, not duplicate
    applyPreset(db, 'aggressive')
    const count2 = db.prepare('SELECT COUNT(*) as c FROM pmo_work_hooks').get() as { c: number }
    expect(count2.c).to.equal(count1.c)
  })

  it('existing shell-type hooks should still work after preset apply', () => {
    // Create a custom shell hook
    const storage = new WorkHookStorage(db)
    storage.create({
      name: 'custom-shell-hook',
      event: 'work:started',
      actionType: 'shell',
      actionValue: 'echo custom',
    })

    // Apply preset — should not affect custom hooks (only replaces preset source)
    applyPreset(db, 'aggressive')

    const customHook = storage.getByName('custom-shell-hook')
    expect(customHook).to.not.be.null
    expect(customHook!.actionType).to.equal('shell')
    expect(customHook!.actionValue).to.equal('echo custom')
  })
})

// =============================================================================
// Preset Registry — Updated Invariants
// =============================================================================

describe('Preset Invariants — Updated (PRLT-1295)', () => {
  const SAFE_ACTIONS = new Set([
    'move-ticket',
    'notify',
    'cleanup-container',
    'health-check',
    'rebase-conflicting-prs',
    'spawn-review-agent',
    'gc-sweep',
    'poke-orchestrator',
  ])

  it('BUILTIN_ACTIONS list should match ACTION_HANDLERS keys', () => {
    const handlerKeys = Object.keys(ACTION_HANDLERS).sort()
    const builtinSorted = [...BUILTIN_ACTIONS].sort()
    expect(handlerKeys).to.deep.equal(builtinSorted)
  })

  it('poke-orchestrator should be in ACTION_HANDLERS', () => {
    expect(ACTION_HANDLERS).to.have.property('poke-orchestrator')
  })

  it('poke-orchestrator should be in BUILTIN_ACTIONS', () => {
    expect(BUILTIN_ACTIONS).to.include('poke-orchestrator')
  })

  it('all presets should have consistent hook counts', () => {
    const counts = PRESET_NAMES.map(name => getPreset(name).hooks.length)
    expect(new Set(counts).size).to.equal(1, 'All presets should have the same hook count')
  })

  it('conservative: safe actions should be auto, destructive should be human', () => {
    const preset = getPreset('conservative')
    for (const hook of preset.hooks) {
      if (SAFE_ACTIONS.has(hook.action)) {
        expect(hook.mode).to.equal('auto', `Safe action ${hook.action} should be auto`)
      } else {
        expect(hook.mode).to.equal('human', `Destructive action ${hook.action} should be human`)
      }
    }
  })

  it('supervised: safe actions should be auto, destructive should be llm', () => {
    const preset = getPreset('supervised')
    for (const hook of preset.hooks) {
      if (SAFE_ACTIONS.has(hook.action)) {
        expect(hook.mode).to.equal('auto', `Safe action ${hook.action} should be auto`)
      } else {
        expect(hook.mode).to.equal('llm', `Destructive action ${hook.action} should be llm`)
      }
    }
  })

  it('aggressive: all actions should be auto', () => {
    const preset = getPreset('aggressive')
    for (const hook of preset.hooks) {
      expect(hook.mode).to.equal('auto', `${hook.action} should be auto in aggressive`)
    }
  })

  it('all preset actions should have handlers in ACTION_HANDLERS', () => {
    for (const name of PRESET_NAMES) {
      const preset = getPreset(name)
      for (const hook of preset.hooks) {
        expect(ACTION_HANDLERS).to.have.property(hook.action,)
      }
    }
  })
})
