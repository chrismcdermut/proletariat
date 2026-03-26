import { expect } from 'chai'
import Database from 'better-sqlite3'
import { PMO_TABLE_SCHEMAS, PMO_TABLES } from '../../src/lib/pmo/schema.js'
import {
  getReviewGateSetting,
  setReviewGateSetting,
  isValidReviewGateMode,
  resolveReviewGate,
  DEFAULT_REVIEW_GATE,
  REVIEW_GATE_MODES,
} from '../../src/lib/work-lifecycle/settings.js'
import type { ReviewGateMode } from '../../src/lib/pmo/types.js'
import { addReviewGate } from '../../src/lib/database/migrations/0011_add_review_gate.js'

/**
 * Unit tests for the configurable review gate feature (PRLT-1069).
 *
 * Tests cover:
 * - Review gate workspace settings (get/set/default)
 * - Review gate mode validation
 * - Review gate resolution hierarchy (spawn > action > workspace)
 * - Migration adding review_gate column to pmo_actions
 */
describe('Review Gate', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    // Create pmo_settings table
    db.exec(PMO_TABLE_SCHEMAS.settings)
    // Create pmo_actions table
    db.exec(PMO_TABLE_SCHEMAS.actions)
  })

  afterEach(() => {
    db.close()
  })

  describe('constants', () => {
    it('should have required as the default review gate', () => {
      expect(DEFAULT_REVIEW_GATE).to.equal('required')
    })

    it('should define all three review gate modes', () => {
      expect(REVIEW_GATE_MODES).to.deep.equal(['required', 'auto', 'post'])
    })
  })

  describe('isValidReviewGateMode', () => {
    it('should accept valid modes', () => {
      expect(isValidReviewGateMode('required')).to.be.true
      expect(isValidReviewGateMode('auto')).to.be.true
      expect(isValidReviewGateMode('post')).to.be.true
    })

    it('should reject invalid modes', () => {
      expect(isValidReviewGateMode('invalid')).to.be.false
      expect(isValidReviewGateMode('')).to.be.false
      expect(isValidReviewGateMode('REQUIRED')).to.be.false
    })
  })

  describe('getReviewGateSetting', () => {
    it('should return default (required) when not set', () => {
      const mode = getReviewGateSetting(db)
      expect(mode).to.equal('required')
    })

    it('should return configured value', () => {
      db.prepare('INSERT INTO pmo_settings (key, value) VALUES (?, ?)').run('review_gate', 'auto')
      const mode = getReviewGateSetting(db)
      expect(mode).to.equal('auto')
    })

    it('should return default for invalid stored value', () => {
      db.prepare('INSERT INTO pmo_settings (key, value) VALUES (?, ?)').run('review_gate', 'invalid')
      const mode = getReviewGateSetting(db)
      expect(mode).to.equal('required')
    })
  })

  describe('setReviewGateSetting', () => {
    it('should set the review gate mode', () => {
      setReviewGateSetting(db, 'auto')
      const mode = getReviewGateSetting(db)
      expect(mode).to.equal('auto')
    })

    it('should update existing value', () => {
      setReviewGateSetting(db, 'auto')
      setReviewGateSetting(db, 'post')
      const mode = getReviewGateSetting(db)
      expect(mode).to.equal('post')
    })
  })

  describe('resolveReviewGate', () => {
    it('should use workspace default when no overrides', () => {
      const mode = resolveReviewGate(undefined, undefined, db)
      expect(mode).to.equal('required')
    })

    it('should prefer spawn override over everything', () => {
      setReviewGateSetting(db, 'post')
      const mode = resolveReviewGate('auto', 'post', db)
      expect(mode).to.equal('auto')
    })

    it('should prefer action override over workspace default', () => {
      setReviewGateSetting(db, 'required')
      const mode = resolveReviewGate(undefined, 'auto', db)
      expect(mode).to.equal('auto')
    })

    it('should fall back to workspace default when no overrides', () => {
      setReviewGateSetting(db, 'post')
      const mode = resolveReviewGate(undefined, undefined, db)
      expect(mode).to.equal('post')
    })

    it('should use spawn override over action override', () => {
      const mode = resolveReviewGate('required', 'auto', db)
      expect(mode).to.equal('required')
    })
  })

  describe('migration 0011', () => {
    it('should add review_gate column to pmo_actions', () => {
      // Create the table without review_gate column first
      db.exec(`
        CREATE TABLE IF NOT EXISTS pmo_actions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          prompt TEXT NOT NULL,
          end_prompt TEXT,
          from_state TEXT,
          to_state TEXT,
          executor TEXT,
          environment TEXT,
          permission_mode TEXT,
          timeout INTEGER,
          model TEXT,
          modifies_code INTEGER NOT NULL DEFAULT 1,
          is_default INTEGER NOT NULL DEFAULT 0,
          is_builtin INTEGER NOT NULL DEFAULT 0,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP
        )
      `)

      // Run migration
      addReviewGate.up(db)

      // Verify column exists
      const tableInfo = db.prepare('PRAGMA table_info(pmo_actions)').all() as { name: string }[]
      const columnNames = tableInfo.map(c => c.name)
      expect(columnNames).to.include('review_gate')
    })

    it('should be idempotent (skip if column already exists)', () => {
      // Run migration twice - should not error
      addReviewGate.up(db) // pmo_actions already created with review_gate in beforeEach
      addReviewGate.up(db)

      const tableInfo = db.prepare('PRAGMA table_info(pmo_actions)').all() as { name: string }[]
      const reviewGateCols = tableInfo.filter(c => c.name === 'review_gate')
      expect(reviewGateCols).to.have.length(1)
    })

    it('should allow valid review_gate values', () => {
      const now = new Date().toISOString()

      // Insert action with each valid review gate mode
      for (const mode of ['required', 'auto', 'post']) {
        db.prepare(`
          INSERT INTO pmo_actions (id, name, prompt, review_gate, created_at) VALUES (?, ?, ?, ?, ?)
        `).run(`action-${mode}`, `Action ${mode}`, 'Do stuff', mode, now)
      }

      // Insert action with NULL review_gate (uses workspace default)
      db.prepare(`
        INSERT INTO pmo_actions (id, name, prompt, review_gate, created_at) VALUES (?, ?, ?, NULL, ?)
      `).run('action-null', 'Action null', 'Do stuff', now)

      // Verify all were inserted
      const count = (db.prepare('SELECT COUNT(*) as c FROM pmo_actions').get() as { c: number }).c
      expect(count).to.equal(4)
    })

    it('should skip if pmo_actions table does not exist', () => {
      const emptyDb = new Database(':memory:')
      // Should not throw
      addReviewGate.up(emptyDb)
      emptyDb.close()
    })
  })

  describe('pmo_actions schema review_gate constraint', () => {
    it('should reject invalid review_gate values', () => {
      const now = new Date().toISOString()
      expect(() => {
        db.prepare(`
          INSERT INTO pmo_actions (id, name, prompt, review_gate, created_at) VALUES (?, ?, ?, ?, ?)
        `).run('bad-action', 'Bad', 'Do stuff', 'invalid', now)
      }).to.throw()
    })
  })
})
