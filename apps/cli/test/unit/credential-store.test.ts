import { expect } from 'chai'
import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

import {
  isCredentialKey,
  getCredentialDatabasePath,
  getCredential,
  setCredential,
  deleteCredential,
  hasCredential,
  migrateCredentials,
  closeAllCredentialStores,
} from '../../src/lib/database/credential-store.js'

// =============================================================================
// Helpers
// =============================================================================

function createTempWorkspace(): { workspacePath: string; db: Database.Database } {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-cred-test-'))
  const proletariatDir = path.join(workspacePath, '.proletariat')
  fs.mkdirSync(proletariatDir, { recursive: true })

  const dbPath = path.join(proletariatDir, 'workspace.db')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
  return { workspacePath, db }
}

function cleanup(workspacePath: string, db: Database.Database): void {
  try { db.close() } catch { /* */ }
  closeAllCredentialStores()
  try { fs.rmSync(workspacePath, { recursive: true, force: true }) } catch { /* */ }
}

// =============================================================================
// Tests
// =============================================================================

describe('Credential Store (PRLT-1114)', () => {
  let workspacePath: string
  let db: Database.Database

  beforeEach(() => {
    const setup = createTempWorkspace()
    workspacePath = setup.workspacePath
    db = setup.db
  })

  afterEach(() => {
    cleanup(workspacePath, db)
  })

  describe('isCredentialKey', () => {
    it('should identify known credential keys', () => {
      expect(isCredentialKey('linear.api_key')).to.be.true
      expect(isCredentialKey('jira.api_token')).to.be.true
      expect(isCredentialKey('asana.access_token')).to.be.true
      expect(isCredentialKey('trello.api_key')).to.be.true
      expect(isCredentialKey('trello.api_token')).to.be.true
      expect(isCredentialKey('shortcut.api_token')).to.be.true
      expect(isCredentialKey('monday.api_token')).to.be.true
    })

    it('should not identify non-credential keys', () => {
      expect(isCredentialKey('linear.default_team_id')).to.be.false
      expect(isCredentialKey('jira.base_url')).to.be.false
      expect(isCredentialKey('asana.workspace_gid')).to.be.false
      expect(isCredentialKey('trello.board_id')).to.be.false
      expect(isCredentialKey('work.provider_sources')).to.be.false
    })
  })

  describe('getCredentialDatabasePath', () => {
    it('should return path outside .proletariat directory', () => {
      const credPath = getCredentialDatabasePath('/home/user/workspace')
      expect(credPath).to.equal('/home/user/workspace/.proletariat-credentials/credentials.db')
      expect(credPath).to.not.include('.proletariat/')
    })
  })

  describe('setCredential / getCredential', () => {
    it('should store credentials in credentials.db, not workspace.db', () => {
      setCredential(db, 'linear.api_key', 'lin_api_test123')
      const value = getCredential(db, 'linear.api_key')
      expect(value).to.equal('lin_api_test123')

      // Verify NOT in workspace.db
      const row = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get('linear.api_key')
      expect(row).to.be.undefined
    })

    it('should store credential in separate credentials.db file', () => {
      setCredential(db, 'linear.api_key', 'lin_api_test456')

      const credDbPath = getCredentialDatabasePath(workspacePath)
      expect(fs.existsSync(credDbPath)).to.be.true
    })

    it('should return null for non-existent credentials', () => {
      expect(getCredential(db, 'linear.api_key')).to.be.null
    })
  })

  describe('auto-migration from workspace.db', () => {
    it('should migrate credential from workspace.db on first read', () => {
      // Seed credential directly in workspace.db (legacy behavior)
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('linear.api_key', 'lin_api_legacy')

      // getCredential should find it and migrate
      const value = getCredential(db, 'linear.api_key')
      expect(value).to.equal('lin_api_legacy')

      // Should be removed from workspace.db
      const row = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get('linear.api_key')
      expect(row).to.be.undefined

      // Should now be in credentials.db
      const credDbPath = getCredentialDatabasePath(workspacePath)
      const credDb = new Database(credDbPath, { readonly: true })
      const credRow = credDb.prepare('SELECT value FROM credentials WHERE key = ?').get('linear.api_key') as { value: string } | undefined
      expect(credRow?.value).to.equal('lin_api_legacy')
      credDb.close()
    })
  })

  describe('migrateCredentials', () => {
    it('should move all credential keys from workspace.db to credentials.db', () => {
      // Seed multiple credentials in workspace.db
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('linear.api_key', 'lin_api_bulk1')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('jira.api_token', 'jira_token_bulk')
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('linear.default_team_id', 'team123')

      migrateCredentials(db)

      // Credentials should be gone from workspace.db
      const linRow = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get('linear.api_key')
      const jiraRow = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get('jira.api_token')
      expect(linRow).to.be.undefined
      expect(jiraRow).to.be.undefined

      // Non-credential settings should remain
      const teamRow = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get('linear.default_team_id') as { value: string }
      expect(teamRow.value).to.equal('team123')

      // Credentials should be in credentials.db
      const credDbPath = getCredentialDatabasePath(workspacePath)
      const credDb = new Database(credDbPath, { readonly: true })
      const linCred = credDb.prepare('SELECT value FROM credentials WHERE key = ?').get('linear.api_key') as { value: string }
      const jiraCred = credDb.prepare('SELECT value FROM credentials WHERE key = ?').get('jira.api_token') as { value: string }
      expect(linCred.value).to.equal('lin_api_bulk1')
      expect(jiraCred.value).to.equal('jira_token_bulk')
      credDb.close()
    })

    it('should be idempotent', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('linear.api_key', 'lin_api_idem')

      migrateCredentials(db)
      migrateCredentials(db)

      const value = getCredential(db, 'linear.api_key')
      expect(value).to.equal('lin_api_idem')
    })
  })

  describe('deleteCredential', () => {
    it('should remove from credentials.db', () => {
      setCredential(db, 'linear.api_key', 'lin_api_del')
      expect(hasCredential(db, 'linear.api_key')).to.be.true

      deleteCredential(db, 'linear.api_key')
      expect(hasCredential(db, 'linear.api_key')).to.be.false
    })

    it('should also clean up from workspace.db if present', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('linear.api_key', 'lin_api_cleanup')
      deleteCredential(db, 'linear.api_key')

      const row = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get('linear.api_key')
      expect(row).to.be.undefined
    })
  })

  describe('hasCredential', () => {
    it('should return true when credential exists', () => {
      setCredential(db, 'shortcut.api_token', 'sc_token')
      expect(hasCredential(db, 'shortcut.api_token')).to.be.true
    })

    it('should return false when credential does not exist', () => {
      expect(hasCredential(db, 'shortcut.api_token')).to.be.false
    })
  })

  describe('agent container isolation', () => {
    it('should not expose credentials when only .proletariat is mounted', () => {
      // Simulate: credential is stored properly
      setCredential(db, 'linear.api_key', 'lin_api_secret')

      // Verify workspace.db has NO credential
      const row = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get('linear.api_key')
      expect(row).to.be.undefined

      // An agent reading workspace.db directly would see nothing
      const agentSettings = db.prepare('SELECT * FROM workspace_settings WHERE key LIKE ?').all('%.api_%')
      const credentialLeaks = agentSettings.filter((r: any) =>
        ['linear.api_key', 'jira.api_token', 'asana.access_token',
         'trello.api_key', 'trello.api_token', 'shortcut.api_token',
         'monday.api_token'].includes(r.key)
      )
      expect(credentialLeaks).to.have.lengthOf(0)
    })
  })
})
