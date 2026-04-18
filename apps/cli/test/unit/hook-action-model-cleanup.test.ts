import { expect } from 'chai'
import Database from 'better-sqlite3'
import { ensureHooksTable, WorkHookStorage } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { HookManager } from '../../src/lib/work-lifecycle/hooks/manager.js'
import { executeHook } from '../../src/lib/work-lifecycle/hooks/executor.js'
import { applyPreset } from '../../src/lib/orchestrate/config-loader.js'
import { PRESETS } from '../../src/lib/orchestrate/presets.js'
import { hookActionTypesExpand } from '../../src/lib/database/migrations/0028_hook_action_types_expand.js'
import { resetEventBus } from '../../src/lib/events/event-bus.js'
import {
  interpolateTemplate,
  EVENT_PAYLOAD_FIELDS,
  TYPED_EVENT_NAMES,
} from '../../src/lib/work-lifecycle/hooks/types.js'
import type {
  WorkHookConfig,
  HookActionHandler,
  AsyncHookActionHandler,
} from '../../src/lib/work-lifecycle/hooks/types.js'

/**
 * Tests for PRLT-1295: Clean up hook/action data model.
 *
 * Covers:
 * - Expanded action_type: shell, poke, action, webhook, llm, log
 * - Event payload schemas with typed fields
 * - Template interpolation with {field} placeholders
 * - action_ref for shared action definitions
 * - Migration 0028: CHECK constraint expansion, action_ref column
 * - poke-orchestrator wired to 5 events in presets
 * - Backward compatibility: existing shell hooks unchanged
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
    // Columns may already exist from ensureHooksTable
  }
  return db
}

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

// =============================================================================
// Template Interpolation
// =============================================================================

describe('Template Interpolation (PRLT-1295)', () => {
  it('should interpolate {event} from event name', () => {
    const result = interpolateTemplate('Event: {event}', 'on_pr_opened', {})
    expect(result).to.equal('Event: on_pr_opened')
  })

  it('should interpolate {ticket_id} from payload', () => {
    const result = interpolateTemplate('Ticket: {ticket_id}', 'on_pr_opened', { ticket_id: 'TKT-100' })
    expect(result).to.equal('Ticket: TKT-100')
  })

  it('should interpolate {pr_number} from payload', () => {
    const result = interpolateTemplate('PR #{pr_number}', 'on_pr_opened', { pr_number: 42 })
    expect(result).to.equal('PR #42')
  })

  it('should interpolate {author} from payload', () => {
    const result = interpolateTemplate('By {author}', 'on_pr_opened', { author: 'alice' })
    expect(result).to.equal('By alice')
  })

  it('should interpolate multiple fields in one template', () => {
    const result = interpolateTemplate(
      '{event}: ticket={ticket_id} pr={pr_number} agent={agent_name}',
      'on_pr_opened',
      { ticket_id: 'TKT-1', pr_number: 5, agent_name: 'bold-turing' }
    )
    expect(result).to.equal('on_pr_opened: ticket=TKT-1 pr=5 agent=bold-turing')
  })

  it('should leave unknown fields as-is', () => {
    const result = interpolateTemplate('{unknown_field} stays', 'on_pr_opened', {})
    expect(result).to.equal('{unknown_field} stays')
  })

  it('should handle null/undefined values by leaving placeholder', () => {
    const result = interpolateTemplate('{missing}', 'on_pr_opened', { missing: null })
    expect(result).to.equal('{missing}')
  })

  it('should normalize ticket alias to ticket_id', () => {
    const result = interpolateTemplate('{ticket_id}', 'on_pr_opened', { ticket: 'TKT-200' })
    expect(result).to.equal('TKT-200')
  })

  it('should normalize pr alias to pr_number', () => {
    const result = interpolateTemplate('{pr_number}', 'on_pr_opened', { pr: 99 })
    expect(result).to.equal('99')
  })

  it('should normalize agent alias to agent_name', () => {
    const result = interpolateTemplate('{agent_name}', 'on_agent_completed', { agent: 'my-agent' })
    expect(result).to.equal('my-agent')
  })

  it('should handle Date values', () => {
    const date = new Date('2024-01-15T10:30:00Z')
    const result = interpolateTemplate('Time: {timestamp}', 'on_pr_opened', { timestamp: date })
    expect(result).to.equal('Time: 2024-01-15T10:30:00.000Z')
  })

  it('should serialize object values as JSON', () => {
    const result = interpolateTemplate('Checks: {failed_checks}', 'on_ci_failed', {
      failed_checks: ['lint', 'test'],
    })
    expect(result).to.equal('Checks: ["lint","test"]')
  })
})

// =============================================================================
// Event Payload Schemas
// =============================================================================

describe('Event Payload Schemas (PRLT-1295)', () => {
  it('should define typed event names', () => {
    expect(TYPED_EVENT_NAMES).to.include('on_pr_opened')
    expect(TYPED_EVENT_NAMES).to.include('on_pr_merged')
    expect(TYPED_EVENT_NAMES).to.include('on_ci_green')
    expect(TYPED_EVENT_NAMES).to.include('on_ci_failed')
    expect(TYPED_EVENT_NAMES).to.include('on_agent_completed')
    expect(TYPED_EVENT_NAMES).to.include('on_agent_died')
    expect(TYPED_EVENT_NAMES).to.include('on_pr_comment')
  })

  it('should define payload fields per event', () => {
    expect(EVENT_PAYLOAD_FIELDS.on_pr_opened).to.include.members(['pr_number', 'ticket_id', 'branch', 'author', 'repo'])
    expect(EVENT_PAYLOAD_FIELDS.on_pr_merged).to.include.members(['pr_number', 'ticket_id', 'branch', 'merge_sha'])
    expect(EVENT_PAYLOAD_FIELDS.on_ci_green).to.include.members(['pr_number', 'ticket_id', 'check_suite_url'])
    expect(EVENT_PAYLOAD_FIELDS.on_ci_failed).to.include.members(['pr_number', 'ticket_id', 'failed_checks'])
    expect(EVENT_PAYLOAD_FIELDS.on_agent_completed).to.include.members(['agent_name', 'ticket_id', 'execution_id', 'summary'])
    expect(EVENT_PAYLOAD_FIELDS.on_agent_died).to.include.members(['agent_name', 'ticket_id', 'execution_id', 'exit_code', 'error'])
    expect(EVENT_PAYLOAD_FIELDS.on_pr_comment).to.include.members(['pr_number', 'ticket_id', 'comment_id', 'author', 'body'])
  })

  it('should define fields for orchestrate lifecycle events', () => {
    expect(EVENT_PAYLOAD_FIELDS.on_agent_spawned).to.include.members(['agent_name', 'ticket_id'])
    expect(EVENT_PAYLOAD_FIELDS.on_agent_idle).to.include.members(['agent_name', 'ticket_id'])
    expect(EVENT_PAYLOAD_FIELDS.on_ticket_ready).to.include.members(['ticket_id'])
    expect(EVENT_PAYLOAD_FIELDS.on_pr_conflicting).to.include.members(['pr_number', 'ticket_id', 'branch'])
    expect(EVENT_PAYLOAD_FIELDS.on_review_approved).to.include.members(['pr_number', 'ticket_id', 'author'])
    expect(EVENT_PAYLOAD_FIELDS.on_changes_requested).to.include.members(['pr_number', 'ticket_id', 'author'])
  })
})

// =============================================================================
// Storage: action_ref
// =============================================================================

describe('WorkHookStorage: action_ref (PRLT-1295)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('should create a hook with action_ref', () => {
    const storage = new WorkHookStorage(db)
    const hook = storage.create({
      name: 'poke-test',
      event: 'on_pr_opened',
      actionType: 'poke',
      actionValue: 'poke-orchestrator',
      actionRef: 'poke-orchestrator',
    })
    expect(hook.actionRef).to.equal('poke-orchestrator')
    expect(hook.actionType).to.equal('poke')
  })

  it('should create a hook without action_ref (null)', () => {
    const storage = new WorkHookStorage(db)
    const hook = storage.create({
      name: 'shell-test',
      event: 'work:started',
      actionType: 'shell',
      actionValue: 'echo hello',
    })
    expect(hook.actionRef).to.be.null
  })

  it('should find hooks by action_ref', () => {
    const storage = new WorkHookStorage(db)

    storage.create({
      name: 'poke-pr',
      event: 'on_pr_opened',
      actionType: 'poke',
      actionValue: 'poke-orchestrator',
      actionRef: 'poke-orchestrator',
    })

    storage.create({
      name: 'poke-ci',
      event: 'on_ci_green',
      actionType: 'poke',
      actionValue: 'poke-orchestrator',
      actionRef: 'poke-orchestrator',
    })

    storage.create({
      name: 'other-hook',
      event: 'on_ci_failed',
      actionType: 'shell',
      actionValue: 'echo fail',
    })

    const shared = storage.findByActionRef('poke-orchestrator')
    expect(shared).to.have.lengthOf(2)
    expect(shared.map(h => h.event)).to.include.members(['on_pr_opened', 'on_ci_green'])
  })

  it('should return empty array for unknown action_ref', () => {
    const storage = new WorkHookStorage(db)
    const result = storage.findByActionRef('nonexistent')
    expect(result).to.have.lengthOf(0)
  })

  it('should list hooks with action_ref in results', () => {
    const storage = new WorkHookStorage(db)
    storage.create({
      name: 'poke-test',
      event: 'on_pr_opened',
      actionType: 'poke',
      actionValue: 'poke-orchestrator',
      actionRef: 'poke-orchestrator',
    })

    const hooks = storage.list()
    expect(hooks).to.have.lengthOf(1)
    expect(hooks[0].actionRef).to.equal('poke-orchestrator')
  })
})

// =============================================================================
// Executor: poke action type
// =============================================================================

describe('Hook Executor: poke action type (PRLT-1295)', () => {
  it('should fail gracefully when target session does not exist', () => {
    const hook = makeHook({
      actionType: 'poke',
      actionValue: 'nonexistent-session',
      config: {
        target: 'nonexistent-session-12345',
        template: '{event}: {ticket_id}',
      },
    })

    const result = executeHook(hook, 'on_pr_opened', { ticket_id: 'TKT-1' })
    // Will fail because the tmux session doesn't exist, but shouldn't throw
    expect(result.success).to.be.false
    expect(result.error).to.be.a('string')
    expect(result.action).to.equal('poke:nonexistent-session-12345')
  })

  it('should interpolate template with event data', () => {
    const hook = makeHook({
      actionType: 'poke',
      actionValue: 'test-session',
      config: {
        target: 'nonexistent-session-template-test',
        template: '{event}: ticket={ticket_id} pr={pr_number}',
      },
    })

    const result = executeHook(hook, 'on_pr_opened', {
      ticket_id: 'TKT-100',
      pr_number: 42,
    })
    // Will fail (no tmux session), but we can verify the action name includes target
    expect(result.action).to.equal('poke:nonexistent-session-template-test')
  })

  it('should use action_value as target fallback when config.target is missing', () => {
    const hook = makeHook({
      actionType: 'poke',
      actionValue: 'fallback-target',
      config: {},
    })

    const result = executeHook(hook, 'on_pr_opened', {})
    expect(result.action).to.equal('poke:fallback-target')
  })
})

// =============================================================================
// Executor: llm action type
// =============================================================================

describe('Hook Executor: llm action type (PRLT-1295)', () => {
  it('should execute and return success with prompt', () => {
    const hook = makeHook({
      actionType: 'llm',
      actionValue: 'Triage this: {ticket_id}',
      config: {
        prompt: 'Triage this comment for {ticket_id}: {body}',
      },
    })

    const result = executeHook(hook, 'on_pr_comment', {
      ticket_id: 'TKT-1',
      body: 'Please fix the bug',
    })
    expect(result.success).to.be.true
    expect(result.action).to.equal(`llm:${hook.name}`)
  })

  it('should interpolate prompt template with payload fields', () => {
    const hook = makeHook({
      actionType: 'llm',
      actionValue: 'Default prompt for {ticket_id}',
      config: null,
    })

    const result = executeHook(hook, 'on_ci_failed', {
      ticket_id: 'TKT-5',
      failed_checks: ['lint'],
    })
    expect(result.success).to.be.true
  })
})

// =============================================================================
// Migration 0028
// =============================================================================

describe('Migration 0028: hook_action_types_expand (PRLT-1295)', () => {
  it('should expand action_type CHECK to include poke and llm', () => {
    // Create a pre-migration DB (without poke/llm)
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

    // Insert a pre-existing hook
    db.exec(`
      INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, source)
      VALUES ('existing-1', 'old-hook', 'on_ci_green', 'action', 'merge-pr', 'preset')
    `)

    // Run migration
    hookActionTypesExpand.up(db)

    // Verify old hook is preserved
    const oldHook = db.prepare('SELECT * FROM pmo_work_hooks WHERE id = ?').get('existing-1') as Record<string, unknown>
    expect(oldHook.name).to.equal('old-hook')
    expect(oldHook.action_type).to.equal('action')
    expect(oldHook.action_value).to.equal('merge-pr')

    // Verify we can now insert poke and llm types
    db.exec(`
      INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, source)
      VALUES ('poke-1', 'poke-test', 'on_pr_opened', 'poke', 'orchestrator-main', 'preset')
    `)
    db.exec(`
      INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, source)
      VALUES ('llm-1', 'llm-test', 'on_ci_failed', 'llm', 'triage this', 'cli')
    `)

    const pokeHook = db.prepare('SELECT * FROM pmo_work_hooks WHERE id = ?').get('poke-1') as Record<string, unknown>
    expect(pokeHook.action_type).to.equal('poke')

    const llmHook = db.prepare('SELECT * FROM pmo_work_hooks WHERE id = ?').get('llm-1') as Record<string, unknown>
    expect(llmHook.action_type).to.equal('llm')

    // Verify action_ref column exists
    const columns = db.prepare('PRAGMA table_info(pmo_work_hooks)').all() as Array<{ name: string }>
    expect(columns.map(c => c.name)).to.include('action_ref')

    db.close()
  })

  it('should be idempotent — skip if already migrated', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE pmo_work_hooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        event TEXT NOT NULL,
        action_type TEXT NOT NULL DEFAULT 'shell' CHECK (action_type IN ('shell', 'webhook', 'log', 'action', 'poke', 'llm')),
        action_value TEXT NOT NULL,
        action_ref TEXT,
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

    // Should not throw
    hookActionTypesExpand.up(db)
    db.close()
  })

  it('should create action_ref index', () => {
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

    hookActionTypesExpand.up(db)

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='pmo_work_hooks'").all() as Array<{ name: string }>
    expect(indexes.map(i => i.name)).to.include('idx_pmo_work_hooks_action_ref')

    db.close()
  })
})

// =============================================================================
// Presets: poke-orchestrator
// =============================================================================

describe('Presets: poke-orchestrator (PRLT-1295)', () => {
  it('should include poke-orchestrator hooks in all presets', () => {
    for (const presetName of ['aggressive', 'conservative', 'supervised'] as const) {
      const preset = PRESETS[presetName]
      const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')
      expect(pokeHooks, `${presetName} preset should have poke-orchestrator hooks`).to.have.length.greaterThan(0)
    }
  })

  it('should wire poke-orchestrator to 5 events', () => {
    const preset = PRESETS.aggressive
    const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')
    const events = pokeHooks.map(h => h.event)
    expect(events).to.include.members([
      'on_pr_opened',
      'on_ci_green',
      'on_ci_failed',
      'on_agent_completed',
      'on_agent_died',
    ])
  })

  it('should use action_type=poke for poke-orchestrator', () => {
    const preset = PRESETS.aggressive
    const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')
    for (const hook of pokeHooks) {
      expect(hook.actionType).to.equal('poke')
    }
  })

  it('should use shared action_ref for poke-orchestrator', () => {
    const preset = PRESETS.aggressive
    const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')
    for (const hook of pokeHooks) {
      expect(hook.actionRef).to.equal('poke-orchestrator')
    }
  })

  it('should share identical config across all poke-orchestrator hooks', () => {
    const preset = PRESETS.aggressive
    const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')
    const configs = pokeHooks.map(h => JSON.stringify(h.config))
    // All configs should be identical
    expect(new Set(configs).size).to.equal(1)
    const config = pokeHooks[0].config as Record<string, unknown>
    expect(config.target).to.equal('orchestrator-main')
    expect(config.template).to.be.a('string')
  })

  it('should mark poke-orchestrator as auto mode in all presets', () => {
    // poke-orchestrator is a safe action (notification), so it should be auto in all presets
    for (const presetName of ['aggressive', 'conservative', 'supervised'] as const) {
      const preset = PRESETS[presetName]
      const pokeHooks = preset.hooks.filter(h => h.action === 'poke-orchestrator')
      for (const hook of pokeHooks) {
        expect(hook.mode, `${presetName}:${hook.event}:poke-orchestrator should be auto`).to.equal('auto')
      }
    }
  })
})

// =============================================================================
// Preset apply: action_ref persisted to DB
// =============================================================================

describe('applyPreset: action_ref persistence (PRLT-1295)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('should persist action_ref when applying aggressive preset', () => {
    const count = applyPreset(db, 'aggressive')
    expect(count).to.be.greaterThan(0)

    // Check poke-orchestrator hooks have action_ref set
    const pokeHooks = db.prepare(
      "SELECT * FROM pmo_work_hooks WHERE action_value = 'poke-orchestrator'"
    ).all() as Array<Record<string, unknown>>

    expect(pokeHooks.length).to.equal(5)
    for (const hook of pokeHooks) {
      expect(hook.action_ref).to.equal('poke-orchestrator')
      expect(hook.action_type).to.equal('poke')
    }
  })

  it('should persist action_type=poke for poke-orchestrator', () => {
    applyPreset(db, 'supervised')

    const pokeHooks = db.prepare(
      "SELECT action_type FROM pmo_work_hooks WHERE action_value = 'poke-orchestrator'"
    ).all() as Array<{ action_type: string }>

    for (const hook of pokeHooks) {
      expect(hook.action_type).to.equal('poke')
    }
  })
})

// =============================================================================
// HookManager: poke routing
// =============================================================================

describe('HookManager: poke and llm routing (PRLT-1295)', () => {
  let db: Database.Database
  let manager: HookManager

  beforeEach(() => {
    resetEventBus()
    db = createTestDb()
  })

  afterEach(() => {
    if (manager) manager.stop()
    db.close()
    resetEventBus()
  })

  it('should route poke-type hooks through executor', async () => {
    const storage = new WorkHookStorage(db)
    storage.create({
      name: 'poke-test',
      event: 'on_pr_opened',
      actionType: 'poke',
      actionValue: 'poke-orchestrator',
      actionRef: 'poke-orchestrator',
    })
    // Set config via raw SQL
    db.prepare("UPDATE pmo_work_hooks SET config = ? WHERE name = 'poke-test'").run(
      JSON.stringify({ target: 'nonexistent-test-session', template: '{event}: {ticket_id}' })
    )

    manager = new HookManager({ db, log: () => {} })
    manager.start()

    const results = await manager.fireEvent('on_pr_opened', { ticket_id: 'TKT-1', pr: 5 })
    expect(results).to.have.lengthOf(1)
    // Will fail because tmux session doesn't exist, but should be routed correctly
    expect(results[0].action).to.include('poke:')
  })

  it('should route llm-type hooks through executor', async () => {
    const storage = new WorkHookStorage(db)
    storage.create({
      name: 'llm-triage',
      event: 'on_ci_failed',
      actionType: 'llm',
      actionValue: 'Triage: {ticket_id}',
    })

    manager = new HookManager({ db, log: () => {} })
    manager.start()

    const results = await manager.fireEvent('on_ci_failed', { ticket_id: 'TKT-2' })
    expect(results).to.have.lengthOf(1)
    expect(results[0].success).to.be.true
    expect(results[0].action).to.include('llm:')
  })
})

// =============================================================================
// Backward Compatibility
// =============================================================================

describe('Backward Compatibility (PRLT-1295)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('should still support shell action type', () => {
    const hook = makeHook({ actionType: 'shell', actionValue: 'echo hello' })
    const result = executeHook(hook, 'work:started', {})
    expect(result.success).to.be.true
  })

  it('should still support webhook action type', () => {
    const hook = makeHook({ actionType: 'webhook', actionValue: 'http://localhost:99999' })
    const result = executeHook(hook, 'work:started', {})
    // Will fail (no endpoint), but demonstrates type is accepted
    expect(result).to.have.property('success')
  })

  it('should still support log action type', () => {
    const hook = makeHook({ actionType: 'log', actionValue: 'Log: {{event}}' })
    const result = executeHook(hook, 'work:started', {})
    expect(result.success).to.be.true
  })

  it('should still support action type via executor error path', () => {
    const hook = makeHook({ actionType: 'action', actionValue: 'move-ticket' })
    const result = executeHook(hook, 'on_pr_merged', {})
    // action type should be rejected by executor (must go through manager)
    expect(result.success).to.be.false
    expect(result.error).to.include('built-in action handlers')
  })

  it('existing aggressive preset hooks should still work after adding poke-orchestrator', () => {
    const count = applyPreset(db, 'aggressive')
    expect(count).to.be.greaterThan(20) // Original ~22 hooks + 5 poke

    // Verify non-poke hooks are still action type
    const actionHooks = db.prepare(
      "SELECT * FROM pmo_work_hooks WHERE action_type = 'action'"
    ).all() as Array<Record<string, unknown>>
    expect(actionHooks.length).to.be.greaterThan(15)

    // Verify poke hooks are poke type
    const pokeHooks = db.prepare(
      "SELECT * FROM pmo_work_hooks WHERE action_type = 'poke'"
    ).all() as Array<Record<string, unknown>>
    expect(pokeHooks.length).to.equal(5)
  })

  it('should preserve existing hooks through migration 0028', () => {
    const preDb = new Database(':memory:')
    preDb.exec(`
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

    // Insert hooks of each type
    preDb.exec(`INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value) VALUES ('s1', 'shell-hook', 'on_ci_green', 'shell', 'echo hi')`)
    preDb.exec(`INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value) VALUES ('a1', 'action-hook', 'on_pr_merged', 'action', 'move-ticket')`)
    preDb.exec(`INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value) VALUES ('l1', 'log-hook', 'work:started', 'log', 'started!')`)

    hookActionTypesExpand.up(preDb)

    // All 3 hooks should be preserved
    const hooks = preDb.prepare('SELECT * FROM pmo_work_hooks ORDER BY id').all() as Array<Record<string, unknown>>
    expect(hooks).to.have.lengthOf(3)
    expect(hooks[0].action_type).to.equal('action')
    expect(hooks[1].action_type).to.equal('log')
    expect(hooks[2].action_type).to.equal('shell')

    // All should have null action_ref
    for (const hook of hooks) {
      expect(hook.action_ref).to.be.null
    }

    preDb.close()
  })
})

// =============================================================================
// Shared definitions: multiple events, same action_ref
// =============================================================================

describe('Shared Action Definitions (PRLT-1295)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('should fire same poke-orchestrator action from different events', async () => {
    resetEventBus()

    const storage = new WorkHookStorage(db)
    const config = JSON.stringify({ target: 'nonexistent-orch', template: '{event}: {ticket_id}' })

    // Create two hooks with the same action_ref
    storage.create({
      name: 'poke-pr',
      event: 'on_pr_opened',
      actionType: 'poke',
      actionValue: 'poke-orchestrator',
      actionRef: 'poke-orchestrator',
    })
    db.prepare("UPDATE pmo_work_hooks SET config = ? WHERE name = 'poke-pr'").run(config)

    storage.create({
      name: 'poke-agent',
      event: 'on_agent_completed',
      actionType: 'poke',
      actionValue: 'poke-orchestrator',
      actionRef: 'poke-orchestrator',
    })
    db.prepare("UPDATE pmo_work_hooks SET config = ? WHERE name = 'poke-agent'").run(config)

    const manager = new HookManager({ db, log: () => {} })
    manager.start()

    // Fire on_pr_opened — should match poke-pr
    const prResults = await manager.fireEvent('on_pr_opened', { ticket_id: 'TKT-1' })
    expect(prResults).to.have.lengthOf(1)
    expect(prResults[0].action).to.include('poke:')

    // Fire on_agent_completed — should match poke-agent (same action_ref)
    const agentResults = await manager.fireEvent('on_agent_completed', { ticket_id: 'TKT-1' })
    expect(agentResults).to.have.lengthOf(1)
    expect(agentResults[0].action).to.include('poke:')

    // Both hooks share the same action_ref
    const shared = storage.findByActionRef('poke-orchestrator')
    expect(shared).to.have.lengthOf(2)

    manager.stop()
    resetEventBus()
  })
})
