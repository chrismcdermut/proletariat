import { expect } from 'chai'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { isShortcutConfigured, loadShortcutConfig, saveShortcutConfig, clearShortcutConfig, getShortcutApiToken } from '../../src/lib/shortcut/config.js'
import { createFastTestDb, type FastTestDb } from '../e2e/test-helpers.js'

describe('Shortcut config', () => {
  let fastDb: FastTestDb
  let db: SqliteDatabase

  before(() => {
    fastDb = createFastTestDb((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspace_settings (
          key TEXT PRIMARY KEY,
          value TEXT
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

  describe('isShortcutConfigured', () => {
    it('returns false when no config exists', () => {
      expect(isShortcutConfigured(db)).to.equal(false)
    })

    it('returns true when api_token is stored in db', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('shortcut.api_token', 'tok_test')
      expect(isShortcutConfigured(db)).to.equal(true)
    })

    it('returns true when env vars are set', () => {
      const origToken = process.env.PRLT_SHORTCUT_API_TOKEN
      try {
        process.env.PRLT_SHORTCUT_API_TOKEN = 'tok_env'
        expect(isShortcutConfigured(db)).to.equal(true)
      } finally {
        if (origToken === undefined) delete process.env.PRLT_SHORTCUT_API_TOKEN
        else process.env.PRLT_SHORTCUT_API_TOKEN = origToken
      }
    })
  })

  describe('loadShortcutConfig', () => {
    it('returns null when not configured', () => {
      expect(loadShortcutConfig(db)).to.equal(null)
    })

    it('loads config from database', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('shortcut.api_token', 'tok_test')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('shortcut.workspace_slug', 'my-workspace')

      const config = loadShortcutConfig(db)
      expect(config).to.deep.equal({
        apiToken: 'tok_test',
        workspaceSlug: 'my-workspace',
      })
    })

    it('loads config with only token', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('shortcut.api_token', 'tok_test')

      const config = loadShortcutConfig(db)
      expect(config?.apiToken).to.equal('tok_test')
      expect(config?.workspaceSlug).to.equal(undefined)
    })
  })

  describe('saveShortcutConfig', () => {
    it('saves and can reload config', () => {
      saveShortcutConfig(db, {
        apiToken: 'tok_saved',
        workspaceSlug: 'saved-workspace',
      })

      const config = loadShortcutConfig(db)
      expect(config?.apiToken).to.equal('tok_saved')
      expect(config?.workspaceSlug).to.equal('saved-workspace')
    })
  })

  describe('clearShortcutConfig', () => {
    it('removes all Shortcut settings', () => {
      saveShortcutConfig(db, {
        apiToken: 'tok_clear',
        workspaceSlug: 'clear-workspace',
      })

      expect(isShortcutConfigured(db)).to.equal(true)
      clearShortcutConfig(db)
      expect(isShortcutConfigured(db)).to.equal(false)
      expect(loadShortcutConfig(db)).to.equal(null)
    })
  })

  describe('getShortcutApiToken', () => {
    it('returns token from database', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('shortcut.api_token', 'tok_db')
      expect(getShortcutApiToken(db)).to.equal('tok_db')
    })

    it('returns null when not configured', () => {
      expect(getShortcutApiToken(db)).to.equal(null)
    })

    it('prefers env var over database', () => {
      const orig = process.env.PRLT_SHORTCUT_API_TOKEN
      try {
        db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('shortcut.api_token', 'tok_db')
        process.env.PRLT_SHORTCUT_API_TOKEN = 'tok_env'
        expect(getShortcutApiToken(db)).to.equal('tok_env')
      } finally {
        if (orig === undefined) delete process.env.PRLT_SHORTCUT_API_TOKEN
        else process.env.PRLT_SHORTCUT_API_TOKEN = orig
      }
    })
  })
})
