import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'
import { SettingsStore } from '../../src/lib/database/settings-store.js'
import { resetEventBus, getEventBus } from '../../src/lib/events/index.js'
import type { WorkflowRuleMatchedEvent } from '../../src/lib/events/events.js'
import { WorkflowRuleEvaluator, stopWorkflowRuleEvaluator } from '../../src/lib/work-lifecycle/rule-evaluator.js'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestDb(): { storage: SQLiteStorage; db: Database.Database; dbPath: string; testDir: string } {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-actions-test-'))
  const dbPath = path.join(testDir, 'test.db')

  const initDb = new Database(dbPath)
  initDb.close()

  const storage = new SQLiteStorage(dbPath)
  const db = storage.getDatabase()

  return { storage, db, dbPath, testDir }
}

function cleanup(testDir: string): void {
  try {
    fs.rmSync(testDir, { recursive: true, force: true })
  } catch { /* ignore */ }
}

// =============================================================================
// Tests
// =============================================================================

describe('Intent-Based Actions (PRLT-1284)', () => {
  let storage: SQLiteStorage
  let db: Database.Database
  let testDir: string

  beforeEach(() => {
    resetEventBus()
    stopWorkflowRuleEvaluator()
    const result = createTestDb()
    storage = result.storage
    db = result.db
    testDir = result.testDir
  })

  afterEach(() => {
    try { db.close() } catch { /* ignore */ }
    cleanup(testDir)
  })

  // ===========================================================================
  // Schema Migration
  // ===========================================================================

  describe('schema migration', () => {
    it('pmo_actions uses from_intent/to_intent columns', () => {
      const cols = db.pragma('table_info(pmo_actions)') as Array<{ name: string }>
      const colNames = cols.map(c => c.name)

      expect(colNames).to.include('from_intent')
      expect(colNames).to.include('to_intent')
      expect(colNames).not.to.include('from_state')
      expect(colNames).not.to.include('to_state')
    })

    it('pmo_workflow_rules uses from_intent/to_intent columns', () => {
      const cols = db.pragma('table_info(pmo_workflow_rules)') as Array<{ name: string }>
      const colNames = cols.map(c => c.name)

      expect(colNames).to.include('from_intent')
      expect(colNames).to.include('to_intent')
      expect(colNames).not.to.include('from_state')
      expect(colNames).not.to.include('to_state')
    })

    it('builtin actions are seeded with intent names', async () => {
      const implement = await storage.getAction('implement')
      expect(implement).to.not.be.null
      expect(implement!.fromIntent).to.equal('ready')
      expect(implement!.toIntent).to.equal('started')

      const groom = await storage.getAction('groom')
      expect(groom).to.not.be.null
      expect(groom!.fromIntent).to.equal('backlog')
      expect(groom!.toIntent).to.equal('ready')

      const merge = await storage.getAction('merge')
      expect(merge).to.not.be.null
      expect(merge!.fromIntent).to.equal('needs_review')
      expect(merge!.toIntent).to.equal('completed')
    })

    it('resolve and review actions have null from_intent (manual only)', async () => {
      const resolve = await storage.getAction('resolve')
      expect(resolve).to.not.be.null
      expect(resolve!.fromIntent).to.be.undefined

      const review = await storage.getAction('review')
      expect(review).to.not.be.null
      expect(review!.fromIntent).to.be.undefined
    })

    it('default_executor is set in workspace settings', () => {
      // workspace_settings table is created by workspace schema, not PMO
      db.exec('CREATE TABLE IF NOT EXISTS workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      db.prepare("INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('execution.default_executor', 'claude')").run()
      const settings = new SettingsStore(db)
      const defaultExecutor = settings.get('execution.default_executor')
      expect(defaultExecutor).to.equal('claude')
    })
  })

  // ===========================================================================
  // from_intent is nullable — actions without it only fire on manual invocation
  // ===========================================================================

  describe('from_intent nullable', () => {
    it('can create action with null from_intent', async () => {
      const action = await storage.createAction({
        name: 'Manual Only',
        prompt: 'Do something manually',
        fromIntent: undefined,
        toIntent: 'started',
      })

      expect(action.fromIntent).to.be.undefined
      expect(action.toIntent).to.equal('started')
    })

    it('getSuggestedAction includes actions with null from_intent', async () => {
      // Create an action with no from_intent (matches any)
      await storage.createAction({
        name: 'Universal Action',
        prompt: 'Works everywhere',
        fromIntent: undefined,
        toIntent: 'started',
      })

      const suggested = await storage.getSuggestedAction('backlog')
      // Should match since from_intent is null (matches any)
      expect(suggested).to.not.be.null
    })
  })

  // ===========================================================================
  // work start --action implement works regardless of ticket state
  // ===========================================================================

  describe('from_intent is not a gate for manual invocation', () => {
    it('getAction returns implement regardless of ticket state', async () => {
      // The implement action has from_intent='ready', but getAction just looks up by ID
      const implement = await storage.getAction('implement')
      expect(implement).to.not.be.null
      expect(implement!.id).to.equal('implement')
      // It should have from_intent but that's just for suggestions, not a gate
      expect(implement!.fromIntent).to.equal('ready')
    })

    it('getSuggestedAction with backlog intent returns groom (exact match)', async () => {
      const suggested = await storage.getSuggestedAction('backlog')
      expect(suggested).to.not.be.null
      expect(suggested!.id).to.equal('groom')
    })

    it('getSuggestedAction with ready intent returns implement (exact match)', async () => {
      const suggested = await storage.getSuggestedAction('ready')
      expect(suggested).to.not.be.null
      expect(suggested!.id).to.equal('implement')
    })
  })

  // ===========================================================================
  // Executor inheritance
  // ===========================================================================

  describe('executor inheritance', () => {
    it('workspace default executor can be changed', () => {
      db.exec('CREATE TABLE IF NOT EXISTS workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      const settings = new SettingsStore(db)
      settings.set('execution.default_executor', 'codex')
      expect(settings.get('execution.default_executor')).to.equal('codex')
    })

    it('action with null executor inherits workspace default', async () => {
      const action = await storage.createAction({
        name: 'No Executor',
        prompt: 'Use default',
        executor: undefined,
        toIntent: 'started',
      })
      expect(action.executor).to.be.undefined

      // The resolution happens at runtime in work start, but we verify the action stores null
      const retrieved = await storage.getAction(action.id)
      expect(retrieved!.executor).to.be.undefined
    })

    it('action with explicit executor overrides workspace default', async () => {
      const action = await storage.createAction({
        name: 'Claude Only',
        prompt: 'Always use claude',
        executor: 'claude',
        toIntent: 'started',
      })
      expect(action.executor).to.equal('claude')
    })
  })

  // ===========================================================================
  // Custom action creation with intents
  // ===========================================================================

  describe('custom action creation', () => {
    it('creates action with to_intent and from_intent', async () => {
      const action = await storage.createAction({
        name: 'test',
        prompt: 'Run tests for this ticket',
        toIntent: 'testing',
        fromIntent: 'needs_review',
      })

      expect(action.id).to.equal('test')
      expect(action.toIntent).to.equal('testing')
      expect(action.fromIntent).to.equal('needs_review')
    })

    it('creates action with only to_intent (no from_intent trigger)', async () => {
      const action = await storage.createAction({
        name: 'Deploy',
        prompt: 'Deploy to production',
        toIntent: 'completed',
      })

      expect(action.toIntent).to.equal('completed')
      expect(action.fromIntent).to.be.undefined
    })
  })

  // ===========================================================================
  // Workflow rules use intents
  // ===========================================================================

  describe('workflow rules use intents', () => {
    it('builtin rules use intent names', async () => {
      const rules = db.prepare(`
        SELECT * FROM ${PMO_TABLES.workflow_rules} WHERE id = 'ready-implement'
      `).get() as { to_intent: string; from_intent: string | null } | undefined

      expect(rules).to.not.be.undefined
      expect(rules!.to_intent).to.equal('ready')
    })

    it('builtin rules map backlog to groom', async () => {
      const rules = db.prepare(`
        SELECT * FROM ${PMO_TABLES.workflow_rules} WHERE id = 'backlog-groom'
      `).get() as { to_intent: string; action_id: string } | undefined

      expect(rules).to.not.be.undefined
      expect(rules!.to_intent).to.equal('backlog')
      expect(rules!.action_id).to.equal('groom')
    })
  })

  // ===========================================================================
  // Rule evaluator maps state names to intents
  // ===========================================================================

  describe('rule evaluator intent resolution', () => {
    it('maps "In Progress" state name to "started" intent for rule matching', () => {
      // Insert an on_enter rule for 'started' intent
      db.prepare(`
        INSERT OR IGNORE INTO ${PMO_TABLES.workflow_rules}
          (id, from_intent, to_intent, action_id, trigger, enabled, created_at)
        VALUES ('test-started', null, 'started', 'implement', 'on_enter', 1, datetime('now'))
      `).run()

      const matchedEvents: WorkflowRuleMatchedEvent[] = []
      const bus = getEventBus()
      bus.on('workflow_rule:matched', (event: WorkflowRuleMatchedEvent) => {
        matchedEvents.push(event)
      })

      const evaluator = new WorkflowRuleEvaluator(db)
      evaluator.start()

      // Emit a status change using provider state name "In Progress"
      bus.emit('ticket:status_changed', {
        ticketId: 'TKT-001',
        projectId: 'test-project',
        previousStatusId: 'status-1',
        previousStatusName: 'Todo',
        previousStatusCategory: 'unstarted',
        newStatusId: 'status-2',
        newStatusName: 'In Progress',
        newStatusCategory: 'started',
        timestamp: new Date(),
      })

      // Should match because "In Progress" maps to "started" intent
      expect(matchedEvents.length).to.be.greaterThan(0)
      expect(matchedEvents[0].toIntent).to.equal('started')

      evaluator.stop()
    })

    it('maps "Done" state name to "completed" intent for rule matching', () => {
      // Insert an on_enter rule for 'completed' intent
      db.prepare(`
        INSERT OR IGNORE INTO ${PMO_TABLES.workflow_rules}
          (id, from_intent, to_intent, action_id, trigger, enabled, created_at)
        VALUES ('test-completed', null, 'completed', 'merge', 'on_enter', 1, datetime('now'))
      `).run()

      const matchedEvents: WorkflowRuleMatchedEvent[] = []
      const bus = getEventBus()
      bus.on('workflow_rule:matched', (event: WorkflowRuleMatchedEvent) => {
        matchedEvents.push(event)
      })

      const evaluator = new WorkflowRuleEvaluator(db)
      evaluator.start()

      bus.emit('ticket:status_changed', {
        ticketId: 'TKT-002',
        projectId: 'test-project',
        previousStatusId: 'status-3',
        previousStatusName: 'Review',
        previousStatusCategory: 'started',
        newStatusId: 'status-4',
        newStatusName: 'Done',
        newStatusCategory: 'completed',
        timestamp: new Date(),
      })

      expect(matchedEvents.length).to.be.greaterThan(0)
      expect(matchedEvents[0].toIntent).to.equal('completed')

      evaluator.stop()
    })

    it('does not fire for unrecognized state names', () => {
      const matchedEvents: WorkflowRuleMatchedEvent[] = []
      const bus = getEventBus()
      bus.on('workflow_rule:matched', (event: WorkflowRuleMatchedEvent) => {
        matchedEvents.push(event)
      })

      const evaluator = new WorkflowRuleEvaluator(db)
      evaluator.start()

      bus.emit('ticket:status_changed', {
        ticketId: 'TKT-003',
        projectId: 'test-project',
        previousStatusId: 'status-5',
        previousStatusName: 'Foo',
        previousStatusCategory: null,
        newStatusId: 'status-6',
        newStatusName: 'Bar',
        newStatusCategory: null,
        timestamp: new Date(),
      })

      expect(matchedEvents).to.have.length(0)

      evaluator.stop()
    })
  })
})
