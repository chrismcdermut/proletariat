import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  isTrelloConfigured,
  loadTrelloConfig,
  saveTrelloConfig,
  clearTrelloConfig,
  getTrelloApiKey,
  getTrelloApiToken,
} from '../../src/lib/trello/config.js'

describe('Trello config', () => {
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

  const savedEnv: Record<string, string | undefined> = {}

  before(() => {
    savedEnv.PRLT_TRELLO_API_KEY = process.env.PRLT_TRELLO_API_KEY
    savedEnv.TRELLO_API_KEY = process.env.TRELLO_API_KEY
    savedEnv.PRLT_TRELLO_TOKEN = process.env.PRLT_TRELLO_TOKEN
    savedEnv.TRELLO_TOKEN = process.env.TRELLO_TOKEN
    savedEnv.PRLT_TRELLO_BOARD_ID = process.env.PRLT_TRELLO_BOARD_ID
    savedEnv.TRELLO_BOARD_ID = process.env.TRELLO_BOARD_ID
  })

  beforeEach(() => {
    delete process.env.PRLT_TRELLO_API_KEY
    delete process.env.TRELLO_API_KEY
    delete process.env.PRLT_TRELLO_TOKEN
    delete process.env.TRELLO_TOKEN
    delete process.env.PRLT_TRELLO_BOARD_ID
    delete process.env.TRELLO_BOARD_ID
  })

  after(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[key] = value
      else delete process.env[key]
    }
  })

  describe('isTrelloConfigured', () => {
    it('returns false when no config exists', () => {
      expect(isTrelloConfigured(db)).to.equal(false)
    })

    it('returns true when api_key and api_token are stored in db', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_key', 'key_test')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_token', 'tok_test')
      expect(isTrelloConfigured(db)).to.equal(true)
    })

    it('returns false when only api_key is stored', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_key', 'key_test')
      expect(isTrelloConfigured(db)).to.equal(false)
    })

    it('returns true when env vars are set', () => {
      process.env.PRLT_TRELLO_API_KEY = 'key_env'
      process.env.PRLT_TRELLO_TOKEN = 'tok_env'
      expect(isTrelloConfigured(db)).to.equal(true)
    })
  })

  describe('loadTrelloConfig', () => {
    it('returns null when not configured', () => {
      expect(loadTrelloConfig(db)).to.equal(null)
    })

    it('loads config from database', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_key', 'key_test')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_token', 'tok_test')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.board_id', 'board_123')

      const config = loadTrelloConfig(db)
      expect(config).to.deep.equal({
        apiKey: 'key_test',
        apiToken: 'tok_test',
        boardId: 'board_123',
      })
    })

    it('loads config with only key and token', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_key', 'key_test')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_token', 'tok_test')

      const config = loadTrelloConfig(db)
      expect(config?.apiKey).to.equal('key_test')
      expect(config?.apiToken).to.equal('tok_test')
      expect(config?.boardId).to.equal(undefined)
    })

    it('returns null when only key is provided', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_key', 'key_test')
      expect(loadTrelloConfig(db)).to.equal(null)
    })
  })

  describe('saveTrelloConfig', () => {
    it('saves and can reload config', () => {
      saveTrelloConfig(db, {
        apiKey: 'key_saved',
        apiToken: 'tok_saved',
        boardId: 'board_saved',
      })

      const config = loadTrelloConfig(db)
      expect(config?.apiKey).to.equal('key_saved')
      expect(config?.apiToken).to.equal('tok_saved')
      expect(config?.boardId).to.equal('board_saved')
    })
  })

  describe('clearTrelloConfig', () => {
    it('removes all Trello settings', () => {
      saveTrelloConfig(db, {
        apiKey: 'key_clear',
        apiToken: 'tok_clear',
        boardId: 'board_clear',
      })

      expect(isTrelloConfigured(db)).to.equal(true)
      clearTrelloConfig(db)
      expect(isTrelloConfigured(db)).to.equal(false)
      expect(loadTrelloConfig(db)).to.equal(null)
    })
  })

  describe('getTrelloApiKey', () => {
    it('returns key from database', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_key', 'key_db')
      expect(getTrelloApiKey(db)).to.equal('key_db')
    })

    it('returns null when not configured', () => {
      expect(getTrelloApiKey(db)).to.equal(null)
    })

    it('prefers env var over database', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_key', 'key_db')
      process.env.PRLT_TRELLO_API_KEY = 'key_env'
      expect(getTrelloApiKey(db)).to.equal('key_env')
    })
  })

  describe('getTrelloApiToken', () => {
    it('returns token from database', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_token', 'tok_db')
      expect(getTrelloApiToken(db)).to.equal('tok_db')
    })

    it('returns null when not configured', () => {
      expect(getTrelloApiToken(db)).to.equal(null)
    })

    it('prefers env var over database', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_token', 'tok_db')
      process.env.PRLT_TRELLO_TOKEN = 'tok_env'
      expect(getTrelloApiToken(db)).to.equal('tok_env')
    })
  })
})
