import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  getCleanupPolicy,
  setDefaultCleanupPolicy,
  setActionCleanupPolicy,
} from '../../src/lib/execution/config.js'
import { createFastTestDb, type FastTestDb } from '../e2e/test-helpers.js'

/**
 * Unit tests for cleanup policy configuration (PRLT-1061)
 *
 * Tests the workspace_settings-based cleanup policy resolution:
 * - cleanup.default → workspace-wide default
 * - cleanup.actions.{actionId} → per-action override
 * - Falls back to 'on-exit' when nothing is configured
 */
describe('@smoke Cleanup Policy Config', () => {
  let fastDb: FastTestDb
  let db: Database.Database

  before(() => {
    fastDb = createFastTestDb((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspace_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `)
    })
    db = fastDb.db
  })

  beforeEach(() => {
    fastDb.savepoint()
  })

  afterEach(() => {
    fastDb.rollback()
  })

  after(() => {
    fastDb.close()
  })

  describe('getCleanupPolicy', () => {
    it('returns on-exit when nothing is configured', () => {
      const policy = getCleanupPolicy(db)
      expect(policy).to.equal('on-exit')
    })

    it('returns workspace default when set', () => {
      setDefaultCleanupPolicy(db, 'persistent')
      const policy = getCleanupPolicy(db)
      expect(policy).to.equal('persistent')
    })

    it('returns per-action override when set', () => {
      setDefaultCleanupPolicy(db, 'on-exit')
      setActionCleanupPolicy(db, 'orchestrator', 'persistent')

      // Without action, returns default
      expect(getCleanupPolicy(db)).to.equal('on-exit')

      // With action, returns override
      expect(getCleanupPolicy(db, 'orchestrator')).to.equal('persistent')
    })

    it('falls back to default when action has no override', () => {
      setDefaultCleanupPolicy(db, 'on-error-keep')

      // Action with no override falls back to default
      expect(getCleanupPolicy(db, 'implement')).to.equal('on-error-keep')
    })

    it('ignores invalid policy values', () => {
      // Set an invalid value directly
      db.prepare(`
        INSERT INTO workspace_settings (key, value) VALUES ('cleanup.default', 'invalid-policy')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run()

      // Should fall back to 'on-exit'
      expect(getCleanupPolicy(db)).to.equal('on-exit')
    })

    it('supports on-error-keep policy', () => {
      setDefaultCleanupPolicy(db, 'on-error-keep')
      expect(getCleanupPolicy(db)).to.equal('on-error-keep')
    })
  })

  describe('setDefaultCleanupPolicy', () => {
    it('updates the default policy', () => {
      setDefaultCleanupPolicy(db, 'persistent')
      expect(getCleanupPolicy(db)).to.equal('persistent')

      setDefaultCleanupPolicy(db, 'on-exit')
      expect(getCleanupPolicy(db)).to.equal('on-exit')
    })
  })

  describe('setActionCleanupPolicy', () => {
    it('sets per-action override', () => {
      setActionCleanupPolicy(db, 'orchestrator', 'persistent')
      expect(getCleanupPolicy(db, 'orchestrator')).to.equal('persistent')
    })

    it('allows different policies per action', () => {
      setActionCleanupPolicy(db, 'orchestrator', 'persistent')
      setActionCleanupPolicy(db, 'implement', 'on-error-keep')

      expect(getCleanupPolicy(db, 'orchestrator')).to.equal('persistent')
      expect(getCleanupPolicy(db, 'implement')).to.equal('on-error-keep')
    })
  })
})
