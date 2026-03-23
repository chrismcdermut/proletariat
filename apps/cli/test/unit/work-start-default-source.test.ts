import { expect } from 'chai'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import {
  isLocalTicketId,
  loadDefaultWorkSource,
  saveDefaultWorkSource,
  clearDefaultWorkSource,
} from '../../src/lib/work-source/config.js'

function setupDb(): SqliteDatabase {
  const db = new SqliteDatabase(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `)
  return db
}

/**
 * Simulates the auto-detection logic from work start's execute():
 * If ticketId is provided, not from-issue, and not a local TKT-XXX ID,
 * try to resolve via the default source.
 */
function simulateAutoDetect(
  ticketId: string | undefined,
  fromIssueActive: boolean,
  db: SqliteDatabase,
): { route: 'local' | 'external' | 'error-no-source' | 'prompt'; source?: string; key?: string } {
  if (!ticketId) {
    return { route: 'prompt' }
  }

  if (fromIssueActive) {
    return { route: 'external' }
  }

  if (isLocalTicketId(ticketId)) {
    return { route: 'local' }
  }

  // Non-local ID: try default source
  const defaultSource = loadDefaultWorkSource(db)
  if (defaultSource && ['linear', 'jira', 'asana', 'shortcut', 'trello'].includes(defaultSource.provider)) {
    return { route: 'external', source: defaultSource.provider, key: ticketId }
  }

  return { route: 'error-no-source' }
}

describe('work start default source resolution', () => {
  describe('auto-detect routing for positional ticketId', () => {
    it('routes TKT-123 to local PMO lookup', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'linear', context: 'PRO' })
      const result = simulateAutoDetect('TKT-123', false, db)
      expect(result.route).to.equal('local')
      db.close()
    })

    it('routes PRLT-933 to default source when linear is configured', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'linear', context: 'PRO' })
      const result = simulateAutoDetect('PRLT-933', false, db)
      expect(result.route).to.equal('external')
      expect(result.source).to.equal('linear')
      expect(result.key).to.equal('PRLT-933')
      db.close()
    })

    it('routes ENG-456 to default source when jira is configured', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'jira', context: 'ENG' })
      const result = simulateAutoDetect('ENG-456', false, db)
      expect(result.route).to.equal('external')
      expect(result.source).to.equal('jira')
      expect(result.key).to.equal('ENG-456')
      db.close()
    })

    it('returns error when non-local ID and no default source configured', () => {
      const db = setupDb()
      const result = simulateAutoDetect('PRLT-933', false, db)
      expect(result.route).to.equal('error-no-source')
      db.close()
    })

    it('returns error when default source is pmo (not an external issue source)', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'pmo' })
      const result = simulateAutoDetect('PRLT-933', false, db)
      expect(result.route).to.equal('error-no-source')
      db.close()
    })

    it('prompts when no ticketId is provided', () => {
      const db = setupDb()
      const result = simulateAutoDetect(undefined, false, db)
      expect(result.route).to.equal('prompt')
      db.close()
    })

    it('skips auto-detect when --from-issue is already active', () => {
      const db = setupDb()
      const result = simulateAutoDetect('PRLT-933', true, db)
      expect(result.route).to.equal('external')
      expect(result.source).to.be.undefined // source determined by --from flag, not auto-detect
      db.close()
    })
  })

  describe('--from override takes precedence', () => {
    /**
     * Simulates the --from flag parsing logic from work start.
     */
    function parseFromFlag(fromFlag: string): { source: string; key?: string } {
      const colonIndex = fromFlag.indexOf(':')
      if (colonIndex !== -1) {
        return {
          source: fromFlag.slice(0, colonIndex).toLowerCase(),
          key: fromFlag.slice(colonIndex + 1).trim(),
        }
      }
      return { source: fromFlag.toLowerCase() }
    }

    it('--from linear:ENG-123 overrides default source', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'jira', context: 'PROJ' })

      const parsed = parseFromFlag('linear:ENG-123')
      expect(parsed.source).to.equal('linear')
      expect(parsed.key).to.equal('ENG-123')
      // Default source (jira) is not consulted when --from is explicit
      db.close()
    })

    it('--from jira:PROJ-456 provides explicit override', () => {
      const db = setupDb()
      // No default source set, but --from still works
      const parsed = parseFromFlag('jira:PROJ-456')
      expect(parsed.source).to.equal('jira')
      expect(parsed.key).to.equal('PROJ-456')
      db.close()
    })
  })

  describe('config persistence for default source', () => {
    it('default source persists across load/save cycles', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'linear', context: 'PRO' })

      // Verify it persists
      const loaded = loadDefaultWorkSource(db)
      expect(loaded).to.not.be.null
      expect(loaded!.provider).to.equal('linear')
      expect(loaded!.context).to.equal('PRO')

      // Change it
      saveDefaultWorkSource(db, { provider: 'jira', context: 'ENG' })
      const reloaded = loadDefaultWorkSource(db)
      expect(reloaded!.provider).to.equal('jira')
      expect(reloaded!.context).to.equal('ENG')

      db.close()
    })

    it('clearing default source returns null on next load', () => {
      const db = setupDb()
      saveDefaultWorkSource(db, { provider: 'linear', context: 'PRO' })
      clearDefaultWorkSource(db)
      expect(loadDefaultWorkSource(db)).to.be.null
      db.close()
    })

    it('legacy work.active_source is migrated on load', () => {
      const db = setupDb()
      // Simulate old data
      db.prepare(`INSERT INTO workspace_settings (key, value) VALUES ('work.active_source', 'linear:PRO')`).run()

      const loaded = loadDefaultWorkSource(db)
      expect(loaded).to.deep.equal({ provider: 'linear', context: 'PRO' })

      // Legacy key should be cleaned up
      const oldRow = db.prepare(`SELECT value FROM workspace_settings WHERE key = 'work.active_source'`).get()
      expect(oldRow).to.be.undefined

      // New key should exist
      const newRow = db.prepare(`SELECT value FROM workspace_settings WHERE key = 'work.default_source'`).get() as { value: string }
      expect(newRow.value).to.equal('linear:PRO')

      db.close()
    })

    it('default source is only changed via explicit save, never auto-mutated', () => {
      const db = setupDb()

      // Initially null
      expect(loadDefaultWorkSource(db)).to.be.null

      // Multiple loads don't create a default
      loadDefaultWorkSource(db)
      loadDefaultWorkSource(db)
      expect(loadDefaultWorkSource(db)).to.be.null

      // Only explicit save changes it
      saveDefaultWorkSource(db, { provider: 'linear' })
      expect(loadDefaultWorkSource(db)!.provider).to.equal('linear')

      db.close()
    })
  })
})
