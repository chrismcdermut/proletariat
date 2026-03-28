import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  parseWorkSourceRef,
  formatWorkSourceRef,
  getRegisteredWorkSources,
  saveDefaultWorkSource,
  loadDefaultWorkSource,
  clearDefaultWorkSource,
  isLocalTicketId,
  // Deprecated aliases still work
  saveActiveWorkSource,
  loadActiveWorkSource,
} from '../../src/lib/work-source/config.js'
import { CREATE_TABLES_SQL } from '../../src/lib/database/index.js'

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `)
  return db
}

describe('work-source config', () => {
  describe('parseWorkSourceRef', () => {
    it('parses provider only', () => {
      const ref = parseWorkSourceRef('jira')
      expect(ref.provider).to.equal('jira')
      expect(ref.context).to.be.undefined
    })

    it('parses provider:context', () => {
      expect(parseWorkSourceRef('jira:PROJ')).to.deep.equal({ provider: 'jira', context: 'PROJ' })
    })

    it('parses linear:ENG', () => {
      expect(parseWorkSourceRef('linear:ENG')).to.deep.equal({ provider: 'linear', context: 'ENG' })
    })

    it('handles case-insensitive provider', () => {
      expect(parseWorkSourceRef('JIRA:PROJ')).to.deep.equal({ provider: 'jira', context: 'PROJ' })
    })

    it('throws for unsupported provider', () => {
      expect(() => parseWorkSourceRef('bitbucket:PROJ')).to.throw('Unsupported work source provider')
    })

    it('throws for empty input', () => {
      expect(() => parseWorkSourceRef('')).to.throw('Work source cannot be empty')
    })
  })

  describe('formatWorkSourceRef', () => {
    it('formats provider only', () => {
      expect(formatWorkSourceRef({ provider: 'jira' })).to.equal('jira')
    })

    it('formats provider:context', () => {
      expect(formatWorkSourceRef({ provider: 'jira', context: 'PROJ' })).to.equal('jira:PROJ')
    })
  })

  describe('isLocalTicketId', () => {
    it('recognizes TKT-123 as local', () => {
      expect(isLocalTicketId('TKT-123')).to.equal(true)
    })

    it('recognizes TKT-1 as local', () => {
      expect(isLocalTicketId('TKT-1')).to.equal(true)
    })

    it('is case-insensitive', () => {
      expect(isLocalTicketId('tkt-42')).to.equal(true)
    })

    it('rejects PRLT-933 as not local', () => {
      expect(isLocalTicketId('PRLT-933')).to.equal(false)
    })

    it('rejects ENG-123 as not local', () => {
      expect(isLocalTicketId('ENG-123')).to.equal(false)
    })

    it('rejects plain text as not local', () => {
      expect(isLocalTicketId('some-ticket')).to.equal(false)
    })

    it('rejects TKT- without number', () => {
      expect(isLocalTicketId('TKT-')).to.equal(false)
    })

    it('rejects TKT-abc', () => {
      expect(isLocalTicketId('TKT-abc')).to.equal(false)
    })
  })

  describe('getRegisteredWorkSources', () => {
    it('returns pmo only by default', () => {
      const db = setupDb()
      const sources = getRegisteredWorkSources(db)
      expect(sources.map(s => s.provider)).to.deep.equal(['pmo'])
      db.close()
    })

    it('includes linear when configured', () => {
      const db = setupDb()
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('linear.api_key', 'lin_test')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('linear.default_team_key', 'ENG')

      const sources = getRegisteredWorkSources(db)
      const providers = sources.map(s => s.provider)
      expect(providers).to.include('pmo')
      expect(providers).to.include('linear')
      db.close()
    })

    it('includes jira when configured', () => {
      const db = setupDb()
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('jira.base_url', 'https://test.atlassian.net')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('jira.api_token', 'jira_tok')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('jira.project_key', 'PROJ')

      const sources = getRegisteredWorkSources(db)
      const providers = sources.map(s => s.provider)
      expect(providers).to.include('pmo')
      expect(providers).to.include('jira')

      const jiraSource = sources.find(s => s.provider === 'jira')
      expect(jiraSource?.context).to.equal('PROJ')
      db.close()
    })

    it('includes both linear and jira when both configured', () => {
      const db = setupDb()
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('linear.api_key', 'lin_test')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('jira.base_url', 'https://test.atlassian.net')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('jira.api_token', 'jira_tok')

      const sources = getRegisteredWorkSources(db)
      const providers = sources.map(s => s.provider)
      expect(providers).to.include('pmo')
      expect(providers).to.include('linear')
      expect(providers).to.include('jira')
      db.close()
    })
  })

  describe('default source persistence', () => {
    it('saves and loads jira default source', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'jira', context: 'PROJ' })
      const loaded = loadDefaultWorkSource(db)
      expect(loaded).to.deep.equal({ provider: 'jira', context: 'PROJ' })
      db.close()
    })

    it('saves and loads linear default source', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'linear', context: 'ENG' })
      const loaded = loadDefaultWorkSource(db)
      expect(loaded).to.deep.equal({ provider: 'linear', context: 'ENG' })
      db.close()
    })

    it('uses work.default_source key in database', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'linear', context: 'PRO' })

      const row = db.prepare(
        `SELECT value FROM workspace_settings WHERE key = 'work.default_source'`
      ).get() as { value: string } | undefined
      expect(row?.value).to.equal('linear:PRO')

      // Old key should not exist
      const oldRow = db.prepare(
        `SELECT value FROM workspace_settings WHERE key = 'work.active_source'`
      ).get() as { value: string } | undefined
      expect(oldRow).to.be.undefined
      db.close()
    })

    it('clears default source', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'linear', context: 'ENG' })
      clearDefaultWorkSource(db)
      const loaded = loadDefaultWorkSource(db)
      expect(loaded).to.equal(null)
      db.close()
    })

    it('returns null when no default source set', () => {
      const db = setupDb()
      const loaded = loadDefaultWorkSource(db)
      expect(loaded).to.equal(null)
      db.close()
    })
  })

  describe('legacy migration from work.active_source', () => {
    it('migrates legacy work.active_source to work.default_source on read', () => {
      const db = setupDb()
      // Simulate old data
      db.prepare(
        `INSERT INTO workspace_settings (key, value) VALUES ('work.active_source', 'linear:PRO')`
      ).run()

      const loaded = loadDefaultWorkSource(db)
      expect(loaded).to.deep.equal({ provider: 'linear', context: 'PRO' })

      // Old key should have been deleted
      const oldRow = db.prepare(
        `SELECT value FROM workspace_settings WHERE key = 'work.active_source'`
      ).get() as { value: string } | undefined
      expect(oldRow).to.be.undefined

      // New key should exist
      const newRow = db.prepare(
        `SELECT value FROM workspace_settings WHERE key = 'work.default_source'`
      ).get() as { value: string } | undefined
      expect(newRow?.value).to.equal('linear:PRO')
      db.close()
    })

    it('prefers work.default_source over legacy work.active_source', () => {
      const db = setupDb()
      // Both keys exist (shouldn't happen in practice, but defensive)
      db.prepare(
        `INSERT INTO workspace_settings (key, value) VALUES ('work.default_source', 'jira:PROJ')`
      ).run()
      db.prepare(
        `INSERT INTO workspace_settings (key, value) VALUES ('work.active_source', 'linear:OLD')`
      ).run()

      const loaded = loadDefaultWorkSource(db)
      expect(loaded).to.deep.equal({ provider: 'jira', context: 'PROJ' })
      db.close()
    })

    it('saveDefaultWorkSource cleans up legacy key', () => {
      const db = setupDb()
      db.prepare(
        `INSERT INTO workspace_settings (key, value) VALUES ('work.active_source', 'linear:OLD')`
      ).run()

      saveDefaultWorkSource(db, { provider: 'jira', context: 'NEW' })

      const oldRow = db.prepare(
        `SELECT value FROM workspace_settings WHERE key = 'work.active_source'`
      ).get() as { value: string } | undefined
      expect(oldRow).to.be.undefined

      const loaded = loadDefaultWorkSource(db)
      expect(loaded).to.deep.equal({ provider: 'jira', context: 'NEW' })
      db.close()
    })
  })

  describe('deprecated aliases', () => {
    it('saveActiveWorkSource delegates to saveDefaultWorkSource', () => {
      const db = setupDb()
      saveActiveWorkSource(db, { provider: 'jira', context: 'PROJ' })
      const loaded = loadDefaultWorkSource(db)
      expect(loaded).to.deep.equal({ provider: 'jira', context: 'PROJ' })
      db.close()
    })

    it('loadActiveWorkSource delegates to loadDefaultWorkSource', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'linear', context: 'ENG' })
      const loaded = loadActiveWorkSource(db)
      expect(loaded).to.deep.equal({ provider: 'linear', context: 'ENG' })
      db.close()
    })
  })
})
