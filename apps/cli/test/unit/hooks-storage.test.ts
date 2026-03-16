import { expect } from 'chai'
import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  WorkHookStorage,
  ensureHooksTable,
  HOOKS_TABLE,
  HOOKS_TABLE_SCHEMA,
} from '../../src/lib/work-lifecycle/hooks/storage.js'
import type { HookableEvent, HookActionType, WorkHookConfig } from '../../src/lib/work-lifecycle/hooks/types.js'
import { HOOKABLE_EVENTS } from '../../src/lib/work-lifecycle/hooks/types.js'

/**
 * CRUD tests for WorkHookStorage — verifies database operations for hook configs.
 * TKT-140: Close coverage gaps in hook system.
 */

describe('WorkHookStorage (TKT-140)', () => {
  let db: Database.Database
  let storage: WorkHookStorage
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-test-'))
    const dbPath = path.join(tmpDir, 'test.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    storage = new WorkHookStorage(db)
  })

  afterEach(() => {
    if (db) db.close()
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  // =========================================================================
  // Table Creation
  // =========================================================================
  describe('ensureHooksTable', () => {
    it('should create the table if it does not exist', () => {
      const freshDb = new Database(':memory:')
      ensureHooksTable(freshDb)
      const tables = freshDb.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
      ).get(HOOKS_TABLE) as { name: string } | undefined
      expect(tables).to.exist
      expect(tables!.name).to.equal(HOOKS_TABLE)
      freshDb.close()
    })

    it('should be safe to call multiple times', () => {
      expect(() => {
        ensureHooksTable(db)
        ensureHooksTable(db)
      }).to.not.throw()
    })

    it('should create indexes for event and enabled columns', () => {
      const indexes = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?`
      ).all(HOOKS_TABLE) as Array<{ name: string }>
      const indexNames = indexes.map(i => i.name)
      expect(indexNames).to.include('idx_pmo_work_hooks_event')
      expect(indexNames).to.include('idx_pmo_work_hooks_enabled')
    })
  })

  // =========================================================================
  // Create
  // =========================================================================
  describe('create', () => {
    it('should create a hook and return it with generated id', () => {
      const hook = storage.create({
        name: 'notify-slack',
        event: 'work:started',
        actionType: 'shell',
        actionValue: 'curl -X POST https://hooks.slack.com/...',
      })
      expect(hook).to.have.property('id').that.is.a('string')
      expect(hook.name).to.equal('notify-slack')
      expect(hook.event).to.equal('work:started')
      expect(hook.actionType).to.equal('shell')
      expect(hook.actionValue).to.include('curl')
      expect(hook.enabled).to.be.true
      expect(hook.createdAt).to.be.a('string')
    })

    it('should create a hook with optional description', () => {
      const hook = storage.create({
        name: 'with-desc',
        event: 'agent:spawned',
        actionType: 'log',
        actionValue: 'Agent spawned: {{agentName}}',
        description: 'Log when any agent is spawned',
      })
      expect(hook.description).to.equal('Log when any agent is spawned')
    })

    it('should set description to null when not provided', () => {
      const hook = storage.create({
        name: 'no-desc',
        event: 'work:completed',
        actionType: 'webhook',
        actionValue: 'https://example.com/hook',
      })
      expect(hook.description).to.be.null
    })

    it('should reject duplicate names', () => {
      storage.create({
        name: 'unique-hook',
        event: 'work:started',
        actionType: 'log',
        actionValue: 'test',
      })
      expect(() => {
        storage.create({
          name: 'unique-hook',
          event: 'work:completed',
          actionType: 'log',
          actionValue: 'test2',
        })
      }).to.throw()
    })

    it('should reject invalid action types', () => {
      expect(() => {
        storage.create({
          name: 'bad-type',
          event: 'work:started',
          actionType: 'invalid' as HookActionType,
          actionValue: 'test',
        })
      }).to.throw()
    })

    it('should create hooks for all hookable events', () => {
      for (const event of HOOKABLE_EVENTS) {
        const hook = storage.create({
          name: `hook-${event}`,
          event,
          actionType: 'log',
          actionValue: `Event: ${event}`,
        })
        expect(hook.event).to.equal(event)
      }
    })

    it('should create hooks with each action type', () => {
      const actionTypes: HookActionType[] = ['shell', 'webhook', 'log']
      for (const actionType of actionTypes) {
        const hook = storage.create({
          name: `hook-${actionType}`,
          event: 'work:started',
          actionType,
          actionValue: `test-${actionType}`,
        })
        expect(hook.actionType).to.equal(actionType)
      }
    })
  })

  // =========================================================================
  // Read
  // =========================================================================
  describe('list', () => {
    beforeEach(() => {
      storage.create({ name: 'h1', event: 'work:started', actionType: 'shell', actionValue: 'echo 1' })
      storage.create({ name: 'h2', event: 'work:completed', actionType: 'log', actionValue: 'done' })
      storage.create({ name: 'h3', event: 'work:started', actionType: 'webhook', actionValue: 'https://x.com' })
    })

    it('should return all hooks with no filter', () => {
      const hooks = storage.list()
      expect(hooks).to.have.lengthOf(3)
    })

    it('should filter by event', () => {
      const hooks = storage.list({ event: 'work:started' })
      expect(hooks).to.have.lengthOf(2)
      for (const h of hooks) {
        expect(h.event).to.equal('work:started')
      }
    })

    it('should filter by enabled status', () => {
      // Disable one hook
      const all = storage.list()
      storage.setEnabled(all[0].id, false)

      const enabled = storage.list({ enabled: true })
      expect(enabled).to.have.lengthOf(2)

      const disabled = storage.list({ enabled: false })
      expect(disabled).to.have.lengthOf(1)
    })

    it('should combine event and enabled filters', () => {
      const all = storage.list({ event: 'work:started' })
      storage.setEnabled(all[0].id, false)

      const result = storage.list({ event: 'work:started', enabled: true })
      expect(result).to.have.lengthOf(1)
    })

    it('should order by created_at ascending', () => {
      const hooks = storage.list()
      expect(hooks[0].name).to.equal('h1')
      expect(hooks[2].name).to.equal('h3')
    })

    it('should return empty array when no matches', () => {
      const hooks = storage.list({ event: 'agent:stopped' })
      expect(hooks).to.be.an('array').with.lengthOf(0)
    })
  })

  describe('getById', () => {
    it('should return the hook by id', () => {
      const created = storage.create({ name: 'find-me', event: 'work:started', actionType: 'log', actionValue: 'x' })
      const found = storage.getById(created.id)
      expect(found).to.not.be.null
      expect(found!.id).to.equal(created.id)
      expect(found!.name).to.equal('find-me')
    })

    it('should return null for non-existent id', () => {
      expect(storage.getById('non-existent-uuid')).to.be.null
    })
  })

  describe('getByName', () => {
    it('should return the hook by name', () => {
      storage.create({ name: 'named-hook', event: 'work:started', actionType: 'log', actionValue: 'x' })
      const found = storage.getByName('named-hook')
      expect(found).to.not.be.null
      expect(found!.name).to.equal('named-hook')
    })

    it('should return null for non-existent name', () => {
      expect(storage.getByName('does-not-exist')).to.be.null
    })
  })

  // =========================================================================
  // Update (setEnabled)
  // =========================================================================
  describe('setEnabled', () => {
    it('should disable a hook', () => {
      const hook = storage.create({ name: 'toggle', event: 'work:started', actionType: 'log', actionValue: 'x' })
      expect(hook.enabled).to.be.true

      const result = storage.setEnabled(hook.id, false)
      expect(result).to.be.true

      const updated = storage.getById(hook.id)
      expect(updated!.enabled).to.be.false
    })

    it('should re-enable a disabled hook', () => {
      const hook = storage.create({ name: 'toggle2', event: 'work:started', actionType: 'log', actionValue: 'x' })
      storage.setEnabled(hook.id, false)
      storage.setEnabled(hook.id, true)

      const updated = storage.getById(hook.id)
      expect(updated!.enabled).to.be.true
    })

    it('should return false for non-existent hook', () => {
      const result = storage.setEnabled('bogus-id', true)
      expect(result).to.be.false
    })
  })

  // =========================================================================
  // Delete
  // =========================================================================
  describe('delete', () => {
    it('should delete an existing hook', () => {
      const hook = storage.create({ name: 'delete-me', event: 'work:started', actionType: 'log', actionValue: 'x' })
      const result = storage.delete(hook.id)
      expect(result).to.be.true
      expect(storage.getById(hook.id)).to.be.null
    })

    it('should return false for non-existent hook', () => {
      expect(storage.delete('bogus-id')).to.be.false
    })

    it('should not affect other hooks', () => {
      const h1 = storage.create({ name: 'keep', event: 'work:started', actionType: 'log', actionValue: 'a' })
      const h2 = storage.create({ name: 'remove', event: 'work:started', actionType: 'log', actionValue: 'b' })
      storage.delete(h2.id)
      expect(storage.getById(h1.id)).to.not.be.null
      expect(storage.list()).to.have.lengthOf(1)
    })
  })
})
