import { expect } from 'chai'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { ProviderStatusMappingStore } from '../../src/lib/providers/status-mapping.js'

function createTestDb(): SqliteDatabase {
  const db = new SqliteDatabase(':memory:')
  db.exec(`
    CREATE TABLE pmo_provider_status_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      provider_status TEXT NOT NULL,
      canonical_status TEXT NOT NULL,
      canonical_category TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, provider_status)
    )
  `)
  return db
}

describe('ProviderStatusMappingStore', () => {
  let db: SqliteDatabase
  let store: ProviderStatusMappingStore

  beforeEach(() => {
    db = createTestDb()
    store = new ProviderStatusMappingStore(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('upsertMapping / getCanonicalStatus', () => {
    it('creates and retrieves a status mapping', () => {
      store.upsertMapping({
        provider: 'linear',
        providerStatus: 'In Review',
        canonicalStatus: 'Review',
        canonicalCategory: 'started',
      })

      const result = store.getCanonicalStatus('linear', 'In Review')
      expect(result).to.not.be.null
      expect(result!.canonicalStatus).to.equal('Review')
      expect(result!.canonicalCategory).to.equal('started')
    })

    it('updates existing mapping on conflict', () => {
      store.upsertMapping({
        provider: 'linear',
        providerStatus: 'In Review',
        canonicalStatus: 'Review',
        canonicalCategory: 'started',
      })

      store.upsertMapping({
        provider: 'linear',
        providerStatus: 'In Review',
        canonicalStatus: 'QA',
        canonicalCategory: 'started',
      })

      const result = store.getCanonicalStatus('linear', 'In Review')
      expect(result!.canonicalStatus).to.equal('QA')
    })

    it('returns null for unmapped status', () => {
      const result = store.getCanonicalStatus('linear', 'Unknown Status')
      expect(result).to.be.null
    })

    it('is case-insensitive', () => {
      store.upsertMapping({
        provider: 'jira',
        providerStatus: 'Code Review',
        canonicalStatus: 'Review',
        canonicalCategory: null,
      })

      const result = store.getCanonicalStatus('jira', 'code review')
      expect(result).to.not.be.null
      expect(result!.canonicalStatus).to.equal('Review')
    })
  })

  describe('getProviderStatus', () => {
    it('looks up provider status from canonical', () => {
      store.upsertMapping({
        provider: 'jira',
        providerStatus: 'Code Review',
        canonicalStatus: 'Review',
        canonicalCategory: null,
      })

      const result = store.getProviderStatus('jira', 'Review')
      expect(result).to.not.be.null
      expect(result!.providerStatus).to.equal('Code Review')
    })
  })

  describe('listMappings', () => {
    it('lists all mappings for a provider', () => {
      store.upsertMapping({
        provider: 'linear',
        providerStatus: 'In Review',
        canonicalStatus: 'Review',
        canonicalCategory: 'started',
      })
      store.upsertMapping({
        provider: 'linear',
        providerStatus: 'Done',
        canonicalStatus: 'Complete',
        canonicalCategory: 'completed',
      })
      store.upsertMapping({
        provider: 'jira',
        providerStatus: 'Closed',
        canonicalStatus: 'Complete',
        canonicalCategory: 'completed',
      })

      const linearMappings = store.listMappings('linear')
      expect(linearMappings).to.have.lengthOf(2)

      const jiraMappings = store.listMappings('jira')
      expect(jiraMappings).to.have.lengthOf(1)
    })
  })

  describe('removeMapping', () => {
    it('removes a specific mapping', () => {
      store.upsertMapping({
        provider: 'linear',
        providerStatus: 'In Review',
        canonicalStatus: 'Review',
        canonicalCategory: null,
      })

      store.removeMapping('linear', 'In Review')

      const result = store.getCanonicalStatus('linear', 'In Review')
      expect(result).to.be.null
    })
  })

  describe('clearMappings', () => {
    it('removes all mappings for a provider', () => {
      store.upsertMapping({
        provider: 'linear',
        providerStatus: 'A',
        canonicalStatus: 'X',
        canonicalCategory: null,
      })
      store.upsertMapping({
        provider: 'linear',
        providerStatus: 'B',
        canonicalStatus: 'Y',
        canonicalCategory: null,
      })

      store.clearMappings('linear')

      const mappings = store.listMappings('linear')
      expect(mappings).to.have.lengthOf(0)
    })
  })

  describe('resolveStatus', () => {
    it('returns canonical status when mapped', () => {
      store.upsertMapping({
        provider: 'linear',
        providerStatus: 'In Review',
        canonicalStatus: 'Review',
        canonicalCategory: null,
      })

      expect(store.resolveStatus('linear', 'In Review')).to.equal('Review')
    })

    it('returns original status when not mapped', () => {
      expect(store.resolveStatus('linear', 'In Progress')).to.equal('In Progress')
    })
  })
})
