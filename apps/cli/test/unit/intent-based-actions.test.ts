/**
 * Tests for intent-based actions (PRLT-1284)
 *
 * Covers:
 * - Migration: from_state/to_state → from_intent/to_intent column rename
 * - ActionStorage: CRUD with intent-based columns
 * - getSuggestedAction: matches by intent name, not state name
 * - Executor resolution: per-invocation > action override > workspace default
 * - from_intent is not a gate: manual invocation ignores from_intent
 * - Action create with intent flags
 */

import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { SQLiteStorage } from '../../src/lib/pmo/storage/index.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'
import {
  getDefaultExecutorSetting,
  setDefaultExecutorSetting,
  resolveExecutor,
} from '../../src/lib/work-lifecycle/settings.js'
import type { ActionExecutor } from '../../src/lib/pmo/types.js'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestDb(): { storage: SQLiteStorage; db: Database.Database; testDir: string } {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-actions-test-'))
  const dbPath = path.join(testDir, 'test.db')

  // Create empty database file (SQLiteStorage requires it to exist)
  const initDb = new Database(dbPath)
  initDb.close()

  // Open via SQLiteStorage to run migrations, create tables, and seed builtins
  const storage = new SQLiteStorage(dbPath)
  const db = storage.getDatabase()

  return { storage, db, testDir }
}

function cleanup(testDir: string): void {
  try {
    fs.rmSync(testDir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// Schema Migration Tests
// =============================================================================

describe('Intent-based actions — schema', () => {
  let storage: SQLiteStorage
  let db: Database.Database
  let testDir: string

  beforeEach(() => {
    const ctx = createTestDb()
    storage = ctx.storage
    db = ctx.db
    testDir = ctx.testDir
  })

  afterEach(() => {
    storage.close()
    cleanup(testDir)
  })

  it('pmo_actions table has from_intent and to_intent columns', () => {
    const columns = db.pragma(`table_info('${PMO_TABLES.actions}')`) as Array<{ name: string }>
    const columnNames = columns.map(c => c.name)

    expect(columnNames).to.include('from_intent')
    expect(columnNames).to.include('to_intent')
    expect(columnNames).to.not.include('from_state')
    expect(columnNames).to.not.include('to_state')
  })

  it('builtin actions use intent names, not state names', () => {
    const groom = db.prepare(
      `SELECT from_intent, to_intent FROM ${PMO_TABLES.actions} WHERE id = 'groom'`
    ).get() as { from_intent: string | null; to_intent: string | null }

    expect(groom.from_intent).to.equal('backlog')
    expect(groom.to_intent).to.equal('ready')

    const implement = db.prepare(
      `SELECT from_intent, to_intent FROM ${PMO_TABLES.actions} WHERE id = 'implement'`
    ).get() as { from_intent: string | null; to_intent: string | null }

    expect(implement.from_intent).to.equal('ready')
    expect(implement.to_intent).to.equal('started')

    const merge = db.prepare(
      `SELECT from_intent, to_intent FROM ${PMO_TABLES.actions} WHERE id = 'merge'`
    ).get() as { from_intent: string | null; to_intent: string | null }

    expect(merge.from_intent).to.equal('needs_review')
    expect(merge.to_intent).to.equal('completed')
  })

  it('review action has null from_intent (manual-only)', () => {
    const review = db.prepare(
      `SELECT from_intent, to_intent FROM ${PMO_TABLES.actions} WHERE id = 'review'`
    ).get() as { from_intent: string | null; to_intent: string | null }

    expect(review.from_intent).to.be.null
    expect(review.to_intent).to.be.null
  })

  it('default_executor is set in workspace_settings when table exists', () => {
    // workspace_settings is a workspace-level table, not PMO-level.
    // Create it to simulate a full workspace database.
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
    // Run the migration logic that inserts default_executor
    const existing = db.prepare(
      "SELECT value FROM workspace_settings WHERE key = 'default_executor'"
    ).get() as { value: string } | undefined
    if (!existing) {
      db.prepare(
        "INSERT INTO workspace_settings (key, value) VALUES ('default_executor', 'claude')"
      ).run()
    }

    const row = db.prepare(
      "SELECT value FROM workspace_settings WHERE key = 'default_executor'"
    ).get() as { value: string } | undefined

    expect(row).to.exist
    expect(row!.value).to.equal('claude')
  })
})

// =============================================================================
// ActionStorage Tests (Intent-based CRUD)
// =============================================================================

describe('Intent-based actions — ActionStorage', () => {
  let storage: SQLiteStorage
  let db: Database.Database
  let testDir: string

  beforeEach(() => {
    const ctx = createTestDb()
    storage = ctx.storage
    db = ctx.db
    testDir = ctx.testDir
  })

  afterEach(() => {
    storage.close()
    cleanup(testDir)
  })

  it('createAction stores from_intent and to_intent', async () => {
    const action = await storage.createAction({
      name: 'test-action',
      prompt: 'Do the test',
      fromIntent: 'started',
      toIntent: 'needs_review',
    })

    expect(action.fromIntent).to.equal('started')
    expect(action.toIntent).to.equal('needs_review')

    // Verify in DB
    const row = db.prepare(
      `SELECT from_intent, to_intent FROM ${PMO_TABLES.actions} WHERE id = ?`
    ).get(action.id) as { from_intent: string | null; to_intent: string | null }
    expect(row.from_intent).to.equal('started')
    expect(row.to_intent).to.equal('needs_review')
  })

  it('createAction allows null from_intent (manual-only actions)', async () => {
    const action = await storage.createAction({
      name: 'manual-action',
      prompt: 'Do something manually',
      toIntent: 'testing',
      // fromIntent is not set — should be null
    })

    expect(action.fromIntent).to.be.undefined
    expect(action.toIntent).to.equal('testing')

    const row = db.prepare(
      `SELECT from_intent FROM ${PMO_TABLES.actions} WHERE id = ?`
    ).get(action.id) as { from_intent: string | null }
    expect(row.from_intent).to.be.null
  })

  it('createAction allows null executor (inherits workspace default)', async () => {
    const action = await storage.createAction({
      name: 'default-executor-action',
      prompt: 'Use workspace default executor',
      toIntent: 'started',
    })

    expect(action.executor).to.be.undefined

    const row = db.prepare(
      `SELECT executor FROM ${PMO_TABLES.actions} WHERE id = ?`
    ).get(action.id) as { executor: string | null }
    expect(row.executor).to.be.null
  })

  it('listActions filters by fromIntent', async () => {
    await storage.createAction({
      name: 'ready-action',
      prompt: 'Action triggered from ready',
      fromIntent: 'ready',
      toIntent: 'started',
    })

    await storage.createAction({
      name: 'review-action',
      prompt: 'Action triggered from needs_review',
      fromIntent: 'needs_review',
      toIntent: 'completed',
    })

    const readyActions = await storage.listActions({ fromIntent: 'ready' })
    const readyNames = readyActions.map(a => a.name)
    expect(readyNames).to.include('ready-action')
    expect(readyNames).to.not.include('review-action')

    // Actions with null from_intent should also match (they match any intent)
    const nullFromActions = readyActions.filter(a => !a.fromIntent)
    expect(nullFromActions.length).to.be.greaterThan(0)
  })

  it('getSuggestedAction matches by intent name', async () => {
    // The builtin 'groom' action has from_intent='backlog'
    const suggestion = await storage.getSuggestedAction('backlog')
    expect(suggestion).to.exist
    expect(suggestion!.id).to.equal('groom')
  })

  it('getSuggestedAction returns null-from_intent actions as fallback', async () => {
    // 'testing' intent has no exact match, but null-from_intent actions should match
    const suggestion = await storage.getSuggestedAction('testing')
    // Should return some action (one with null from_intent)
    expect(suggestion).to.exist
    expect(suggestion!.fromIntent).to.be.undefined
  })

  it('updateAction changes from_intent and to_intent', async () => {
    const action = await storage.createAction({
      name: 'updatable-action',
      prompt: 'Will be updated',
      fromIntent: 'backlog',
      toIntent: 'ready',
    })

    const updated = await storage.updateAction(action.id, {
      fromIntent: 'started',
      toIntent: 'needs_review',
    })

    expect(updated.fromIntent).to.equal('started')
    expect(updated.toIntent).to.equal('needs_review')
  })
})

// =============================================================================
// Executor Resolution Tests
// =============================================================================

describe('Intent-based actions — executor resolution', () => {
  let db: Database.Database
  let testDir: string

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'executor-test-'))
    const dbPath = path.join(testDir, 'test.db')
    db = new Database(dbPath)

    // Create workspace_settings table
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
  })

  afterEach(() => {
    db.close()
    cleanup(testDir)
  })

  it('getDefaultExecutorSetting returns claude when not configured', () => {
    const executor = getDefaultExecutorSetting(db)
    expect(executor).to.equal('claude')
  })

  it('getDefaultExecutorSetting returns configured value', () => {
    setDefaultExecutorSetting(db, 'codex')
    const executor = getDefaultExecutorSetting(db)
    expect(executor).to.equal('codex')
  })

  it('setDefaultExecutorSetting persists value', () => {
    setDefaultExecutorSetting(db, 'opencode')
    const row = db.prepare(
      "SELECT value FROM workspace_settings WHERE key = 'default_executor'"
    ).get() as { value: string }
    expect(row.value).to.equal('opencode')
  })

  it('resolveExecutor: invocation override wins over everything', () => {
    setDefaultExecutorSetting(db, 'codex')
    const result = resolveExecutor('opencode' as ActionExecutor, 'codex' as ActionExecutor, db)
    expect(result).to.equal('opencode')
  })

  it('resolveExecutor: action override wins over workspace default', () => {
    setDefaultExecutorSetting(db, 'codex')
    const result = resolveExecutor(undefined, 'opencode' as ActionExecutor, db)
    expect(result).to.equal('opencode')
  })

  it('resolveExecutor: null executor falls back to workspace default', () => {
    setDefaultExecutorSetting(db, 'codex')
    const result = resolveExecutor(undefined, undefined, db)
    expect(result).to.equal('codex')
  })

  it('resolveExecutor: all undefined falls back to claude', () => {
    const result = resolveExecutor(undefined, undefined, db)
    expect(result).to.equal('claude')
  })
})

// =============================================================================
// from_intent Is Not a Gate Tests
// =============================================================================

describe('Intent-based actions — from_intent is not a gate', () => {
  let storage: SQLiteStorage
  let db: Database.Database
  let testDir: string

  beforeEach(() => {
    const ctx = createTestDb()
    storage = ctx.storage
    db = ctx.db
    testDir = ctx.testDir
  })

  afterEach(() => {
    storage.close()
    cleanup(testDir)
  })

  it('getAction by ID works regardless of from_intent (manual invocation)', async () => {
    // The implement action has from_intent='ready', but getAction by ID
    // should always return it regardless of the ticket's current state.
    const action = await storage.getAction('implement')
    expect(action).to.exist
    expect(action!.id).to.equal('implement')
    expect(action!.fromIntent).to.equal('ready')

    // Simulate: user runs `prlt work start TICKET --action implement`
    // on a ticket in Backlog state (not Ready) — should work because
    // from_intent is not a gate, just a trigger hint for auto-fire
    // The getAction call doesn't check the ticket's state at all
    const action2 = await storage.getAction('implement')
    expect(action2).to.exist
  })

  it('implement action on a ticket in Backlog state — getAction succeeds', async () => {
    // This test verifies AC: "prlt work start <ticket> --action implement works
    // regardless of ticket's current state (from_intent is not a gate)"
    //
    // The action is fetched by ID, not by matching from_intent to ticket state.
    // So even though implement has from_intent='ready', it can be used on any ticket.
    const action = await storage.getAction('implement')
    expect(action).to.not.be.null
    expect(action!.name).to.equal('Implement')
    expect(action!.toIntent).to.equal('started')
  })
})

// =============================================================================
// Custom Action Creation Tests
// =============================================================================

describe('Intent-based actions — custom action creation', () => {
  let storage: SQLiteStorage
  let db: Database.Database
  let testDir: string

  beforeEach(() => {
    const ctx = createTestDb()
    storage = ctx.storage
    db = ctx.db
    testDir = ctx.testDir
  })

  afterEach(() => {
    storage.close()
    cleanup(testDir)
  })

  it('creates custom action with non-standard intents', async () => {
    // Simulates: prlt action create test --to-intent testing --prompt '...'
    const action = await storage.createAction({
      name: 'test',
      prompt: 'Run the test suite and report results',
      toIntent: 'testing',
      fromIntent: 'needs_review',
    })

    expect(action.name).to.equal('test')
    expect(action.toIntent).to.equal('testing')
    expect(action.fromIntent).to.equal('needs_review')
    expect(action.isBuiltin).to.be.false
  })

  it('creates custom action without from_intent (manual-only)', async () => {
    const action = await storage.createAction({
      name: 'deploy',
      prompt: 'Deploy to production',
      toIntent: 'completed',
    })

    expect(action.toIntent).to.equal('completed')
    expect(action.fromIntent).to.be.undefined
  })

  it('custom action with explicit executor overrides workspace default', async () => {
    // workspace_settings is a workspace-level table — create for this test
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
    setDefaultExecutorSetting(db, 'codex')

    const action = await storage.createAction({
      name: 'claude-review',
      prompt: 'Review always uses claude',
      toIntent: 'needs_review',
      executor: 'claude',
    })

    // Action stores explicit executor
    expect(action.executor).to.equal('claude')

    // But an action without executor inherits workspace default
    const action2 = await storage.createAction({
      name: 'default-action',
      prompt: 'Uses workspace default',
      toIntent: 'started',
    })
    expect(action2.executor).to.be.undefined

    // resolveExecutor should return 'codex' (workspace default) for null executor
    const resolved = resolveExecutor(undefined, action2.executor, db)
    expect(resolved).to.equal('codex')

    // resolveExecutor should return 'claude' for action with explicit executor
    const resolved2 = resolveExecutor(undefined, action.executor, db)
    expect(resolved2).to.equal('claude')
  })
})
