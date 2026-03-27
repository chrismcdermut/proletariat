/**
 * Tests for Auto-Mapping (PRLT-1160)
 *
 * Tests the heuristic status mapping generator that auto-maps provider
 * statuses to prlt canonical statuses during provider setup.
 */
import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  generateAutoMappings,
  autoMapAndPersist,
  findCanonicalMatch,
  CANONICAL_STATUSES,
  INTENT_TO_CANONICAL,
  type ProviderStatus,
} from '../../src/lib/providers/auto-mapping.js'
import { ProviderStatusMappingStore } from '../../src/lib/providers/status-mapping.js'

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
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

// ---------------------------------------------------------------------------
// Tests: findCanonicalMatch
// ---------------------------------------------------------------------------

describe('PRLT-1160: Auto-Mapping', () => {
  describe('findCanonicalMatch', () => {
    it('should match exact alias (case-insensitive)', () => {
      const match = findCanonicalMatch('In Progress')
      expect(match).to.not.be.null
      expect(match!.name).to.equal('In Progress')
      expect(match!.category).to.equal('started')
    })

    it('should match "Done" to Done canonical', () => {
      const match = findCanonicalMatch('done')
      expect(match).to.not.be.null
      expect(match!.name).to.equal('Done')
      expect(match!.category).to.equal('completed')
    })

    it('should match "Working On" to In Progress', () => {
      const match = findCanonicalMatch('Working On')
      expect(match).to.not.be.null
      expect(match!.name).to.equal('In Progress')
    })

    it('should match "Needs Review" to Review', () => {
      const match = findCanonicalMatch('Needs Review')
      expect(match).to.not.be.null
      expect(match!.name).to.equal('Review')
    })

    it('should match "COMPLETE" to Done (case-insensitive)', () => {
      const match = findCanonicalMatch('COMPLETE')
      expect(match).to.not.be.null
      expect(match!.name).to.equal('Done')
    })

    it('should match "Not Working On" to Backlog', () => {
      const match = findCanonicalMatch('Not Working On')
      expect(match).to.not.be.null
      expect(match!.name).to.equal('Backlog')
    })

    it('should match "Awaiting Client Feedback" to Review', () => {
      const match = findCanonicalMatch('Awaiting Client Feedback')
      expect(match).to.not.be.null
      expect(match!.name).to.equal('Review')
    })

    it('should match "New Issues" to Triage', () => {
      const match = findCanonicalMatch('New Issues')
      expect(match).to.not.be.null
      expect(match!.name).to.equal('Triage')
    })

    it('should match "Development Ready" to Ready', () => {
      const match = findCanonicalMatch('Development Ready')
      expect(match).to.not.be.null
      expect(match!.name).to.equal('Ready')
    })

    it('should match "Canceled" to Canceled', () => {
      const match = findCanonicalMatch('Canceled')
      expect(match).to.not.be.null
      expect(match!.name).to.equal('Canceled')
      expect(match!.category).to.equal('completed')
    })

    it('should return null for completely unknown status', () => {
      const match = findCanonicalMatch('XYZZY_STATUS_12345')
      expect(match).to.be.null
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: generateAutoMappings
  // ---------------------------------------------------------------------------

  describe('generateAutoMappings', () => {
    it('should map a Linear-style board', () => {
      const statuses: ProviderStatus[] = [
        { name: 'Triage', type: 'triage' },
        { name: 'Backlog', type: 'backlog' },
        { name: 'In Progress', type: 'started' },
        { name: 'In Review', type: 'started' },
        { name: 'Done', type: 'completed' },
        { name: 'Canceled', type: 'canceled' },
      ]

      const mappings = generateAutoMappings('linear', statuses)

      expect(mappings.length).to.be.greaterThanOrEqual(5)

      // Check key mappings
      const triage = mappings.find(m => m.providerStatus === 'Triage')
      expect(triage).to.not.be.undefined
      expect(triage!.canonicalCategory).to.equal('unstarted')

      const inProgress = mappings.find(m => m.providerStatus === 'In Progress')
      expect(inProgress).to.not.be.undefined
      expect(inProgress!.canonicalStatus).to.equal('In Progress')
      expect(inProgress!.canonicalCategory).to.equal('started')

      const inReview = mappings.find(m => m.providerStatus === 'In Review')
      expect(inReview).to.not.be.undefined
      expect(inReview!.canonicalStatus).to.equal('Review')
      expect(inReview!.canonicalCategory).to.equal('started')

      const done = mappings.find(m => m.providerStatus === 'Done')
      expect(done).to.not.be.undefined
      expect(done!.canonicalCategory).to.equal('completed')
    })

    it('should map a Trello-style board (Board B from ticket)', () => {
      const statuses: ProviderStatus[] = [
        { name: 'New Functionality Requests' },
        { name: 'New Issues' },
        { name: 'Working On' },
        { name: 'Needs Review' },
        { name: 'Done' },
        { name: 'Not Working On' },
      ]

      const mappings = generateAutoMappings('trello', statuses)

      const workingOn = mappings.find(m => m.providerStatus === 'Working On')
      expect(workingOn).to.not.be.undefined
      expect(workingOn!.canonicalStatus).to.equal('In Progress')

      const needsReview = mappings.find(m => m.providerStatus === 'Needs Review')
      expect(needsReview).to.not.be.undefined
      expect(needsReview!.canonicalStatus).to.equal('Review')

      const done = mappings.find(m => m.providerStatus === 'Done')
      expect(done).to.not.be.undefined
      expect(done!.canonicalStatus).to.equal('Done')
    })

    it('should map a simple board (Board C from ticket)', () => {
      const statuses: ProviderStatus[] = [
        { name: 'Backlog' },
        { name: 'Development Ready' },
        { name: 'In Progress' },
        { name: 'In Review' },
        { name: 'Done' },
      ]

      const mappings = generateAutoMappings('trello', statuses)

      expect(mappings.find(m => m.providerStatus === 'Backlog')!.canonicalStatus).to.equal('Backlog')
      expect(mappings.find(m => m.providerStatus === 'Development Ready')!.canonicalStatus).to.equal('Ready')
      expect(mappings.find(m => m.providerStatus === 'In Progress')!.canonicalStatus).to.equal('In Progress')
      expect(mappings.find(m => m.providerStatus === 'In Review')!.canonicalStatus).to.equal('Review')
      expect(mappings.find(m => m.providerStatus === 'Done')!.canonicalStatus).to.equal('Done')
    })

    it('should map a ClickUp-style board (Board D from ticket)', () => {
      const statuses: ProviderStatus[] = [
        { name: 'BACKLOG', type: 'open' },
        { name: 'TO DO', type: 'open' },
        { name: 'IN PROGRESS', type: 'custom' },
        { name: 'AWAITING CLIENT FEEDBACK', type: 'custom' },
        { name: 'PAUSED', type: 'custom' },
        { name: 'COMPLETE', type: 'closed' },
      ]

      const mappings = generateAutoMappings('clickup', statuses)

      const backlog = mappings.find(m => m.providerStatus === 'BACKLOG')
      expect(backlog).to.not.be.undefined
      expect(backlog!.canonicalCategory).to.equal('unstarted')

      const inProgress = mappings.find(m => m.providerStatus === 'IN PROGRESS')
      expect(inProgress).to.not.be.undefined
      expect(inProgress!.canonicalCategory).to.equal('started')

      const complete = mappings.find(m => m.providerStatus === 'COMPLETE')
      expect(complete).to.not.be.undefined
      expect(complete!.canonicalCategory).to.equal('completed')
    })

    it('should use type-based matching for unmatched statuses', () => {
      const statuses: ProviderStatus[] = [
        { name: 'Alpha', type: 'backlog' },
        { name: 'Beta', type: 'started' },
        { name: 'Gamma', type: 'completed' },
      ]

      const mappings = generateAutoMappings('test', statuses)
      expect(mappings.length).to.be.greaterThanOrEqual(3)

      const alpha = mappings.find(m => m.providerStatus === 'Alpha')
      expect(alpha!.canonicalCategory).to.equal('unstarted')

      const beta = mappings.find(m => m.providerStatus === 'Beta')
      expect(beta!.canonicalCategory).to.equal('started')

      const gamma = mappings.find(m => m.providerStatus === 'Gamma')
      expect(gamma!.canonicalCategory).to.equal('completed')
    })

    it('should not generate duplicate canonical assignments in first pass', () => {
      const statuses: ProviderStatus[] = [
        { name: 'Done' },
        { name: 'Complete' }, // Both match "Done" canonical
      ]

      const mappings = generateAutoMappings('test', statuses)
      const doneMapping = mappings.find(m => m.providerStatus === 'Done')
      expect(doneMapping!.canonicalStatus).to.equal('Done')

      // "Complete" should not also map to "Done" since it's already taken
      // It might get a different canonical or be skipped
      const completeMapping = mappings.find(m => m.providerStatus === 'Complete')
      if (completeMapping) {
        // If mapped, should have a different canonical than Done
        // (unless the second pass assigns it differently)
        expect(mappings.filter(m => m.canonicalStatus === 'Done')).to.have.lengthOf(1)
      }
    })

    it('should handle empty statuses', () => {
      const mappings = generateAutoMappings('test', [])
      expect(mappings).to.have.lengthOf(0)
    })

    it('should set provider name on all mappings', () => {
      const statuses: ProviderStatus[] = [
        { name: 'In Progress' },
        { name: 'Done' },
      ]

      const mappings = generateAutoMappings('myProvider', statuses)
      for (const m of mappings) {
        expect(m.provider).to.equal('myProvider')
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: autoMapAndPersist
  // ---------------------------------------------------------------------------

  describe('autoMapAndPersist', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
    })

    afterEach(() => {
      db.close()
    })

    it('should persist mappings to the database', () => {
      const statuses: ProviderStatus[] = [
        { name: 'In Progress' },
        { name: 'In Review' },
        { name: 'Done' },
      ]

      const mappings = autoMapAndPersist(db, 'linear', statuses)
      expect(mappings.length).to.be.greaterThanOrEqual(3)

      // Verify they're in the DB
      const store = new ProviderStatusMappingStore(db)
      const dbMappings = store.listMappings('linear')
      expect(dbMappings.length).to.equal(mappings.length)
    })

    it('should clear old mappings before persisting new ones', () => {
      const store = new ProviderStatusMappingStore(db)

      // Add an old mapping
      store.upsertMapping({
        provider: 'linear',
        providerStatus: 'Old Status',
        canonicalStatus: 'Old Canonical',
        canonicalCategory: 'started',
      })

      // Auto-map new statuses
      autoMapAndPersist(db, 'linear', [
        { name: 'In Progress' },
        { name: 'Done' },
      ])

      // Old mapping should be gone
      const oldMapping = store.getCanonicalStatus('linear', 'Old Status')
      expect(oldMapping).to.be.null
    })

    it('should allow reverse lookup (canonical → provider)', () => {
      autoMapAndPersist(db, 'linear', [
        { name: 'In Review', type: 'started' },
        { name: 'Done', type: 'completed' },
      ])

      const store = new ProviderStatusMappingStore(db)
      const reviewMapping = store.getProviderStatus('linear', 'Review')
      expect(reviewMapping).to.not.be.null
      expect(reviewMapping!.providerStatus).to.equal('In Review')
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: INTENT_TO_CANONICAL mapping
  // ---------------------------------------------------------------------------

  describe('INTENT_TO_CANONICAL', () => {
    it('should map active to In Progress', () => {
      expect(INTENT_TO_CANONICAL.active).to.equal('In Progress')
    })

    it('should map review to Review', () => {
      expect(INTENT_TO_CANONICAL.review).to.equal('Review')
    })

    it('should map done to Done', () => {
      expect(INTENT_TO_CANONICAL.done).to.equal('Done')
    })

    it('should map ready/groom to Ready', () => {
      expect(INTENT_TO_CANONICAL.ready).to.equal('Ready')
      expect(INTENT_TO_CANONICAL.groom).to.equal('Ready')
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: CANONICAL_STATUSES coverage
  // ---------------------------------------------------------------------------

  describe('CANONICAL_STATUSES', () => {
    it('should have 7 canonical statuses', () => {
      expect(CANONICAL_STATUSES).to.have.lengthOf(7)
    })

    it('should cover all 3 categories', () => {
      const categories = new Set(CANONICAL_STATUSES.map(c => c.category))
      expect(categories.size).to.equal(3)
      expect(categories.has('unstarted')).to.be.true
      expect(categories.has('started')).to.be.true
      expect(categories.has('completed')).to.be.true
    })

    it('should have 3 unstarted statuses', () => {
      const unstarted = CANONICAL_STATUSES.filter(c => c.category === 'unstarted')
      expect(unstarted).to.have.lengthOf(3)
      expect(unstarted.map(c => c.name)).to.include.members(['Triage', 'Backlog', 'Ready'])
    })

    it('should have 2 started statuses', () => {
      const started = CANONICAL_STATUSES.filter(c => c.category === 'started')
      expect(started).to.have.lengthOf(2)
      expect(started.map(c => c.name)).to.include.members(['In Progress', 'Review'])
    })

    it('should have 2 completed statuses', () => {
      const completed = CANONICAL_STATUSES.filter(c => c.category === 'completed')
      expect(completed).to.have.lengthOf(2)
      expect(completed.map(c => c.name)).to.include.members(['Done', 'Canceled'])
    })
  })
})
