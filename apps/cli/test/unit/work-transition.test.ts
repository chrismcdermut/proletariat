import { expect } from 'chai'
import Database from 'better-sqlite3'
import { resolveIntentToColumn } from '../../src/lib/work-lifecycle/transition.js'
import { TransitionMapStore } from '../../src/lib/providers/transition-map.js'

// =============================================================================
// Work Transition Tests
// =============================================================================

describe('Work Transition — resolveIntentToColumn', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    // Create required tables
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
    db.exec(`
      CREATE TABLE pmo_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
  })

  afterEach(() => {
    db.close()
  })

  describe('with transition map configured', () => {
    it('resolves intent from pmo_transition_map first', () => {
      const store = new TransitionMapStore(db)
      store.upsertMapping({
        provider: 'linear',
        intent: 'started',
        providerStateName: 'Working On',
      })

      const columnNames = ['Backlog', 'Working On', 'In Review', 'Done']
      const result = resolveIntentToColumn(db, 'started', 'linear', columnNames)

      expect(result).to.equal('Working On')
    })

    it('falls back to legacy settings when no transition map entry', () => {
      // No transition map entries, but set column_in_progress
      db.prepare(`INSERT INTO pmo_settings (key, value) VALUES (?, ?)`).run('column_in_progress', 'Doing')

      const columnNames = ['Backlog', 'Doing', 'In Review', 'Done']
      const result = resolveIntentToColumn(db, 'started', 'linear', columnNames)

      expect(result).to.equal('Doing')
    })

    it('falls back to default column name when no settings', () => {
      // No transition map, no settings → defaults to "In Progress"
      const columnNames = ['Backlog', 'In Progress', 'Review', 'Done']
      const result = resolveIntentToColumn(db, 'started', 'pmo', columnNames)

      expect(result).to.equal('In Progress')
    })

    it('returns null when no column matches', () => {
      const columnNames = ['Backlog', 'Zzzz']
      const result = resolveIntentToColumn(db, 'started', 'pmo', columnNames)

      expect(result).to.be.null
    })
  })

  describe('intent-to-column mapping for all intents', () => {
    it('maps needs_review to Review column', () => {
      const columnNames = ['Backlog', 'In Progress', 'Review', 'Done']
      const result = resolveIntentToColumn(db, 'needs_review', 'pmo', columnNames)
      expect(result).to.equal('Review')
    })

    it('maps completed to Done column', () => {
      const columnNames = ['Backlog', 'In Progress', 'Review', 'Done']
      const result = resolveIntentToColumn(db, 'completed', 'pmo', columnNames)
      expect(result).to.equal('Done')
    })

    it('maps ready to Planned column', () => {
      const columnNames = ['Backlog', 'Planned', 'In Progress', 'Review', 'Done']
      const result = resolveIntentToColumn(db, 'ready', 'pmo', columnNames)
      expect(result).to.equal('Planned')
    })
  })

  describe('transition map takes priority over legacy settings', () => {
    it('uses transition map even when legacy setting exists', () => {
      // Set both: transition map says "Working On", legacy setting says "In Progress"
      const store = new TransitionMapStore(db)
      store.upsertMapping({
        provider: 'linear',
        intent: 'started',
        providerStateName: 'Working On',
      })
      db.prepare(`INSERT INTO pmo_settings (key, value) VALUES (?, ?)`).run('column_in_progress', 'In Progress')

      const columnNames = ['Working On', 'In Progress', 'Done']
      const result = resolveIntentToColumn(db, 'started', 'linear', columnNames)

      // Should use transition map value
      expect(result).to.equal('Working On')
    })
  })
})
