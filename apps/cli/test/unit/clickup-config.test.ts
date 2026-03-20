import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  isClickUpConfigured,
  loadClickUpConfig,
  saveClickUpApiKey,
  saveClickUpWorkspace,
  saveClickUpSpace,
  clearClickUpConfig,
  getClickUpApiKey,
} from '../../src/lib/clickup/config.js'

describe('ClickUp config', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)
  })

  afterEach(() => {
    db.close()
  })

  describe('isClickUpConfigured', () => {
    it('returns false when no config exists', () => {
      expect(isClickUpConfigured(db)).to.equal(false)
    })

    it('returns true when api_key is stored in db', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('clickup.api_key', 'pk_test')
      expect(isClickUpConfigured(db)).to.equal(true)
    })

    it('returns true when env var is set', () => {
      const orig = process.env.PRLT_CLICKUP_API_KEY
      try {
        process.env.PRLT_CLICKUP_API_KEY = 'pk_env'
        expect(isClickUpConfigured(db)).to.equal(true)
      } finally {
        if (orig === undefined) delete process.env.PRLT_CLICKUP_API_KEY
        else process.env.PRLT_CLICKUP_API_KEY = orig
      }
    })

    it('returns true when CLICKUP_API_KEY env var is set', () => {
      const orig = process.env.CLICKUP_API_KEY
      try {
        process.env.CLICKUP_API_KEY = 'pk_env2'
        expect(isClickUpConfigured(db)).to.equal(true)
      } finally {
        if (orig === undefined) delete process.env.CLICKUP_API_KEY
        else process.env.CLICKUP_API_KEY = orig
      }
    })
  })

  describe('loadClickUpConfig', () => {
    it('returns null when not configured', () => {
      expect(loadClickUpConfig(db)).to.equal(null)
    })

    it('loads config from database', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('clickup.api_key', 'pk_test')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('clickup.workspace_id', 'ws123')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('clickup.workspace_name', 'My Workspace')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('clickup.space_id', 'sp456')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('clickup.space_name', 'My Space')

      const config = loadClickUpConfig(db)
      expect(config).to.deep.equal({
        apiKey: 'pk_test',
        workspaceId: 'ws123',
        workspaceName: 'My Workspace',
        spaceId: 'sp456',
        spaceName: 'My Space',
      })
    })

    it('loads config with only api key', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('clickup.api_key', 'pk_test')

      const config = loadClickUpConfig(db)
      expect(config?.apiKey).to.equal('pk_test')
      expect(config?.workspaceId).to.equal(undefined)
      expect(config?.spaceId).to.equal(undefined)
    })
  })

  describe('saveClickUpApiKey', () => {
    it('saves and can reload api key', () => {
      saveClickUpApiKey(db, 'pk_saved')
      const config = loadClickUpConfig(db)
      expect(config?.apiKey).to.equal('pk_saved')
    })
  })

  describe('saveClickUpWorkspace', () => {
    it('saves workspace id and name', () => {
      saveClickUpApiKey(db, 'pk_test')
      saveClickUpWorkspace(db, 'ws789', 'Test Workspace')

      const config = loadClickUpConfig(db)
      expect(config?.workspaceId).to.equal('ws789')
      expect(config?.workspaceName).to.equal('Test Workspace')
    })
  })

  describe('saveClickUpSpace', () => {
    it('saves space id and name', () => {
      saveClickUpApiKey(db, 'pk_test')
      saveClickUpSpace(db, 'sp012', 'Test Space')

      const config = loadClickUpConfig(db)
      expect(config?.spaceId).to.equal('sp012')
      expect(config?.spaceName).to.equal('Test Space')
    })
  })

  describe('clearClickUpConfig', () => {
    it('removes all ClickUp settings', () => {
      saveClickUpApiKey(db, 'pk_clear')
      saveClickUpWorkspace(db, 'ws_clear', 'Clear WS')
      saveClickUpSpace(db, 'sp_clear', 'Clear Space')

      expect(isClickUpConfigured(db)).to.equal(true)
      clearClickUpConfig(db)
      expect(isClickUpConfigured(db)).to.equal(false)
      expect(loadClickUpConfig(db)).to.equal(null)
    })
  })

  describe('getClickUpApiKey', () => {
    it('returns key from database', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('clickup.api_key', 'pk_db')
      expect(getClickUpApiKey(db)).to.equal('pk_db')
    })

    it('returns null when not configured', () => {
      expect(getClickUpApiKey(db)).to.equal(null)
    })

    it('prefers env var over database', () => {
      const orig = process.env.PRLT_CLICKUP_API_KEY
      try {
        db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('clickup.api_key', 'pk_db')
        process.env.PRLT_CLICKUP_API_KEY = 'pk_env'
        expect(getClickUpApiKey(db)).to.equal('pk_env')
      } finally {
        if (orig === undefined) delete process.env.PRLT_CLICKUP_API_KEY
        else process.env.PRLT_CLICKUP_API_KEY = orig
      }
    })
  })
})
