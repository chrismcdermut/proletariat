import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  parseWorkSourceRef,
  formatWorkSourceRef,
  getRegisteredWorkSources,
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
      expect(() => parseWorkSourceRef('github:PROJ')).to.throw('Unsupported work source provider')
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

  describe('active source persistence', () => {
    it('saves and loads jira active source', () => {
      const db = setupDb()
      saveActiveWorkSource(db, { provider: 'jira', context: 'PROJ' })
      const loaded = loadActiveWorkSource(db)
      expect(loaded).to.deep.equal({ provider: 'jira', context: 'PROJ' })
      db.close()
    })

    it('saves and loads linear active source', () => {
      const db = setupDb()
      saveActiveWorkSource(db, { provider: 'linear', context: 'ENG' })
      const loaded = loadActiveWorkSource(db)
      expect(loaded).to.deep.equal({ provider: 'linear', context: 'ENG' })
      db.close()
    })
  })
})
