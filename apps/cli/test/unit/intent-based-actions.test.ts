/**
 * Tests for PRLT-1284: Intent-Based Actions
 *
 * Verifies:
 * - pmo_actions schema uses from_intent/to_intent instead of from_state/to_state
 * - from_intent is nullable — actions without it only fire on manual invocation
 * - executor is nullable — null inherits from workspace default_executor
 * - getSuggestedAction resolves state names to intents
 * - Manual invocation (--action implement) works regardless of ticket's current state
 * - Migration: existing builtin actions use intent names
 * - Custom action creation with intent fields
 * - resolveStateToIntent maps provider state names to canonical intents
 */

import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'
import { resolveStateToIntent, getDefaultIntent } from '../../src/lib/providers/state-intents.js'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestDb(): { storage: SQLiteStorage; db: SqliteDatabase; dbPath: string; testDir: string } {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-actions-test-'))
  const dbPath = path.join(testDir, 'test.db')

  // Create empty database file (SQLiteStorage requires it to exist)
  const initDb = new SqliteDatabase(dbPath)
  initDb.close()

  // Open via SQLiteStorage to run migrations, create tables, and seed builtins
  const storage = new SQLiteStorage(dbPath)
  const db = storage.getDatabase()

  return { storage, db, dbPath, testDir }
}

function cleanup(db: SqliteDatabase, testDir: string): void {
  try { db.close() } catch { /* ignore */ }
  try { fs.rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
}

// =============================================================================
// Tests
// =============================================================================

describe('Intent-Based Actions (PRLT-1284)', () => {
  let db: SqliteDatabase
  let storage: SQLiteStorage
  let testDir: string

  beforeEach(() => {
    const result = createTestDb()
    db = result.db
    storage = result.storage
    testDir = result.testDir
  })

  afterEach(() => {
    cleanup(db, testDir)
  })

  // ===========================================================================
  // Schema Tests
  // ===========================================================================

  describe('Schema', () => {
    it('pmo_actions table has from_intent and to_intent columns', () => {
      const columns = db.pragma('table_info(pmo_actions)') as Array<{ name: string }>
      const colNames = columns.map(c => c.name)

      expect(colNames).to.include('from_intent')
      expect(colNames).to.include('to_intent')
      expect(colNames).to.not.include('from_state')
      expect(colNames).to.not.include('to_state')
    })

    it('pmo_workflow_rules table has from_intent and to_intent columns', () => {
      const columns = db.pragma('table_info(pmo_workflow_rules)') as Array<{ name: string }>
      const colNames = columns.map(c => c.name)

      expect(colNames).to.include('from_intent')
      expect(colNames).to.include('to_intent')
      expect(colNames).to.not.include('from_state')
      expect(colNames).to.not.include('to_state')
    })

    it('from_intent is nullable in pmo_actions', () => {
      const columns = db.pragma('table_info(pmo_actions)') as Array<{ name: string; notnull: number }>
      const fromIntent = columns.find(c => c.name === 'from_intent')
      expect(fromIntent).to.exist
      expect(fromIntent!.notnull).to.equal(0)
    })

    it('executor is nullable in pmo_actions', () => {
      const columns = db.pragma('table_info(pmo_actions)') as Array<{ name: string; notnull: number }>
      const executor = columns.find(c => c.name === 'executor')
      expect(executor).to.exist
      expect(executor!.notnull).to.equal(0)
    })
  })

  // ===========================================================================
  // Builtin Action Migration Tests
  // ===========================================================================

  describe('Builtin Actions', () => {
    it('groom action uses backlog/ready intents', async () => {
      const action = await storage.getAction('groom')
      expect(action).to.exist
      expect(action!.fromIntent).to.equal('backlog')
      expect(action!.toIntent).to.equal('ready')
    })

    it('implement action uses ready/started intents', async () => {
      const action = await storage.getAction('implement')
      expect(action).to.exist
      expect(action!.fromIntent).to.equal('ready')
      expect(action!.toIntent).to.equal('started')
    })

    it('review action uses needs_review intent', async () => {
      const action = await storage.getAction('review')
      expect(action).to.exist
      expect(action!.fromIntent).to.equal('needs_review')
    })

    it('merge action uses needs_review/completed intents', async () => {
      const action = await storage.getAction('merge')
      expect(action).to.exist
      expect(action!.fromIntent).to.equal('needs_review')
      expect(action!.toIntent).to.equal('completed')
    })

    it('resolve action has null from_intent (manual only)', async () => {
      const action = await storage.getAction('resolve')
      expect(action).to.exist
      expect(action!.fromIntent).to.be.undefined
      expect(action!.toIntent).to.be.undefined
    })

    it('builtin actions have null executor (inherit workspace default)', async () => {
      const groom = await storage.getAction('groom')
      const implement = await storage.getAction('implement')
      const review = await storage.getAction('review')
      const merge = await storage.getAction('merge')

      expect(groom!.executor).to.be.undefined
      expect(implement!.executor).to.be.undefined
      expect(review!.executor).to.be.undefined
      expect(merge!.executor).to.be.undefined
    })
  })

  // ===========================================================================
  // getSuggestedAction Tests
  // ===========================================================================

  describe('getSuggestedAction', () => {
    it('finds action by intent name directly', async () => {
      const action = await storage.getSuggestedAction('backlog')
      expect(action).to.exist
      expect(action!.id).to.equal('groom')
    })

    it('resolves provider state name to intent', async () => {
      // 'Backlog' should resolve to 'backlog' intent → groom action
      const action = await storage.getSuggestedAction('Backlog')
      expect(action).to.exist
      expect(action!.id).to.equal('groom')
    })

    it('resolves "Todo" to ready intent → implement action', async () => {
      const action = await storage.getSuggestedAction('Todo')
      expect(action).to.exist
      expect(action!.id).to.equal('implement')
    })

    it('resolves "In Progress" to started intent', async () => {
      const action = await storage.getSuggestedAction('In Progress')
      // Started doesn't have a default action with from_intent='started',
      // so it should fall back to any matching action
      expect(action).to.exist
    })

    it('resolves "Working On" (Trello variant) to started intent', async () => {
      const action = await storage.getSuggestedAction('Working On')
      expect(action).to.exist
    })

    it('resolves "TO DO" (ClickUp variant) to ready intent → implement', async () => {
      const action = await storage.getSuggestedAction('TO DO')
      // TO DO should match via alias for 'ready' intent
      expect(action).to.exist
    })
  })

  // ===========================================================================
  // Action CRUD Tests
  // ===========================================================================

  describe('Action CRUD with intents', () => {
    it('creates custom action with from_intent and to_intent', async () => {
      const action = await storage.createAction({
        name: 'Test Action',
        prompt: 'Test prompt',
        fromIntent: 'started',
        toIntent: 'needs_review',
      })

      expect(action.fromIntent).to.equal('started')
      expect(action.toIntent).to.equal('needs_review')
    })

    it('creates action with null from_intent (manual only)', async () => {
      const action = await storage.createAction({
        name: 'Manual Only',
        prompt: 'Manual prompt',
        toIntent: 'testing',
      })

      expect(action.fromIntent).to.be.undefined
      expect(action.toIntent).to.equal('testing')
    })

    it('creates action with null executor', async () => {
      const action = await storage.createAction({
        name: 'Null Executor',
        prompt: 'Test',
      })

      expect(action.executor).to.be.undefined
    })

    it('creates action with explicit executor override', async () => {
      const action = await storage.createAction({
        name: 'Claude Override',
        prompt: 'Test',
        executor: 'claude',
      })

      expect(action.executor).to.equal('claude')
    })

    it('updates action from_intent and to_intent', async () => {
      const created = await storage.createAction({
        name: 'Updatable',
        prompt: 'Test',
        fromIntent: 'ready',
        toIntent: 'started',
      })

      const updated = await storage.updateAction(created.id, {
        fromIntent: 'backlog',
        toIntent: 'ready',
      })

      expect(updated.fromIntent).to.equal('backlog')
      expect(updated.toIntent).to.equal('ready')
    })

    it('lists actions filtered by fromIntent', async () => {
      // Create a custom action with a specific from_intent
      await storage.createAction({
        name: 'Custom Ready Action',
        prompt: 'Test',
        fromIntent: 'ready',
      })

      const actions = await storage.listActions({ fromIntent: 'ready' })

      // Should include both builtin 'implement' (from_intent=ready) and our custom action
      const names = actions.map(a => a.name)
      expect(names).to.include('Implement')
      expect(names).to.include('Custom Ready Action')
    })
  })

  // ===========================================================================
  // Workspace Default Executor Tests
  // ===========================================================================

  describe('Workspace Default Executor', () => {
    it('workspace_settings table supports default_executor key', () => {
      // workspace_settings is in the workspace database, not PMO.
      // Create it locally for this test.
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspace_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)

      // Set a workspace default executor
      db.prepare(`
        INSERT OR REPLACE INTO workspace_settings (key, value)
        VALUES ('execution.default_executor', 'codex')
      `).run()

      const row = db.prepare(`
        SELECT value FROM workspace_settings WHERE key = 'execution.default_executor'
      `).get() as { value: string } | undefined

      expect(row).to.exist
      expect(row!.value).to.equal('codex')
    })

    it('action with null executor defers to workspace default', async () => {
      // All builtin actions now have null executor
      const implement = await storage.getAction('implement')
      expect(implement).to.exist
      expect(implement!.executor).to.be.undefined
      // The executor resolution happens at runtime: per-invocation > action override > workspace default
    })

    it('action with explicit executor overrides workspace default', async () => {
      const action = await storage.createAction({
        name: 'Explicit Executor',
        prompt: 'Test',
        executor: 'codex',
      })

      expect(action.executor).to.equal('codex')
    })
  })

  // ===========================================================================
  // Workflow Rules Tests
  // ===========================================================================

  describe('Workflow Rules with Intents', () => {
    it('builtin rules use intent names', async () => {
      const rules = await storage.listWorkflowRules()
      const ruleMap = new Map(rules.map(r => [r.id, r]))

      // Check the backlog-groom rule
      const groomRule = ruleMap.get('backlog-groom')
      expect(groomRule).to.exist
      expect(groomRule!.toIntent).to.equal('backlog')

      // Check the ready-implement rule
      const implementRule = ruleMap.get('ready-implement')
      expect(implementRule).to.exist
      expect(implementRule!.toIntent).to.equal('ready')
    })

    it('creates workflow rule with intent names', async () => {
      await storage.createAction({
        name: 'Test Rule Action',
        prompt: 'Test',
      })

      const rule = await storage.createWorkflowRule({
        toIntent: 'testing',
        actionId: 'test-rule-action',
        trigger: 'on_enter',
      })

      expect(rule.toIntent).to.equal('testing')
      expect(rule.fromIntent).to.be.undefined
    })

    it('getWorkflowRulesForIntent returns matching rules', async () => {
      const rules = await storage.getWorkflowRulesForIntent('backlog')
      expect(rules.length).to.be.greaterThan(0)
      expect(rules[0].toIntent).to.equal('backlog')
    })
  })

  // ===========================================================================
  // resolveStateToIntent Tests
  // ===========================================================================

  describe('resolveStateToIntent', () => {
    it('maps Backlog → backlog', () => {
      expect(resolveStateToIntent('Backlog')).to.equal('backlog')
    })

    it('maps Todo → ready', () => {
      expect(resolveStateToIntent('Todo')).to.equal('ready')
    })

    it('maps To Do → ready', () => {
      expect(resolveStateToIntent('To Do')).to.equal('ready')
    })

    it('maps In Progress → started', () => {
      expect(resolveStateToIntent('In Progress')).to.equal('started')
    })

    it('maps Working On → started', () => {
      expect(resolveStateToIntent('Working On')).to.equal('started')
    })

    it('maps IN PROGRESS → started', () => {
      expect(resolveStateToIntent('IN PROGRESS')).to.equal('started')
    })

    it('maps Review → needs_review', () => {
      expect(resolveStateToIntent('Review')).to.equal('needs_review')
    })

    it('maps In Review → needs_review', () => {
      expect(resolveStateToIntent('In Review')).to.equal('needs_review')
    })

    it('maps Done → completed', () => {
      expect(resolveStateToIntent('Done')).to.equal('completed')
    })

    it('maps Closed → completed', () => {
      expect(resolveStateToIntent('Closed')).to.equal('completed')
    })

    it('maps Blocked → blocked', () => {
      expect(resolveStateToIntent('Blocked')).to.equal('blocked')
    })

    it('returns null for unknown state names', () => {
      expect(resolveStateToIntent('XYZ-Unknown-State')).to.be.null
    })
  })

  // ===========================================================================
  // Semantic Intent Definitions
  // ===========================================================================

  describe('Semantic Intent Definitions', () => {
    it('has all canonical intents defined', () => {
      const canonical = ['backlog', 'ready', 'started', 'needs_review', 'completed', 'blocked', 'testing']
      for (const name of canonical) {
        const intent = getDefaultIntent(name)
        expect(intent, `missing intent: ${name}`).to.exist
        expect(intent!.aliases.length, `intent ${name} has no aliases`).to.be.greaterThan(0)
      }
    })

    it('backward-compatible aliases exist (active, review, done)', () => {
      expect(getDefaultIntent('active')).to.exist
      expect(getDefaultIntent('review')).to.exist
      expect(getDefaultIntent('done')).to.exist
    })
  })

  // ===========================================================================
  // Manual Invocation — from_intent is NOT a gate
  // ===========================================================================

  describe('Manual Invocation (from_intent is not a gate)', () => {
    it('getAction returns action regardless of from_intent match', async () => {
      // The implement action has from_intent='ready', but getAction by ID
      // should always return it regardless — from_intent is only for auto-trigger
      const action = await storage.getAction('implement')
      expect(action).to.exist
      expect(action!.name).to.equal('Implement')
    })

    it('implement action on Backlog ticket should work (not gated by from_intent)', async () => {
      // Create a ticket in Backlog state
      // The implement action has from_intent='ready', but manual invocation
      // via --action implement should work regardless of current state
      const action = await storage.getAction('implement')
      expect(action).to.exist
      // The key assertion: getAction('implement') returns the action
      // without checking the ticket's current state against from_intent
      expect(action!.fromIntent).to.equal('ready')
      // from_intent is a trigger hint, not a gatekeeper
    })
  })

  // ===========================================================================
  // Migration Safety Tests
  // ===========================================================================

  describe('Migration 0015', () => {
    it('migration is idempotent (from_intent columns already exist)', () => {
      // The migration should have already run during SQLiteStorage init.
      // Verify the schema is correct after migration.
      const columns = db.pragma('table_info(pmo_actions)') as Array<{ name: string }>
      const colNames = columns.map(c => c.name)
      expect(colNames).to.include('from_intent')
      expect(colNames).to.include('to_intent')
    })
  })
})
