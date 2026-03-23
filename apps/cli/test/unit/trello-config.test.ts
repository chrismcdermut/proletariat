import { expect } from 'chai'
import Database from 'better-sqlite3'
import { isTrelloConfigured, loadTrelloConfig, saveTrelloConfig, clearTrelloConfig, getTrelloApiKey, getTrelloApiToken, saveTrelloBoard } from '../../src/lib/trello/config.js'

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

  describe('isTrelloConfigured', () => {
    it('returns false when no config exists', () => {
      expect(isTrelloConfigured(db)).to.equal(false)
    })

    it('returns true when api_key and api_token are stored in db', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_key', 'key_test')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_token', 'tok_test')
      expect(isTrelloConfigured(db)).to.equal(true)
    })

    it('returns false when only api_key is stored (missing token)', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_key', 'key_test')
      expect(isTrelloConfigured(db)).to.equal(false)
    })

    it('returns true when env vars are set', () => {
      const origKey = process.env.PRLT_TRELLO_API_KEY
      const origToken = process.env.PRLT_TRELLO_API_TOKEN
      try {
        process.env.PRLT_TRELLO_API_KEY = 'key_env'
        process.env.PRLT_TRELLO_API_TOKEN = 'tok_env'
        expect(isTrelloConfigured(db)).to.equal(true)
      } finally {
        if (origKey === undefined) delete process.env.PRLT_TRELLO_API_KEY
        else process.env.PRLT_TRELLO_API_KEY = origKey
        if (origToken === undefined) delete process.env.PRLT_TRELLO_API_TOKEN
        else process.env.PRLT_TRELLO_API_TOKEN = origToken
      }
    })
  })

  describe('loadTrelloConfig', () => {
    it('returns null when not configured', () => {
      expect(loadTrelloConfig(db)).to.equal(null)
    })

    it('loads config from database', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_key', 'key_test')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_token', 'tok_test')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.board_id', 'board123')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.board_name', 'My Board')

      const config = loadTrelloConfig(db)
      expect(config).to.deep.equal({
        apiKey: 'key_test',
        apiToken: 'tok_test',
        boardId: 'board123',
        boardName: 'My Board',
      })
    })

    it('loads config with only key and token', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_key', 'key_test')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_token', 'tok_test')

      const config = loadTrelloConfig(db)
      expect(config?.apiKey).to.equal('key_test')
      expect(config?.apiToken).to.equal('tok_test')
      expect(config?.boardId).to.equal(undefined)
      expect(config?.boardName).to.equal(undefined)
    })
  })

  describe('saveTrelloConfig', () => {
    it('saves and can reload config', () => {
      saveTrelloConfig(db, {
        apiKey: 'key_saved',
        apiToken: 'tok_saved',
        boardId: 'board_saved',
        boardName: 'Saved Board',
      })

      const config = loadTrelloConfig(db)
      expect(config?.apiKey).to.equal('key_saved')
      expect(config?.apiToken).to.equal('tok_saved')
      expect(config?.boardId).to.equal('board_saved')
      expect(config?.boardName).to.equal('Saved Board')
    })
  })

  describe('saveTrelloBoard', () => {
    it('saves board id and name', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_key', 'k')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_token', 't')
      saveTrelloBoard(db, 'boardX', 'Board X')

      const config = loadTrelloConfig(db)
      expect(config?.boardId).to.equal('boardX')
      expect(config?.boardName).to.equal('Board X')
    })
  })

  describe('clearTrelloConfig', () => {
    it('removes all Trello settings', () => {
      saveTrelloConfig(db, {
        apiKey: 'key_clear',
        apiToken: 'tok_clear',
        boardId: 'board_clear',
        boardName: 'Clear Board',
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
      const orig = process.env.PRLT_TRELLO_API_KEY
      try {
        db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_key', 'key_db')
        process.env.PRLT_TRELLO_API_KEY = 'key_env'
        expect(getTrelloApiKey(db)).to.equal('key_env')
      } finally {
        if (orig === undefined) delete process.env.PRLT_TRELLO_API_KEY
        else process.env.PRLT_TRELLO_API_KEY = orig
      }
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
      const orig = process.env.PRLT_TRELLO_API_TOKEN
      try {
        db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('trello.api_token', 'tok_db')
        process.env.PRLT_TRELLO_API_TOKEN = 'tok_env'
        expect(getTrelloApiToken(db)).to.equal('tok_env')
      } finally {
        if (orig === undefined) delete process.env.PRLT_TRELLO_API_TOKEN
        else process.env.PRLT_TRELLO_API_TOKEN = orig
      }
    })
  })
})
