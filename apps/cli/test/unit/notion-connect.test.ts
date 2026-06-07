import { expect } from 'chai'
import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

import {
  isNotionConfigured,
  loadNotionConfig,
  saveNotionApiKey,
  saveNotionDefaultDatabase,
  clearNotionConfig,
  getNotionApiKey,
} from '../../src/lib/notion/config.js'
import { NotionClient } from '../../src/lib/notion/client.js'
import {
  loadProviderSources,
  removeProviderSourcesByProvider,
  upsertProviderSource,
} from '../../src/lib/work-source/provider-sources.js'
import { closeAllCredentialStores } from '../../src/lib/database/credential-store.js'

function createTempWorkspace(): { workspacePath: string; db: Database.Database } {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-notion-test-'))
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

function cleanupWorkspace(workspacePath: string, db: Database.Database): void {
  try { db.close() } catch { /* */ }
  closeAllCredentialStores()
  try { fs.rmSync(workspacePath, { recursive: true, force: true }) } catch { /* */ }
}

describe('Notion connect/disconnect config (PRLT-1326)', () => {
  let workspacePath: string
  let db: Database.Database

  beforeEach(() => {
    const ws = createTempWorkspace()
    workspacePath = ws.workspacePath
    db = ws.db
  })

  afterEach(() => {
    cleanupWorkspace(workspacePath, db)
    delete process.env.PRLT_NOTION_API_KEY
    delete process.env.NOTION_API_KEY
  })

  describe('config persistence', () => {
    it('isNotionConfigured returns false before connecting', () => {
      expect(isNotionConfigured(db)).to.equal(false)
    })

    it('saveNotionApiKey + saveNotionDefaultDatabase persists config', () => {
      saveNotionApiKey(db, 'secret_test_key')
      saveNotionDefaultDatabase(db, 'db-uuid-123', 'My Tickets DB')

      expect(isNotionConfigured(db)).to.equal(true)
      const config = loadNotionConfig(db)
      expect(config).to.not.be.null
      expect(config!.apiKey).to.equal('secret_test_key')
      expect(config!.defaultDatabaseId).to.equal('db-uuid-123')
      expect(config!.defaultDatabaseName).to.equal('My Tickets DB')
    })

    it('getNotionApiKey returns the stored credential', () => {
      saveNotionApiKey(db, 'secret_persisted')
      expect(getNotionApiKey(db)).to.equal('secret_persisted')
    })

    it('getNotionApiKey prefers env var when set', () => {
      saveNotionApiKey(db, 'secret_stored')
      process.env.PRLT_NOTION_API_KEY = 'secret_env'
      expect(getNotionApiKey(db)).to.equal('secret_env')
    })

    it('clearNotionConfig removes credentials and settings', () => {
      saveNotionApiKey(db, 'secret_test')
      saveNotionDefaultDatabase(db, 'db-id', 'Name')
      expect(isNotionConfigured(db)).to.equal(true)

      clearNotionConfig(db)
      expect(isNotionConfigured(db)).to.equal(false)
      expect(loadNotionConfig(db)).to.be.null
    })
  })

  describe('disconnect flow', () => {
    it('clears Notion provider source when disconnecting', () => {
      saveNotionApiKey(db, 'secret_test')
      saveNotionDefaultDatabase(db, 'db-id', 'My DB')
      upsertProviderSource(db, {
        id: 'notion',
        provider: 'notion',
        apiKeyRef: 'notion.api_key',
        teamProjectId: 'db-id',
        prefix: 'NOT-',
        label: 'My DB',
      })

      expect(loadProviderSources(db).some((s) => s.provider === 'notion')).to.equal(true)

      // Simulate disconnect
      clearNotionConfig(db)
      removeProviderSourcesByProvider(db, 'notion')

      expect(isNotionConfigured(db)).to.equal(false)
      expect(loadProviderSources(db).some((s) => s.provider === 'notion')).to.equal(false)
    })
  })

  describe('NotionClient.searchDatabases', () => {
    it('posts a database-only search filter to /v1/search', async () => {
      const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = []
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (url: string, init: RequestInit) => {
        calls.push({
          url: String(url),
          body: init.body ? JSON.parse(String(init.body)) : null,
          headers: init.headers as Record<string, string>,
        })
        return new Response(
          JSON.stringify({
            results: [
              { id: 'db-1', title: [{ plain_text: 'Engineering' }], properties: {} },
              { id: 'db-2', title: [{ plain_text: 'Product' }], properties: {} },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }) as typeof fetch

      try {
        const client = new NotionClient('secret_x')
        const databases = await client.searchDatabases()
        expect(databases).to.have.lengthOf(2)
        expect(databases[0].id).to.equal('db-1')

        expect(calls).to.have.lengthOf(1)
        expect(calls[0].url).to.include('/v1/search')
        const body = calls[0].body as Record<string, unknown>
        expect(body.filter).to.deep.equal({ property: 'object', value: 'database' })
        expect(calls[0].headers.Authorization).to.equal('Bearer secret_x')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('passes query string when provided', async () => {
      let bodySeen: Record<string, unknown> | null = null
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (_url: string, init: RequestInit) => {
        bodySeen = init.body ? JSON.parse(String(init.body)) : null
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }) as typeof fetch

      try {
        const client = new NotionClient('secret_y')
        await client.searchDatabases('roadmap')
        expect(bodySeen).to.not.be.null
        expect(bodySeen!.query).to.equal('roadmap')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('throws on non-OK response', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () =>
        new Response('unauthorized', { status: 401 })) as typeof fetch

      try {
        const client = new NotionClient('secret_bad')
        let threw = false
        try {
          await client.searchDatabases()
        } catch (error) {
          threw = true
          expect((error as Error).message).to.include('401')
        }
        expect(threw).to.equal(true)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })
})
