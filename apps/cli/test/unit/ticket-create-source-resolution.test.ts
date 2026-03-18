import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  getRegisteredWorkSources,
  loadDefaultWorkSource,
  saveDefaultWorkSource,
} from '../../src/lib/work-source/config.js'
import { saveLinearApiKey, saveLinearDefaultTeam, isLinearConfigured } from '../../src/lib/linear/config.js'

/**
 * Tests for ticket create source resolution logic.
 *
 * The resolveSource() method in ticket/create.ts uses these functions
 * to determine where to route ticket creation. These tests validate
 * the resolution behavior:
 *
 * 1. loadDefaultWorkSource() — checked first (explicit user preference)
 * 2. getRegisteredWorkSources() — auto-detect from configured providers
 * 3. Fall back to PMO when nothing external is configured
 */

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

describe('ticket create source resolution', () => {
  describe('loadDefaultWorkSource', () => {
    it('returns null when no default is configured', () => {
      const db = setupDb()
      const result = loadDefaultWorkSource(db)
      expect(result).to.be.null
      db.close()
    })

    it('returns linear when default work source is set to linear', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'linear' })
      const result = loadDefaultWorkSource(db)
      expect(result).to.not.be.null
      expect(result!.provider).to.equal('linear')
      db.close()
    })

    it('returns pmo when default work source is set to pmo', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'pmo' })
      const result = loadDefaultWorkSource(db)
      expect(result).to.not.be.null
      expect(result!.provider).to.equal('pmo')
      db.close()
    })
  })

  describe('getRegisteredWorkSources', () => {
    it('returns only PMO when no external providers configured', () => {
      const db = setupDb()
      const sources = getRegisteredWorkSources(db)
      const providers = sources.map(s => s.provider)
      expect(providers).to.deep.equal(['pmo'])
      db.close()
    })

    it('includes Linear when Linear API key is configured', () => {
      const db = setupDb()
      saveLinearApiKey(db, 'test-api-key')
      const sources = getRegisteredWorkSources(db)
      const providers = sources.map(s => s.provider)
      expect(providers).to.include('pmo')
      expect(providers).to.include('linear')
      db.close()
    })

    it('includes Linear team context when default team is set', () => {
      const db = setupDb()
      saveLinearApiKey(db, 'test-api-key')
      saveLinearDefaultTeam(db, 'team-uuid', 'ENG')
      const sources = getRegisteredWorkSources(db)
      const linearSource = sources.find(s => s.provider === 'linear')
      expect(linearSource).to.exist
      expect(linearSource!.context).to.equal('ENG')
      db.close()
    })
  })

  describe('auto-resolution logic (mirrors resolveSource behavior)', () => {
    /**
     * This test mirrors the resolveSource() logic in ticket/create.ts:
     * 1. Check loadDefaultWorkSource() first
     * 2. If not set, check external providers from getRegisteredWorkSources()
     * 3. Single external → auto-select; Multiple → would prompt; None → PMO
     */
    function resolveSourceForTest(db: Database.Database): 'pmo' | 'linear' {
      // Step 1: Check explicit default work source
      const defaultSource = loadDefaultWorkSource(db)
      if (defaultSource?.provider === 'linear') return 'linear'
      if (defaultSource?.provider === 'pmo') return 'pmo'

      // Step 2: Check registered providers
      const registeredSources = getRegisteredWorkSources(db)
      const externalProviders = [...new Set(
        registeredSources.map(s => s.provider).filter(p => p !== 'pmo')
      )]

      // No external providers — use PMO
      if (externalProviders.length === 0) return 'pmo'

      // Single external provider — auto-select it
      if (externalProviders.length === 1) {
        return externalProviders[0] === 'linear' ? 'linear' : 'pmo'
      }

      // Multiple external — would prompt in real code, default to PMO for test
      return 'pmo'
    }

    it('returns PMO when no providers configured', () => {
      const db = setupDb()
      expect(resolveSourceForTest(db)).to.equal('pmo')
      db.close()
    })

    it('returns linear when Linear is the only external provider', () => {
      const db = setupDb()
      saveLinearApiKey(db, 'test-api-key')
      expect(resolveSourceForTest(db)).to.equal('linear')
      db.close()
    })

    it('returns linear when default work source is set to linear', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'linear' })
      expect(resolveSourceForTest(db)).to.equal('linear')
      db.close()
    })

    it('respects explicit PMO default even when Linear is configured', () => {
      const db = setupDb()
      saveLinearApiKey(db, 'test-api-key')
      saveDefaultWorkSource(db, { provider: 'pmo' })
      expect(resolveSourceForTest(db)).to.equal('pmo')
      db.close()
    })

    it('isLinearConfigured returns true when API key exists', () => {
      const db = setupDb()
      expect(isLinearConfigured(db)).to.be.false
      saveLinearApiKey(db, 'test-api-key')
      expect(isLinearConfigured(db)).to.be.true
      db.close()
    })
  })
})
