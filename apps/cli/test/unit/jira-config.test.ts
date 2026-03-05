import { expect } from 'chai'
import Database from 'better-sqlite3'
import { isJiraConfigured, loadJiraConfig, saveJiraConfig, clearJiraConfig } from '../../src/lib/jira/config.js'

describe('Jira config', () => {
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

  describe('isJiraConfigured', () => {
    it('returns false when no config exists', () => {
      expect(isJiraConfigured(db)).to.equal(false)
    })

    it('returns true when base_url and api_token are stored in db', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('jira.base_url', 'https://myorg.atlassian.net')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('jira.api_token', 'tok_test')
      expect(isJiraConfigured(db)).to.equal(true)
    })

    it('returns true when env vars are set', () => {
      const origUrl = process.env.PRLT_JIRA_BASE_URL
      const origToken = process.env.PRLT_JIRA_API_TOKEN
      try {
        process.env.PRLT_JIRA_BASE_URL = 'https://test.atlassian.net'
        process.env.PRLT_JIRA_API_TOKEN = 'tok_env'
        expect(isJiraConfigured(db)).to.equal(true)
      } finally {
        if (origUrl === undefined) delete process.env.PRLT_JIRA_BASE_URL
        else process.env.PRLT_JIRA_BASE_URL = origUrl
        if (origToken === undefined) delete process.env.PRLT_JIRA_API_TOKEN
        else process.env.PRLT_JIRA_API_TOKEN = origToken
      }
    })

    it('returns false when only base_url is set', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('jira.base_url', 'https://myorg.atlassian.net')
      expect(isJiraConfigured(db)).to.equal(false)
    })
  })

  describe('loadJiraConfig', () => {
    it('returns null when not configured', () => {
      expect(loadJiraConfig(db)).to.equal(null)
    })

    it('loads config from database', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('jira.base_url', 'https://myorg.atlassian.net')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('jira.api_token', 'tok_test')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('jira.email', 'user@example.com')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('jira.project_key', 'PROJ')

      const config = loadJiraConfig(db)
      expect(config).to.deep.equal({
        baseUrl: 'https://myorg.atlassian.net',
        apiToken: 'tok_test',
        email: 'user@example.com',
        projectKey: 'PROJ',
      })
    })
  })

  describe('saveJiraConfig', () => {
    it('saves and can reload config', () => {
      saveJiraConfig(db, {
        baseUrl: 'https://saved.atlassian.net',
        apiToken: 'tok_saved',
        email: 'saved@example.com',
        projectKey: 'SAVED',
      })

      const config = loadJiraConfig(db)
      expect(config?.baseUrl).to.equal('https://saved.atlassian.net')
      expect(config?.apiToken).to.equal('tok_saved')
      expect(config?.email).to.equal('saved@example.com')
      expect(config?.projectKey).to.equal('SAVED')
    })
  })

  describe('clearJiraConfig', () => {
    it('removes all Jira settings', () => {
      saveJiraConfig(db, {
        baseUrl: 'https://clear.atlassian.net',
        apiToken: 'tok_clear',
      })

      expect(isJiraConfigured(db)).to.equal(true)
      clearJiraConfig(db)
      expect(isJiraConfigured(db)).to.equal(false)
      expect(loadJiraConfig(db)).to.equal(null)
    })
  })
})
