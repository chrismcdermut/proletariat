import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js'
import {
  validateActionState,
  resolveTicketIntent,
} from '../../src/lib/work-lifecycle/action-guardrails.js'

/**
 * Tests for action-level guardrails (PRLT-1317).
 *
 * Actions declare valid_from (array of intent names) to restrict which
 * ticket states they can be invoked from. The check runs for all callers
 * and can be bypassed with --force.
 */

// =============================================================================
// Test Helpers
// =============================================================================

function createTestDb(): { storage: SQLiteStorage; db: Database.Database; testDir: string } {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-guardrails-test-'))
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

describe('Action-Level Guardrails (PRLT-1317)', () => {
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

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------

  describe('Schema migration', () => {
    it('pmo_actions has valid_from column', () => {
      const cols = db.prepare("PRAGMA table_info(pmo_actions)").all() as { name: string }[]
      const colNames = cols.map(c => c.name)

      expect(colNames).to.include('valid_from')
    })

    it('valid_from is nullable (custom actions can omit it)', () => {
      const cols = db.prepare("PRAGMA table_info(pmo_actions)").all() as { name: string; notnull: number }[]
      const validFromCol = cols.find(c => c.name === 'valid_from')

      expect(validFromCol).to.exist
      expect(validFromCol!.notnull).to.equal(0) // nullable
    })
  })

  // ---------------------------------------------------------------------------
  // Built-in action defaults
  // ---------------------------------------------------------------------------

  describe('Built-in action valid_from defaults', () => {
    it('groom action has valid_from = ["backlog"]', async () => {
      const action = await storage.getAction('groom')
      expect(action).to.exist
      expect(action!.validFrom).to.deep.equal(['backlog'])
    })

    it('implement action has valid_from = ["ready", "backlog"]', async () => {
      const action = await storage.getAction('implement')
      expect(action).to.exist
      expect(action!.validFrom).to.deep.equal(['ready', 'backlog'])
    })

    it('review action has valid_from = ["needs_review"]', async () => {
      const action = await storage.getAction('review')
      expect(action).to.exist
      expect(action!.validFrom).to.deep.equal(['needs_review'])
    })

    it('merge action has valid_from = ["needs_review"]', async () => {
      const action = await storage.getAction('merge')
      expect(action).to.exist
      expect(action!.validFrom).to.deep.equal(['needs_review'])
    })

    it('resolve action has no valid_from (any state)', async () => {
      const action = await storage.getAction('resolve')
      expect(action).to.exist
      expect(action!.validFrom).to.be.undefined
    })
  })

  // ---------------------------------------------------------------------------
  // resolveTicketIntent
  // ---------------------------------------------------------------------------

  describe('resolveTicketIntent', () => {
    it('resolves "In Progress" to "started" via alias matching', () => {
      const intent = resolveTicketIntent(null, 'In Progress', undefined)
      expect(intent).to.equal('started')
    })

    it('resolves "Backlog" to "backlog" via alias matching', () => {
      const intent = resolveTicketIntent(null, 'Backlog', undefined)
      expect(intent).to.equal('backlog')
    })

    it('resolves "Done" to "completed" via alias matching', () => {
      const intent = resolveTicketIntent(null, 'Done', undefined)
      expect(intent).to.equal('completed')
    })

    it('resolves "Review" to "needs_review" via alias matching', () => {
      const intent = resolveTicketIntent(null, 'Review', undefined)
      expect(intent).to.equal('needs_review')
    })

    it('resolves "Todo" to "ready" via alias matching', () => {
      const intent = resolveTicketIntent(null, 'Todo', undefined)
      expect(intent).to.equal('ready')
    })

    it('resolves "Blocked" to "paused" via alias matching', () => {
      const intent = resolveTicketIntent(null, 'Blocked', undefined)
      expect(intent).to.equal('paused')
    })

    it('falls back to statusCategory when statusName has no alias match', () => {
      const intent = resolveTicketIntent(null, 'CustomStatus', 'started')
      expect(intent).to.equal('started')
    })

    it('maps statusCategory "unstarted" to "ready" intent', () => {
      const intent = resolveTicketIntent(null, 'CustomColumn', 'unstarted')
      expect(intent).to.equal('ready')
    })

    it('maps statusCategory "backlog" to "backlog" intent', () => {
      const intent = resolveTicketIntent(null, undefined, 'backlog')
      expect(intent).to.equal('backlog')
    })

    it('returns null when no info is available', () => {
      const intent = resolveTicketIntent(null, undefined, undefined)
      expect(intent).to.be.null
    })

    it('uses transition map for reverse lookup when available', () => {
      // Seed a transition map entry
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS pmo_transition_map (
            provider TEXT NOT NULL,
            intent TEXT NOT NULL,
            provider_state_name TEXT NOT NULL,
            provider_state_id TEXT,
            updated_at TEXT,
            PRIMARY KEY (provider, intent)
          )
        `)
      } catch { /* table may already exist */ }

      db.prepare(
        "INSERT OR REPLACE INTO pmo_transition_map (provider, intent, provider_state_name) VALUES (?, ?, ?)"
      ).run('linear', 'started', 'Development')

      const intent = resolveTicketIntent(db, 'Development', undefined, 'linear')
      expect(intent).to.equal('started')
    })

    it('case-insensitive alias matching', () => {
      const intent = resolveTicketIntent(null, 'in progress', undefined)
      expect(intent).to.equal('started')
    })
  })

  // ---------------------------------------------------------------------------
  // validateActionState
  // ---------------------------------------------------------------------------

  describe('validateActionState', () => {
    it('allows action when valid_from is null (any state)', () => {
      const result = validateActionState({
        validFrom: undefined,
        db: null,
        statusName: 'In Progress',
        statusCategory: 'started',
        actionName: 'resolve',
      })
      expect(result.allowed).to.be.true
    })

    it('allows action when valid_from is empty array (any state)', () => {
      const result = validateActionState({
        validFrom: [],
        db: null,
        statusName: 'In Progress',
        statusCategory: 'started',
        actionName: 'resolve',
      })
      expect(result.allowed).to.be.true
    })

    it('allows action when current intent matches valid_from', () => {
      const result = validateActionState({
        validFrom: ['backlog'],
        db: null,
        statusName: 'Backlog',
        statusCategory: 'backlog',
        actionName: 'groom',
      })
      expect(result.allowed).to.be.true
      expect(result.currentIntent).to.equal('backlog')
    })

    it('allows action when current intent is one of multiple valid_from entries', () => {
      const result = validateActionState({
        validFrom: ['ready', 'backlog'],
        db: null,
        statusName: 'Backlog',
        statusCategory: 'backlog',
        actionName: 'implement',
      })
      expect(result.allowed).to.be.true
    })

    it('refuses action when current intent does not match valid_from', () => {
      const result = validateActionState({
        validFrom: ['backlog'],
        db: null,
        statusName: 'In Progress',
        statusCategory: 'started',
        actionName: 'groom',
      })
      expect(result.allowed).to.be.false
      expect(result.currentIntent).to.equal('started')
      expect(result.message).to.include('Cannot run action "groom"')
      expect(result.message).to.include('In Progress')
      expect(result.message).to.include('--force')
    })

    it('refuses review action when ticket is in backlog', () => {
      const result = validateActionState({
        validFrom: ['needs_review'],
        db: null,
        statusName: 'Backlog',
        statusCategory: 'backlog',
        actionName: 'Code Review',
      })
      expect(result.allowed).to.be.false
      expect(result.currentIntent).to.equal('backlog')
    })

    it('allows review action when ticket is in review', () => {
      const result = validateActionState({
        validFrom: ['needs_review'],
        db: null,
        statusName: 'Review',
        statusCategory: 'started',
        actionName: 'Code Review',
      })
      expect(result.allowed).to.be.true
      expect(result.currentIntent).to.equal('needs_review')
    })

    it('gracefully allows when current intent cannot be determined', () => {
      const result = validateActionState({
        validFrom: ['backlog'],
        db: null,
        statusName: undefined,
        statusCategory: undefined,
        actionName: 'groom',
      })
      expect(result.allowed).to.be.true
      expect(result.currentIntent).to.be.null
    })

    it('returns valid_from in the result for display purposes', () => {
      const result = validateActionState({
        validFrom: ['ready', 'backlog'],
        db: null,
        statusName: 'In Progress',
        statusCategory: 'started',
        actionName: 'implement',
      })
      expect(result.validFrom).to.deep.equal(['ready', 'backlog'])
    })

    it('error message includes available valid_from states', () => {
      const result = validateActionState({
        validFrom: ['ready', 'backlog'],
        db: null,
        statusName: 'Done',
        statusCategory: 'completed',
        actionName: 'implement',
      })
      expect(result.allowed).to.be.false
      expect(result.message).to.include('ready, backlog')
    })
  })

  // ---------------------------------------------------------------------------
  // Storage round-trip
  // ---------------------------------------------------------------------------

  describe('Storage round-trip', () => {
    it('custom action can set valid_from', async () => {
      const created = await storage.createAction({
        name: 'deploy',
        prompt: 'Deploy the service',
        validFrom: ['completed'],
      })
      expect(created.validFrom).to.deep.equal(['completed'])

      const fetched = await storage.getAction('deploy')
      expect(fetched).to.exist
      expect(fetched!.validFrom).to.deep.equal(['completed'])
    })

    it('custom action without valid_from allows any state', async () => {
      const created = await storage.createAction({
        name: 'explore',
        prompt: 'Explore the codebase',
      })
      expect(created.validFrom).to.be.undefined

      const fetched = await storage.getAction('explore')
      expect(fetched).to.exist
      expect(fetched!.validFrom).to.be.undefined
    })

    it('updating valid_from persists correctly', async () => {
      await storage.createAction({
        name: 'custom-action',
        prompt: 'Do something',
        validFrom: ['backlog'],
      })

      await storage.updateAction('custom-action', {
        validFrom: ['ready', 'started'],
      })

      const fetched = await storage.getAction('custom-action')
      expect(fetched!.validFrom).to.deep.equal(['ready', 'started'])
    })

    it('clearing valid_from (set to empty) removes the constraint', async () => {
      await storage.createAction({
        name: 'clearable',
        prompt: 'Test clearing',
        validFrom: ['backlog'],
      })

      await storage.updateAction('clearable', {
        validFrom: [],
      })

      const fetched = await storage.getAction('clearable')
      expect(fetched!.validFrom).to.be.undefined
    })
  })

  // ---------------------------------------------------------------------------
  // Enforcement scenarios (ticket examples from PRLT-1317)
  // ---------------------------------------------------------------------------

  describe('Enforcement scenarios from ticket', () => {
    it('implement: valid_from=[ready, backlog] — allowed from ready', () => {
      const result = validateActionState({
        validFrom: ['ready', 'backlog'],
        db: null,
        statusName: 'Todo',
        statusCategory: 'unstarted',
        actionName: 'implement',
      })
      expect(result.allowed).to.be.true
      expect(result.currentIntent).to.equal('ready')
    })

    it('implement: valid_from=[ready, backlog] — allowed from backlog', () => {
      const result = validateActionState({
        validFrom: ['ready', 'backlog'],
        db: null,
        statusName: 'Backlog',
        statusCategory: 'backlog',
        actionName: 'implement',
      })
      expect(result.allowed).to.be.true
    })

    it('implement: valid_from=[ready, backlog] — refused from started', () => {
      const result = validateActionState({
        validFrom: ['ready', 'backlog'],
        db: null,
        statusName: 'In Progress',
        statusCategory: 'started',
        actionName: 'implement',
      })
      expect(result.allowed).to.be.false
    })

    it('review: valid_from=[needs_review] — allowed from review', () => {
      const result = validateActionState({
        validFrom: ['needs_review'],
        db: null,
        statusName: 'In Review',
        statusCategory: 'started',
        actionName: 'review',
      })
      expect(result.allowed).to.be.true
    })

    it('review: valid_from=[needs_review] — refused from backlog', () => {
      const result = validateActionState({
        validFrom: ['needs_review'],
        db: null,
        statusName: 'Backlog',
        statusCategory: 'backlog',
        actionName: 'review',
      })
      expect(result.allowed).to.be.false
    })

    it('merge: valid_from=[needs_review] — allowed from review', () => {
      const result = validateActionState({
        validFrom: ['needs_review'],
        db: null,
        statusName: 'Needs Review',
        statusCategory: 'started',
        actionName: 'merge',
      })
      expect(result.allowed).to.be.true
    })

    it('merge: valid_from=[needs_review] — refused from in progress', () => {
      const result = validateActionState({
        validFrom: ['needs_review'],
        db: null,
        statusName: 'In Progress',
        statusCategory: 'started',
        actionName: 'merge',
      })
      expect(result.allowed).to.be.false
    })
  })
})
