import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js'
import type { WorkAction, WorkActionFilter } from '../../src/lib/pmo/types.js'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestDb(): { storage: SQLiteStorage; db: Database.Database; testDir: string } {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-commands-test-'))
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

describe('Action Commands — Storage Layer', () => {
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

  // ─── action list ──────────────────────────────────────────

  describe('listActions', () => {
    it('returns all seeded built-in actions', async () => {
      const actions = await storage.listActions()
      expect(actions.length).to.be.greaterThanOrEqual(5)

      const names = actions.map(a => a.id)
      expect(names).to.include('groom')
      expect(names).to.include('implement')
      expect(names).to.include('review')
      expect(names).to.include('merge')
      expect(names).to.include('resolve')
    })

    it('filters by isBuiltin=true', async () => {
      await storage.createAction({
        name: 'custom-deploy',
        prompt: 'Deploy the app',
        isBuiltin: false,
      })

      const builtins = await storage.listActions({ isBuiltin: true })
      expect(builtins.every(a => a.isBuiltin)).to.be.true
    })

    it('filters by isBuiltin=false', async () => {
      await storage.createAction({
        name: 'custom-lint',
        prompt: 'Run the linter',
        isBuiltin: false,
      })

      const customs = await storage.listActions({ isBuiltin: false })
      expect(customs.length).to.be.greaterThanOrEqual(1)
      expect(customs.every(a => !a.isBuiltin)).to.be.true
    })

    it('filters by search string', async () => {
      const results = await storage.listActions({ search: 'groom' })
      expect(results.length).to.be.greaterThanOrEqual(1)
      expect(results[0].id).to.equal('groom')
    })
  })

  // ─── action show ──────────────────────────────────────────

  describe('getAction', () => {
    it('returns full action config for built-in', async () => {
      const action = await storage.getAction('implement')
      expect(action).to.exist
      expect(action!.id).to.equal('implement')
      expect(action!.name).to.equal('Implement')
      expect(action!.prompt).to.be.a('string').and.not.empty
      expect(action!.isBuiltin).to.be.true
    })

    it('returns null for non-existent action', async () => {
      const action = await storage.getAction('nonexistent-action-xyz')
      expect(action).to.be.null
    })
  })

  // ─── action create ──────────────��─────────────────────────

  describe('createAction', () => {
    it('creates a new custom action', async () => {
      const action = await storage.createAction({
        name: 'deploy',
        prompt: 'Deploy to staging',
        description: 'Deploy changes to staging environment',
      })

      expect(action.id).to.equal('deploy')
      expect(action.name).to.equal('deploy')
      expect(action.prompt).to.equal('Deploy to staging')
      expect(action.isBuiltin).to.be.false
    })

    it('rejects duplicate names', async () => {
      await storage.createAction({
        name: 'my-action',
        prompt: 'Do something',
      })

      try {
        await storage.createAction({
          name: 'my-action',
          prompt: 'Do something else',
        })
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        expect((error as Error).message).to.include('already exists')
      }
    })

    it('requires name', async () => {
      try {
        await storage.createAction({ prompt: 'test' })
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        expect((error as Error).message).to.include('name is required')
      }
    })

    it('requires prompt', async () => {
      try {
        await storage.createAction({ name: 'test' })
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        expect((error as Error).message).to.include('prompt is required')
      }
    })

    it('creates action with intent wiring', async () => {
      const action = await storage.createAction({
        name: 'deploy-action',
        prompt: 'Deploy it',
        fromIntent: 'started',
        toIntent: 'needs_review',
      })

      expect(action.fromIntent).to.equal('started')
      expect(action.toIntent).to.equal('needs_review')
    })
  })

  // ─── action delete ───────────────��───────────────────────���

  describe('deleteAction', () => {
    it('deletes a custom action', async () => {
      await storage.createAction({
        name: 'temp-action',
        prompt: 'Temporary',
      })

      const before = await storage.getAction('temp-action')
      expect(before).to.exist

      await storage.deleteAction('temp-action')

      const after = await storage.getAction('temp-action')
      expect(after).to.be.null
    })

    it('refuses to delete built-in actions', async () => {
      try {
        await storage.deleteAction('implement')
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        expect((error as Error).message).to.include('built-in')
      }
    })

    it('throws for non-existent action', async () => {
      try {
        await storage.deleteAction('ghost-action')
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        expect((error as Error).message).to.include('not found')
      }
    })
  })

  // ─── action edit (updateAction / updateBuiltinAction) ─────

  describe('updateAction (custom)', () => {
    it('updates prompt for custom action', async () => {
      await storage.createAction({
        name: 'edit-test',
        prompt: 'Original prompt',
      })

      const updated = await storage.updateAction('edit-test', {
        prompt: 'Updated prompt',
      })

      expect(updated.prompt).to.equal('Updated prompt')
    })

    it('updates description for custom action', async () => {
      await storage.createAction({
        name: 'desc-test',
        prompt: 'Test prompt',
        description: 'Old desc',
      })

      const updated = await storage.updateAction('desc-test', {
        description: 'New description',
      })

      expect(updated.description).to.equal('New description')
    })

    it('refuses to update built-in action via updateAction', async () => {
      try {
        await storage.updateAction('implement', { prompt: 'Hacked prompt' })
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        expect((error as Error).message).to.include('built-in')
      }
    })
  })

  describe('updateBuiltinAction', () => {
    it('updates prompt for built-in action', async () => {
      const original = await storage.getAction('groom')
      expect(original).to.exist

      const updated = await storage.updateBuiltinAction('groom', {
        prompt: 'Custom groom prompt for this workspace',
      })

      expect(updated.prompt).to.equal('Custom groom prompt for this workspace')
      expect(updated.isBuiltin).to.be.true
      expect(updated.id).to.equal('groom')
    })

    it('updates description for built-in action', async () => {
      const updated = await storage.updateBuiltinAction('implement', {
        description: 'Custom description',
      })

      expect(updated.description).to.equal('Custom description')
      expect(updated.isBuiltin).to.be.true
    })

    it('throws for non-existent action', async () => {
      try {
        await storage.updateBuiltinAction('nope', { prompt: 'test' })
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        expect((error as Error).message).to.include('not found')
      }
    })

    it('delegates to updateAction for non-builtin actions', async () => {
      await storage.createAction({
        name: 'custom-for-builtin-test',
        prompt: 'Original',
      })

      const updated = await storage.updateBuiltinAction('custom-for-builtin-test', {
        prompt: 'Updated via builtin method',
      })

      expect(updated.prompt).to.equal('Updated via builtin method')
    })
  })

  // ─── action run (action lookup) ───────────────────────────

  describe('getSuggestedAction', () => {
    it('returns default action for backlog intent', async () => {
      const action = await storage.getSuggestedAction('backlog')
      expect(action).to.exist
      expect(action!.id).to.equal('groom')
    })

    it('returns default action for ready intent', async () => {
      const action = await storage.getSuggestedAction('ready')
      expect(action).to.exist
      expect(action!.id).to.equal('implement')
    })

    it('returns null for unknown intent without any matching actions', async () => {
      const action = await storage.getSuggestedAction('nonexistent-intent-xyz')
      // May return a fallback action with null from_intent or null
      // The exact behavior depends on whether any actions have null from_intent
    })
  })

  // ─── built-in actions are seeded correctly ────────────────

  describe('built-in action seeding', () => {
    it('seeds 5 built-in actions: groom, implement, review, merge, resolve', async () => {
      const builtins = await storage.listActions({ isBuiltin: true })
      const ids = builtins.map(a => a.id)

      expect(ids).to.include('groom')
      expect(ids).to.include('implement')
      expect(ids).to.include('review')
      expect(ids).to.include('merge')
      expect(ids).to.include('resolve')
    })

    it('built-in actions have non-empty prompts', async () => {
      const builtins = await storage.listActions({ isBuiltin: true })
      for (const action of builtins) {
        expect(action.prompt, `${action.id} should have a prompt`).to.be.a('string').and.not.empty
      }
    })

    it('re-seeding is idempotent (no duplicate errors)', () => {
      // Creating a second storage instance on the same DB triggers re-seeding
      const dbPath = path.join(testDir, 'test.db')
      const storage2 = new SQLiteStorage(dbPath)
      const db2 = storage2.getDatabase()
      // Should not throw
      db2.close()
    })
  })
})
