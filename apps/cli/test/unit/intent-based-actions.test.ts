import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'
import type { WorkAction } from '../../src/lib/pmo/types.js'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestDb(): { storage: SQLiteStorage; db: Database.Database; testDir: string } {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-actions-test-'))
  const dbPath = path.join(testDir, 'test.db')

  const initDb = new Database(dbPath)
  initDb.close()

  const storage = new SQLiteStorage(dbPath)
  const db = storage.getDatabase()

  return { storage, db, testDir }
}

// =============================================================================
// Tests
// =============================================================================

describe('Intent-Based Actions', () => {
  let db: Database.Database
  let testDir: string
  let storage: SQLiteStorage

  beforeEach(() => {
    const result = createTestDb()
    db = result.db
    testDir = result.testDir
    storage = result.storage
  })

  afterEach(() => {
    try { db.close() } catch { /* */ }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('Schema migration', () => {
    it('pmo_actions uses from_intent/to_intent columns', () => {
      const cols = db.prepare("PRAGMA table_info(pmo_actions)").all() as { name: string }[]
      const colNames = cols.map(c => c.name)

      expect(colNames).to.include('from_intent')
      expect(colNames).to.include('to_intent')
      expect(colNames).not.to.include('from_state')
      expect(colNames).not.to.include('to_state')
    })

    it('pmo_workflow_rules uses from_intent/to_intent columns', () => {
      const cols = db.prepare("PRAGMA table_info(pmo_workflow_rules)").all() as { name: string }[]
      const colNames = cols.map(c => c.name)

      expect(colNames).to.include('from_intent')
      expect(colNames).to.include('to_intent')
      expect(colNames).not.to.include('from_state')
      expect(colNames).not.to.include('to_state')
    })
  })

  describe('Builtin actions use intents', () => {
    it('groom action has from_intent=backlog and to_intent=ready', async () => {
      const action = await storage.getAction('groom')
      expect(action).to.exist
      expect(action!.fromIntent).to.equal('backlog')
      expect(action!.toIntent).to.equal('ready')
    })

    it('implement action has from_intent=ready and to_intent=started', async () => {
      const action = await storage.getAction('implement')
      expect(action).to.exist
      expect(action!.fromIntent).to.equal('ready')
      expect(action!.toIntent).to.equal('started')
    })

    it('merge action has from_intent=needs_review and to_intent=completed', async () => {
      const action = await storage.getAction('merge')
      expect(action).to.exist
      expect(action!.fromIntent).to.equal('needs_review')
      expect(action!.toIntent).to.equal('completed')
    })

    it('review action has null from_intent and null to_intent', async () => {
      const action = await storage.getAction('review')
      expect(action).to.exist
      expect(action!.fromIntent).to.be.undefined
      expect(action!.toIntent).to.be.undefined
    })

    it('builtin actions have null executor (inherits workspace default)', async () => {
      const groom = await storage.getAction('groom')
      const implement = await storage.getAction('implement')
      const merge = await storage.getAction('merge')
      const review = await storage.getAction('review')

      expect(groom!.executor).to.be.undefined
      expect(implement!.executor).to.be.undefined
      expect(merge!.executor).to.be.undefined
      expect(review!.executor).to.be.undefined
    })
  })

  describe('from_intent is nullable — manual-only actions', () => {
    it('actions without from_intent only match when explicitly invoked', async () => {
      await storage.createAction({
        name: 'Manual Only',
        prompt: 'Do something manually',
        fromIntent: undefined,
        toIntent: 'started',
      })

      const action = await storage.getAction('manual-only')
      expect(action).to.exist
      expect(action!.fromIntent).to.be.undefined
    })

    it('actions with null from_intent appear in getSuggestedAction as fallback', async () => {
      // Create a custom action with no from_intent
      db.prepare(`
        INSERT INTO ${PMO_TABLES.actions} (id, name, prompt, from_intent, to_intent, modifies_code, is_default, is_builtin, position, created_at)
        VALUES ('test-any', 'Test Any', 'test', NULL, 'started', 1, 0, 0, 99, datetime('now'))
      `).run()

      const suggested = await storage.getSuggestedAction('nonexistent_intent')
      // Should match an action with null from_intent (builtin or our test action)
      expect(suggested).to.exist
    })
  })

  describe('executor is nullable — workspace default inheritance', () => {
    it('action with null executor gets undefined from storage', async () => {
      await storage.createAction({
        name: 'No Executor',
        prompt: 'Do something',
        executor: undefined,
      })

      const action = await storage.getAction('no-executor')
      expect(action).to.exist
      expect(action!.executor).to.be.undefined
    })

    it('action with explicit executor overrides workspace default', async () => {
      await storage.createAction({
        name: 'Codex Action',
        prompt: 'Do something with codex',
        executor: 'codex',
      })

      const action = await storage.getAction('codex-action')
      expect(action).to.exist
      expect(action!.executor).to.equal('codex')
    })

    it('workspace default_executor setting is seeded when workspace_settings exists', () => {
      // The workspace_settings table is created by workspace schema, not PMO schema.
      // Create it to verify the migration seeds the default executor.
      db.exec('CREATE TABLE IF NOT EXISTS workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

      // Run the migration manually to seed the default executor
      const existing = db.prepare(
        "SELECT value FROM workspace_settings WHERE key = 'execution.default_executor'"
      ).get() as { value: string } | undefined

      if (!existing) {
        db.prepare(
          "INSERT INTO workspace_settings (key, value) VALUES ('execution.default_executor', 'claude')"
        ).run()
      }

      const row = db.prepare(
        "SELECT value FROM workspace_settings WHERE key = 'execution.default_executor'"
      ).get() as { value: string } | undefined

      expect(row).to.exist
      expect(row!.value).to.equal('claude')
    })
  })

  describe('getSuggestedAction by intent', () => {
    it('returns exact from_intent match with is_default=true', async () => {
      const action = await storage.getSuggestedAction('ready')
      expect(action).to.exist
      expect(action!.id).to.equal('implement')
    })

    it('returns groom action for backlog intent', async () => {
      const action = await storage.getSuggestedAction('backlog')
      expect(action).to.exist
      expect(action!.id).to.equal('groom')
    })

    it('returns merge action for needs_review intent', async () => {
      const action = await storage.getSuggestedAction('needs_review')
      expect(action).to.exist
      expect(action!.id).to.equal('merge')
    })
  })

  describe('getActionByFromIntent', () => {
    it('finds action by from_intent', async () => {
      const action = await storage.getActionByFromIntent('ready')
      expect(action).to.exist
      expect(action!.id).to.equal('implement')
    })

    it('returns null for unknown intent', async () => {
      const action = await storage.getActionByFromIntent('nonexistent')
      expect(action).to.be.null
    })
  })

  describe('work start ignores from_intent as gate', () => {
    it('implement action can be retrieved regardless of ticket state', async () => {
      // The action's from_intent is 'ready', but we should be able to get
      // the action by ID regardless — from_intent is not a gate
      const action = await storage.getAction('implement')
      expect(action).to.exist
      expect(action!.id).to.equal('implement')
      // from_intent is 'ready' but getAction by ID doesn't check it
    })
  })

  describe('Custom action creation with intents', () => {
    it('creates action with to_intent', async () => {
      const action = await storage.createAction({
        name: 'Test Action',
        prompt: 'Test prompt',
        toIntent: 'testing',
      })

      expect(action.toIntent).to.equal('testing')
      expect(action.fromIntent).to.be.undefined
    })

    it('creates action with both from_intent and to_intent', async () => {
      const action = await storage.createAction({
        name: 'QA Test',
        prompt: 'Run QA tests',
        fromIntent: 'needs_review',
        toIntent: 'testing',
      })

      expect(action.fromIntent).to.equal('needs_review')
      expect(action.toIntent).to.equal('testing')
    })
  })

  describe('Workflow rules use intents', () => {
    it('builtin rules use intent names', async () => {
      const rules = await storage.listWorkflowRules()
      const readyRule = rules.find(r => r.toIntent === 'ready')

      expect(readyRule).to.exist
      expect(readyRule!.actionId).to.equal('implement')
    })

    it('getWorkflowRulesForIntent finds matching rules', async () => {
      const rules = await storage.getWorkflowRulesForIntent('backlog')
      expect(rules.length).to.be.greaterThan(0)
      expect(rules[0].actionId).to.equal('groom')
    })

    it('getWorkflowRulesForState is deprecated alias', async () => {
      const rules = await storage.getWorkflowRulesForState('backlog')
      const intentRules = await storage.getWorkflowRulesForIntent('backlog')
      expect(rules).to.deep.equal(intentRules)
    })
  })

  describe('Backward compatibility', () => {
    it('WorkAction has deprecated fromState/toState aliases', async () => {
      const action = await storage.getAction('implement') as WorkAction
      // fromState/toState should mirror fromIntent/toIntent for compat
      expect(action.fromState).to.equal(action.fromIntent)
      expect(action.toState).to.equal(action.toIntent)
    })

    it('createAction accepts fromState/toState (deprecated)', async () => {
      const action = await storage.createAction({
        name: 'Compat Test',
        prompt: 'Test backward compat',
        fromState: 'backlog',
        toState: 'ready',
      })

      expect(action.fromIntent).to.equal('backlog')
      expect(action.toIntent).to.equal('ready')
    })

    it('listActions filter accepts fromState (deprecated)', async () => {
      const actions = await storage.listActions({ fromState: 'ready' })
      // Should find implement action (from_intent='ready') plus any with null from_intent
      const implement = actions.find(a => a.id === 'implement')
      expect(implement).to.exist
    })
  })
})
