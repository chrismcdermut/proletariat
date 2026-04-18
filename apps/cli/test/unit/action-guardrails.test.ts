import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { resolveTicketIntent, validateActionState } from '../../src/lib/work-lifecycle/action-guardrails.js'
import type { WorkAction } from '../../src/lib/pmo/types.js'
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'
import { actionGuardrails } from '../../src/lib/database/migrations/0026_action_guardrails.js'

// =============================================================================
// Test Helpers
// =============================================================================

function makeAction(overrides: Partial<WorkAction> = {}): WorkAction {
  return {
    id: 'test-action',
    name: 'Test Action',
    prompt: 'Do something',
    modifiesCode: true,
    isBuiltin: false,
    position: 0,
    createdAt: new Date(),
    ...overrides,
  }
}

function createTestDb(): { storage: SQLiteStorage; db: Database.Database; testDir: string } {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrails-test-'))
  const dbPath = path.join(testDir, 'test.db')
  const initDb = new Database(dbPath)
  initDb.close()
  const storage = new SQLiteStorage(dbPath)
  const db = storage.getDatabase()
  return { storage, db, testDir }
}

// =============================================================================
// resolveTicketIntent
// =============================================================================

describe('resolveTicketIntent', () => {
  it('resolves common status names to intents via alias matching', () => {
    expect(resolveTicketIntent('Backlog', undefined)).to.equal('backlog')
    expect(resolveTicketIntent('In Progress', undefined)).to.equal('started')
    expect(resolveTicketIntent('Review', undefined)).to.equal('needs_review')
    expect(resolveTicketIntent('Done', undefined)).to.equal('completed')
    expect(resolveTicketIntent('Todo', undefined)).to.equal('ready')
    expect(resolveTicketIntent('Blocked', undefined)).to.equal('paused')
  })

  it('resolves case-insensitively', () => {
    expect(resolveTicketIntent('backlog', undefined)).to.equal('backlog')
    expect(resolveTicketIntent('in progress', undefined)).to.equal('started')
    expect(resolveTicketIntent('DONE', undefined)).to.equal('completed')
  })

  it('maps statusCategory when statusName has no alias match', () => {
    expect(resolveTicketIntent('CustomStatus', 'backlog')).to.equal('backlog')
    expect(resolveTicketIntent('CustomStatus', 'unstarted')).to.equal('ready')
    expect(resolveTicketIntent('CustomStatus', 'started')).to.equal('started')
    expect(resolveTicketIntent('CustomStatus', 'completed')).to.equal('completed')
    expect(resolveTicketIntent('CustomStatus', 'canceled')).to.equal('dropped')
    expect(resolveTicketIntent('CustomStatus', 'triage')).to.equal('backlog')
  })

  it('returns null when both statusName and statusCategory are undefined', () => {
    expect(resolveTicketIntent(undefined, undefined)).to.be.null
  })

  it('prefers alias match over category mapping', () => {
    // "Review" matches 'needs_review' via aliases, even if category is 'started'
    expect(resolveTicketIntent('Review', 'started')).to.equal('needs_review')
  })
})

// =============================================================================
// validateActionState
// =============================================================================

describe('validateActionState', () => {
  it('allows any state when validFrom is empty', () => {
    const action = makeAction({ validFrom: [] })
    const result = validateActionState(action, 'Done', 'completed')
    expect(result.allowed).to.be.true
  })

  it('allows any state when validFrom is undefined', () => {
    const action = makeAction({ validFrom: undefined })
    const result = validateActionState(action, 'Done', 'completed')
    expect(result.allowed).to.be.true
  })

  it('allows when ticket state matches validFrom', () => {
    const action = makeAction({ validFrom: ['ready', 'backlog'] })
    const result = validateActionState(action, 'Todo', 'unstarted')
    expect(result.allowed).to.be.true
  })

  it('allows when statusCategory maps to a matching intent', () => {
    const action = makeAction({ validFrom: ['backlog'] })
    // "CustomCol" has no alias, but statusCategory=backlog maps to intent 'backlog'
    const result = validateActionState(action, 'CustomCol', 'backlog')
    expect(result.allowed).to.be.true
  })

  it('refuses when ticket state does not match validFrom', () => {
    const action = makeAction({ name: 'Implement', validFrom: ['ready', 'backlog'] })
    const result = validateActionState(action, 'Done', 'completed')
    expect(result.allowed).to.be.false
    expect(result.reason).to.include('Implement')
    expect(result.reason).to.include('ready, backlog')
    expect(result.reason).to.include('--force')
  })

  it('allows when --force is set regardless of state mismatch', () => {
    const action = makeAction({ validFrom: ['ready'] })
    const result = validateActionState(action, 'Done', 'completed', true)
    expect(result.allowed).to.be.true
  })

  it('allows when current state cannot be determined', () => {
    const action = makeAction({ validFrom: ['ready'] })
    const result = validateActionState(action, undefined, undefined)
    expect(result.allowed).to.be.true
  })

  it('handles single-entry validFrom', () => {
    const action = makeAction({ validFrom: ['needs_review'] })
    expect(validateActionState(action, 'Review', 'started').allowed).to.be.true
    expect(validateActionState(action, 'In Progress', 'started').allowed).to.be.false
  })
})

// =============================================================================
// Storage Integration — valid_from column
// =============================================================================

describe('Action storage — validFrom', () => {
  let storage: SQLiteStorage
  let testDir: string

  beforeEach(() => {
    const result = createTestDb()
    storage = result.storage
    testDir = result.testDir
  })

  afterEach(async () => {
    await storage.close()
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('builtin implement action has validFrom with ready and backlog', async () => {
    const action = await storage.getAction('implement')
    expect(action).to.not.be.null
    expect(action!.validFrom).to.deep.equal(['ready', 'backlog'])
  })

  it('builtin groom action has validFrom with backlog', async () => {
    const action = await storage.getAction('groom')
    expect(action).to.not.be.null
    expect(action!.validFrom).to.deep.equal(['backlog'])
  })

  it('builtin merge action has validFrom with needs_review', async () => {
    const action = await storage.getAction('merge')
    expect(action).to.not.be.null
    expect(action!.validFrom).to.deep.equal(['needs_review'])
  })

  it('builtin review action has no validFrom (any state)', async () => {
    const action = await storage.getAction('review')
    expect(action).to.not.be.null
    expect(action!.validFrom).to.be.undefined
  })

  it('creates custom action with validFrom', async () => {
    const action = await storage.createAction({
      name: 'deploy',
      prompt: 'Deploy to staging',
      validFrom: ['needs_review', 'completed'],
    })
    expect(action.validFrom).to.deep.equal(['needs_review', 'completed'])

    // Re-read from DB
    const fetched = await storage.getAction(action.id)
    expect(fetched!.validFrom).to.deep.equal(['needs_review', 'completed'])
  })

  it('creates custom action without validFrom (any state)', async () => {
    const action = await storage.createAction({
      name: 'notify',
      prompt: 'Send notification',
    })
    expect(action.validFrom).to.be.undefined
  })

  it('updates validFrom on custom action', async () => {
    const action = await storage.createAction({
      name: 'deploy',
      prompt: 'Deploy',
      validFrom: ['ready'],
    })

    const updated = await storage.updateAction(action.id, {
      validFrom: ['ready', 'started'],
    })
    expect(updated.validFrom).to.deep.equal(['ready', 'started'])
  })

  it('clears validFrom by setting to null', async () => {
    const action = await storage.createAction({
      name: 'deploy',
      prompt: 'Deploy',
      validFrom: ['ready'],
    })

    const updated = await storage.updateAction(action.id, {
      validFrom: null as unknown as string[],
    })
    expect(updated.validFrom).to.be.undefined
  })

  it('getSuggestedAction matches via valid_from array', async () => {
    await storage.createAction({
      name: 'custom-started',
      prompt: 'Custom action for started',
      validFrom: ['started', 'needs_review'],
      isDefault: true,
    })

    const suggested = await storage.getSuggestedAction('started')
    // Should find an action that includes 'started' in its valid_from
    expect(suggested).to.not.be.null
  })

  it('getActionByFromIntent matches via valid_from array', async () => {
    await storage.createAction({
      name: 'custom-multi',
      prompt: 'Custom multi-state action',
      validFrom: ['started', 'needs_review'],
    })

    const found = await storage.getActionByFromIntent('needs_review')
    expect(found).to.not.be.null
    // Could be the custom action or the builtin merge — both match needs_review
    // Just verify we got a result
  })
})

// =============================================================================
// Migration — valid_from column
// =============================================================================

describe('Migration 0026 — action guardrails', () => {
  it('migrates from_intent to valid_from as single-element array', () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-test-'))
    const dbPath = path.join(testDir, 'test.db')
    const db = new Database(dbPath)

    try {
      // Set up a minimal pmo_actions table WITHOUT valid_from
      db.exec(`
        CREATE TABLE pmo_actions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          prompt TEXT NOT NULL,
          end_prompt TEXT,
          from_intent TEXT,
          to_intent TEXT,
          executor TEXT,
          environment TEXT,
          permission_mode TEXT,
          timeout INTEGER,
          model TEXT,
          review_gate TEXT,
          network_allowlist TEXT,
          modifies_code INTEGER NOT NULL DEFAULT 1,
          is_default INTEGER NOT NULL DEFAULT 0,
          is_builtin INTEGER NOT NULL DEFAULT 0,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT
        )
      `)

      // Insert test data
      db.prepare(`
        INSERT INTO pmo_actions (id, name, prompt, from_intent, to_intent)
        VALUES ('test-action', 'Test', 'Do stuff', 'ready', 'started')
      `).run()
      db.prepare(`
        INSERT INTO pmo_actions (id, name, prompt, from_intent, to_intent)
        VALUES ('test-null', 'TestNull', 'Do more', NULL, 'completed')
      `).run()

      // Run migration
      actionGuardrails.up(db)

      // Verify valid_from column was added
      const cols = db.prepare("PRAGMA table_info(pmo_actions)").all() as { name: string }[]
      const colNames = cols.map(c => c.name)
      expect(colNames).to.include('valid_from')

      // Verify from_intent='ready' was migrated to valid_from='["ready"]'
      const row1 = db.prepare("SELECT valid_from FROM pmo_actions WHERE id = 'test-action'").get() as { valid_from: string }
      expect(JSON.parse(row1.valid_from)).to.deep.equal(['ready'])

      // Verify NULL from_intent was NOT migrated (stays null)
      const row2 = db.prepare("SELECT valid_from FROM pmo_actions WHERE id = 'test-null'").get() as { valid_from: string | null }
      expect(row2.valid_from).to.be.null

      // Verify idempotency: running again doesn't error
      actionGuardrails.up(db)
    } finally {
      db.close()
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })
})
