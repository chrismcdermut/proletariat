import { expect } from 'chai'
import Database from 'better-sqlite3'
import { TransitionMapStore } from '../../src/lib/providers/transition-map.js'

// =============================================================================
// TransitionMapStore Tests
// =============================================================================

describe('TransitionMapStore', () => {
  let db: Database.Database
  let store: TransitionMapStore

  beforeEach(() => {
    db = new Database(':memory:')
    // Create the migration table
    db.exec(`
      CREATE TABLE pmo_transition_map (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        intent TEXT NOT NULL,
        provider_state_name TEXT NOT NULL,
        provider_state_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, intent)
      )
    `)
    store = new TransitionMapStore(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('upsertMapping()', () => {
    it('inserts a new mapping', () => {
      store.upsertMapping({
        provider: 'linear',
        intent: 'started',
        providerStateName: 'In Progress',
        providerStateId: 'state-123',
      })

      const mapping = store.getMapping('linear', 'started')
      expect(mapping).to.not.be.null
      expect(mapping!.providerStateName).to.equal('In Progress')
      expect(mapping!.providerStateId).to.equal('state-123')
    })

    it('updates existing mapping on conflict', () => {
      store.upsertMapping({
        provider: 'linear',
        intent: 'started',
        providerStateName: 'In Progress',
      })

      store.upsertMapping({
        provider: 'linear',
        intent: 'started',
        providerStateName: 'Working On',
        providerStateId: 'new-id',
      })

      const mapping = store.getMapping('linear', 'started')
      expect(mapping!.providerStateName).to.equal('Working On')
      expect(mapping!.providerStateId).to.equal('new-id')
    })
  })

  describe('getMapping()', () => {
    it('returns null for non-existent mapping', () => {
      const mapping = store.getMapping('linear', 'started')
      expect(mapping).to.be.null
    })

    it('distinguishes between providers', () => {
      store.upsertMapping({
        provider: 'linear',
        intent: 'started',
        providerStateName: 'In Progress',
      })
      store.upsertMapping({
        provider: 'jira',
        intent: 'started',
        providerStateName: 'Doing',
      })

      const linear = store.getMapping('linear', 'started')
      const jira = store.getMapping('jira', 'started')
      expect(linear!.providerStateName).to.equal('In Progress')
      expect(jira!.providerStateName).to.equal('Doing')
    })
  })

  describe('listMappings()', () => {
    it('returns all mappings for a provider', () => {
      store.upsertMapping({ provider: 'linear', intent: 'started', providerStateName: 'In Progress' })
      store.upsertMapping({ provider: 'linear', intent: 'completed', providerStateName: 'Done' })
      store.upsertMapping({ provider: 'jira', intent: 'started', providerStateName: 'Doing' })

      const linearMappings = store.listMappings('linear')
      expect(linearMappings).to.have.length(2)

      const jiraMappings = store.listMappings('jira')
      expect(jiraMappings).to.have.length(1)
    })

    it('returns empty array for unknown provider', () => {
      const mappings = store.listMappings('trello')
      expect(mappings).to.deep.equal([])
    })
  })

  describe('removeMapping()', () => {
    it('removes a specific mapping', () => {
      store.upsertMapping({ provider: 'linear', intent: 'started', providerStateName: 'In Progress' })
      store.upsertMapping({ provider: 'linear', intent: 'completed', providerStateName: 'Done' })

      store.removeMapping('linear', 'started')

      expect(store.getMapping('linear', 'started')).to.be.null
      expect(store.getMapping('linear', 'completed')).to.not.be.null
    })
  })

  describe('clearMappings()', () => {
    it('removes all mappings for a provider', () => {
      store.upsertMapping({ provider: 'linear', intent: 'started', providerStateName: 'In Progress' })
      store.upsertMapping({ provider: 'linear', intent: 'completed', providerStateName: 'Done' })
      store.upsertMapping({ provider: 'jira', intent: 'started', providerStateName: 'Doing' })

      store.clearMappings('linear')

      expect(store.listMappings('linear')).to.have.length(0)
      expect(store.listMappings('jira')).to.have.length(1)
    })
  })

  describe('resolveIntent()', () => {
    it('returns mapped state name', () => {
      store.upsertMapping({ provider: 'linear', intent: 'started', providerStateName: 'In Progress' })

      const result = store.resolveIntent('linear', 'started')
      expect(result).to.equal('In Progress')
    })

    it('returns null for unmapped intent', () => {
      const result = store.resolveIntent('linear', 'started')
      expect(result).to.be.null
    })
  })
})
