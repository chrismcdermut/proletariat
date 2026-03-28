import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  validateProviderSourceEntry,
  loadProviderSources,
  saveProviderSources,
  addProviderSource,
  updateProviderSource,
  removeProviderSource,
  getProviderSourceById,
  resolveProviderByPrefix,
  resolveProviderByPrefixFromList,
  getRoutingTable,
  resolveApiKey,
  upsertProviderSource,
  removeProviderSourcesByProvider,
  type ProviderSourceEntry,
} from '../../src/lib/work-source/provider-sources.js'

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

function makeEntry(overrides: Partial<ProviderSourceEntry> = {}): ProviderSourceEntry {
  return {
    id: 'eng-linear',
    provider: 'linear',
    apiKeyRef: 'linear.api_key',
    teamProjectId: 'ENG',
    prefix: 'ENG-',
    ...overrides,
  }
}

describe('provider-sources', () => {
  // ===========================================================================
  // Validation
  // ===========================================================================
  describe('validateProviderSourceEntry', () => {
    it('passes for a valid entry', () => {
      const errors = validateProviderSourceEntry(makeEntry())
      expect(errors).to.have.length(0)
    })

    it('rejects empty id', () => {
      const errors = validateProviderSourceEntry(makeEntry({ id: '' }))
      expect(errors.some(e => e.field === 'id')).to.be.true
    })

    it('rejects id with uppercase', () => {
      const errors = validateProviderSourceEntry(makeEntry({ id: 'Eng-Linear' }))
      expect(errors.some(e => e.field === 'id')).to.be.true
    })

    it('rejects missing provider', () => {
      const errors = validateProviderSourceEntry({ ...makeEntry(), provider: undefined as unknown as 'linear' })
      expect(errors.some(e => e.field === 'provider')).to.be.true
    })

    it('rejects invalid provider', () => {
      const errors = validateProviderSourceEntry(makeEntry({ provider: 'bitbucket' as 'linear' }))
      expect(errors.some(e => e.field === 'provider')).to.be.true
    })

    it('rejects empty apiKeyRef', () => {
      const errors = validateProviderSourceEntry(makeEntry({ apiKeyRef: '' }))
      expect(errors.some(e => e.field === 'apiKeyRef')).to.be.true
    })

    it('rejects empty teamProjectId', () => {
      const errors = validateProviderSourceEntry(makeEntry({ teamProjectId: '' }))
      expect(errors.some(e => e.field === 'teamProjectId')).to.be.true
    })

    it('rejects empty prefix', () => {
      const errors = validateProviderSourceEntry(makeEntry({ prefix: '' }))
      expect(errors.some(e => e.field === 'prefix')).to.be.true
    })
  })

  // ===========================================================================
  // Persistence
  // ===========================================================================
  describe('loadProviderSources / saveProviderSources', () => {
    it('returns empty array when nothing stored', () => {
      const db = setupDb()
      expect(loadProviderSources(db)).to.deep.equal([])
      db.close()
    })

    it('round-trips a list of entries', () => {
      const db = setupDb()
      const entries = [
        makeEntry(),
        makeEntry({ id: 'prod-asana', provider: 'asana', apiKeyRef: 'asana.access_token', teamProjectId: 'PROD', prefix: 'PROD-' }),
      ]
      saveProviderSources(db, entries)
      const loaded = loadProviderSources(db)
      expect(loaded).to.have.length(2)
      expect(loaded[0].id).to.equal('eng-linear')
      expect(loaded[1].id).to.equal('prod-asana')
      db.close()
    })

    it('clears storage when saving empty array', () => {
      const db = setupDb()
      saveProviderSources(db, [makeEntry()])
      saveProviderSources(db, [])
      expect(loadProviderSources(db)).to.deep.equal([])
      db.close()
    })

    it('handles corrupted JSON gracefully', () => {
      const db = setupDb()
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('work.provider_sources', '{broken')
      expect(loadProviderSources(db)).to.deep.equal([])
      db.close()
    })
  })

  // ===========================================================================
  // CRUD
  // ===========================================================================
  describe('addProviderSource', () => {
    it('adds a valid entry', () => {
      const db = setupDb()
      const errors = addProviderSource(db, makeEntry())
      expect(errors).to.have.length(0)
      expect(loadProviderSources(db)).to.have.length(1)
      db.close()
    })

    it('rejects duplicate id', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry())
      const errors = addProviderSource(db, makeEntry({ prefix: 'OTHER-' }))
      expect(errors.some(e => e.field === 'id')).to.be.true
      db.close()
    })

    it('rejects duplicate prefix (case-insensitive)', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry())
      const errors = addProviderSource(db, makeEntry({ id: 'eng2', prefix: 'eng-' }))
      expect(errors.some(e => e.field === 'prefix')).to.be.true
      db.close()
    })
  })

  describe('updateProviderSource', () => {
    it('updates an existing entry', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry())
      const errors = updateProviderSource(db, 'eng-linear', { label: 'Engineering Team' })
      expect(errors).to.have.length(0)

      const updated = getProviderSourceById(db, 'eng-linear')
      expect(updated?.label).to.equal('Engineering Team')
      db.close()
    })

    it('returns error for non-existent id', () => {
      const db = setupDb()
      const errors = updateProviderSource(db, 'nonexistent', { label: 'test' })
      expect(errors.some(e => e.field === 'id')).to.be.true
      db.close()
    })

    it('rejects prefix conflict with other entries', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry())
      addProviderSource(db, makeEntry({ id: 'prod-asana', provider: 'asana', apiKeyRef: 'asana.access_token', teamProjectId: 'PROD', prefix: 'PROD-' }))
      const errors = updateProviderSource(db, 'prod-asana', { prefix: 'ENG-' })
      expect(errors.some(e => e.field === 'prefix')).to.be.true
      db.close()
    })
  })

  describe('removeProviderSource', () => {
    it('removes an existing entry', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry())
      expect(removeProviderSource(db, 'eng-linear')).to.be.true
      expect(loadProviderSources(db)).to.have.length(0)
      db.close()
    })

    it('returns false for non-existent id', () => {
      const db = setupDb()
      expect(removeProviderSource(db, 'nonexistent')).to.be.false
      db.close()
    })
  })

  describe('getProviderSourceById', () => {
    it('finds an existing entry', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry())
      const entry = getProviderSourceById(db, 'eng-linear')
      expect(entry).to.not.be.null
      expect(entry?.provider).to.equal('linear')
      db.close()
    })

    it('returns null for non-existent id', () => {
      const db = setupDb()
      expect(getProviderSourceById(db, 'nonexistent')).to.be.null
      db.close()
    })
  })

  // ===========================================================================
  // Prefix Routing
  // ===========================================================================
  describe('resolveProviderByPrefix', () => {
    it('routes ticket key to correct provider', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry())
      addProviderSource(db, makeEntry({ id: 'prod-asana', provider: 'asana', apiKeyRef: 'asana.access_token', teamProjectId: 'PROD', prefix: 'PROD-' }))
      addProviderSource(db, makeEntry({ id: 'des-shortcut', provider: 'shortcut', apiKeyRef: 'shortcut.api_token', teamProjectId: 'DES', prefix: 'DES-' }))

      const linear = resolveProviderByPrefix(db, 'ENG-123')
      expect(linear?.provider).to.equal('linear')

      const asana = resolveProviderByPrefix(db, 'PROD-456')
      expect(asana?.provider).to.equal('asana')

      const shortcut = resolveProviderByPrefix(db, 'DES-789')
      expect(shortcut?.provider).to.equal('shortcut')

      db.close()
    })

    it('returns null for unmatched prefix', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry())
      expect(resolveProviderByPrefix(db, 'UNKNOWN-123')).to.be.null
      db.close()
    })

    it('matches case-insensitively', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry())
      const result = resolveProviderByPrefix(db, 'eng-123')
      expect(result?.provider).to.equal('linear')
      db.close()
    })
  })

  describe('resolveProviderByPrefixFromList', () => {
    it('selects longest matching prefix', () => {
      const sources = [
        makeEntry({ id: 'eng', prefix: 'ENG-' }),
        makeEntry({ id: 'eng-core', provider: 'jira', prefix: 'ENG-CORE-' }),
      ]
      const result = resolveProviderByPrefixFromList(sources, 'ENG-CORE-42')
      expect(result?.id).to.equal('eng-core')
    })

    it('returns null for empty list', () => {
      expect(resolveProviderByPrefixFromList([], 'ENG-123')).to.be.null
    })
  })

  // ===========================================================================
  // Routing Table
  // ===========================================================================
  describe('getRoutingTable', () => {
    it('returns all configured prefixes', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry({ label: 'Engineering' }))
      addProviderSource(db, makeEntry({ id: 'prod-asana', provider: 'asana', apiKeyRef: 'asana.access_token', teamProjectId: 'PROD', prefix: 'PROD-', label: 'Product' }))

      const table = getRoutingTable(db)
      expect(table).to.have.length(2)
      expect(table[0]).to.deep.equal({ prefix: 'ENG-', provider: 'linear', label: 'Engineering', id: 'eng-linear' })
      expect(table[1]).to.deep.equal({ prefix: 'PROD-', provider: 'asana', label: 'Product', id: 'prod-asana' })
      db.close()
    })

    it('uses id as label fallback', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry())
      const table = getRoutingTable(db)
      expect(table[0].label).to.equal('eng-linear')
      db.close()
    })
  })

  // ===========================================================================
  // API Key Resolution
  // ===========================================================================
  describe('resolveApiKey', () => {
    it('resolves from workspace_settings key', () => {
      const db = setupDb()
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('linear.api_key', 'lin_test_key')
      const key = resolveApiKey(db, makeEntry())
      expect(key).to.equal('lin_test_key')
      db.close()
    })

    it('returns null when neither env nor db has the key', () => {
      const db = setupDb()
      const key = resolveApiKey(db, makeEntry({ apiKeyRef: 'nonexistent.key' }))
      expect(key).to.be.null
      db.close()
    })
  })

  // ===========================================================================
  // Upsert (for connect commands)
  // ===========================================================================
  describe('upsertProviderSource', () => {
    it('inserts a new entry when id does not exist', () => {
      const db = setupDb()
      const errors = upsertProviderSource(db, makeEntry())
      expect(errors).to.have.length(0)
      expect(loadProviderSources(db)).to.have.length(1)
      db.close()
    })

    it('replaces an existing entry with the same id', () => {
      const db = setupDb()
      upsertProviderSource(db, makeEntry({ label: 'Original' }))
      const errors = upsertProviderSource(db, makeEntry({ label: 'Updated', teamProjectId: 'NEW' }))
      expect(errors).to.have.length(0)

      const sources = loadProviderSources(db)
      expect(sources).to.have.length(1)
      expect(sources[0].label).to.equal('Updated')
      expect(sources[0].teamProjectId).to.equal('NEW')
      db.close()
    })

    it('preserves other entries when upserting', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry({ id: 'prod-asana', provider: 'asana', apiKeyRef: 'asana.access_token', teamProjectId: 'PROD', prefix: 'PROD-' }))
      upsertProviderSource(db, makeEntry())

      const sources = loadProviderSources(db)
      expect(sources).to.have.length(2)
      db.close()
    })

    it('rejects duplicate prefix against other entries', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry({ id: 'prod-asana', provider: 'asana', apiKeyRef: 'asana.access_token', teamProjectId: 'PROD', prefix: 'PROD-' }))
      const errors = upsertProviderSource(db, makeEntry({ prefix: 'PROD-' }))
      expect(errors.some(e => e.field === 'prefix')).to.be.true
      db.close()
    })

    it('allows updating prefix on same id without conflict', () => {
      const db = setupDb()
      upsertProviderSource(db, makeEntry())
      const errors = upsertProviderSource(db, makeEntry({ prefix: 'NEW-' }))
      expect(errors).to.have.length(0)

      const sources = loadProviderSources(db)
      expect(sources[0].prefix).to.equal('NEW-')
      db.close()
    })

    it('returns validation errors for invalid entry', () => {
      const db = setupDb()
      const errors = upsertProviderSource(db, makeEntry({ id: '' }))
      expect(errors.some(e => e.field === 'id')).to.be.true
      db.close()
    })
  })

  // ===========================================================================
  // Remove by provider
  // ===========================================================================
  describe('removeProviderSourcesByProvider', () => {
    it('removes all entries for a given provider', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry())
      addProviderSource(db, makeEntry({ id: 'linear-design', prefix: 'DES-', teamProjectId: 'DES' }))
      addProviderSource(db, makeEntry({ id: 'prod-asana', provider: 'asana', apiKeyRef: 'asana.access_token', teamProjectId: 'PROD', prefix: 'PROD-' }))

      const removed = removeProviderSourcesByProvider(db, 'linear')
      expect(removed).to.equal(2)

      const remaining = loadProviderSources(db)
      expect(remaining).to.have.length(1)
      expect(remaining[0].provider).to.equal('asana')
      db.close()
    })

    it('returns 0 when no entries match', () => {
      const db = setupDb()
      addProviderSource(db, makeEntry())
      const removed = removeProviderSourcesByProvider(db, 'asana')
      expect(removed).to.equal(0)
      expect(loadProviderSources(db)).to.have.length(1)
      db.close()
    })

    it('handles empty sources', () => {
      const db = setupDb()
      const removed = removeProviderSourcesByProvider(db, 'linear')
      expect(removed).to.equal(0)
      db.close()
    })
  })
})
