/**
 * Regression test for PRLT-1182: ticket create should read Linear team from workspace config
 *
 * Bug: `prlt ticket create --source linear` fails with
 * "Linear team key is required. Set PRLT_LINEAR_TEAM." even though the team
 * is already configured in the workspace via `prlt linear connect` or
 * `prlt work source set linear`.
 *
 * Fix: Introduced resolveLinearTeamKey() that checks all sources in order:
 * 1. Explicit override (--team flag)
 * 2. Workspace settings (linear.default_team_key)
 * 3. Provider sources (teamProjectId)
 * 4. PRLT_LINEAR_TEAM / LINEAR_TEAM_KEY env vars
 *
 * The LinearTicketProvider now uses this function instead of only checking
 * loadLinearConfig + PRLT_LINEAR_TEAM.
 */

import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  resolveLinearTeamKey,
  saveLinearApiKey,
  saveLinearDefaultTeam,
} from '../../src/lib/linear/config.js'
import {
  upsertProviderSource,
} from '../../src/lib/work-source/provider-sources.js'

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
  return db
}

describe('Regression: PRLT-1182 — resolveLinearTeamKey reads workspace config', () => {
  let db: Database.Database
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    db = setupDb()
    // Save and clear env vars that affect resolution
    for (const key of ['PRLT_LINEAR_TEAM', 'LINEAR_TEAM_KEY']) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    db.close()
    // Restore env vars
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('returns null when no team is configured anywhere', () => {
    const result = resolveLinearTeamKey(db)
    expect(result).to.be.null
  })

  it('reads team key from workspace settings (linear.default_team_key)', () => {
    saveLinearApiKey(db, 'lin_api_test123')
    saveLinearDefaultTeam(db, 'team-uuid-eng', 'ENG')

    const result = resolveLinearTeamKey(db)
    expect(result).to.equal('ENG')
  })

  it('reads team key from provider sources when workspace settings have no team', () => {
    // No saveLinearDefaultTeam — team only in provider sources
    upsertProviderSource(db, {
      id: 'linear',
      provider: 'linear',
      apiKeyRef: 'linear.api_key',
      teamProjectId: 'PRODUCT',
      prefix: 'PRODUCT-',
      label: 'Product',
    })

    const result = resolveLinearTeamKey(db)
    expect(result).to.equal('PRODUCT')
  })

  it('reads team key from PRLT_LINEAR_TEAM env var as fallback', () => {
    process.env.PRLT_LINEAR_TEAM = 'INFRA'

    const result = resolveLinearTeamKey(db)
    expect(result).to.equal('INFRA')
  })

  it('reads team key from LINEAR_TEAM_KEY env var as last fallback', () => {
    process.env.LINEAR_TEAM_KEY = 'OPS'

    const result = resolveLinearTeamKey(db)
    expect(result).to.equal('OPS')
  })

  // --- Priority order tests ---

  it('explicit override takes precedence over everything', () => {
    saveLinearApiKey(db, 'lin_api_test123')
    saveLinearDefaultTeam(db, 'team-uuid-eng', 'ENG')
    process.env.PRLT_LINEAR_TEAM = 'INFRA'

    const result = resolveLinearTeamKey(db, 'OVERRIDE')
    expect(result).to.equal('OVERRIDE')
  })

  it('workspace settings take precedence over provider sources', () => {
    saveLinearApiKey(db, 'lin_api_test123')
    saveLinearDefaultTeam(db, 'team-uuid-eng', 'ENG')
    upsertProviderSource(db, {
      id: 'linear',
      provider: 'linear',
      apiKeyRef: 'linear.api_key',
      teamProjectId: 'PRODUCT',
      prefix: 'PRODUCT-',
    })

    const result = resolveLinearTeamKey(db)
    expect(result).to.equal('ENG')
  })

  it('workspace settings take precedence over env vars', () => {
    saveLinearApiKey(db, 'lin_api_test123')
    saveLinearDefaultTeam(db, 'team-uuid-eng', 'ENG')
    process.env.PRLT_LINEAR_TEAM = 'INFRA'

    const result = resolveLinearTeamKey(db)
    expect(result).to.equal('ENG')
  })

  it('provider sources take precedence over env vars', () => {
    upsertProviderSource(db, {
      id: 'linear',
      provider: 'linear',
      apiKeyRef: 'linear.api_key',
      teamProjectId: 'PRODUCT',
      prefix: 'PRODUCT-',
    })
    process.env.PRLT_LINEAR_TEAM = 'INFRA'

    const result = resolveLinearTeamKey(db)
    expect(result).to.equal('PRODUCT')
  })

  it('PRLT_LINEAR_TEAM takes precedence over LINEAR_TEAM_KEY', () => {
    process.env.PRLT_LINEAR_TEAM = 'INFRA'
    process.env.LINEAR_TEAM_KEY = 'OPS'

    const result = resolveLinearTeamKey(db)
    expect(result).to.equal('INFRA')
  })

  // --- Core regression: the exact scenario from the bug report ---

  it('resolves team when only workspace settings exist (no API key in credential store needed)', () => {
    // Simulate: user ran `prlt linear connect` which stores team key in workspace_settings
    // but API key might be resolved through provider sources instead of credential store.
    // resolveLinearTeamKey should still find the team key directly from workspace_settings.
    const settings = db.prepare('INSERT OR REPLACE INTO workspace_settings (key, value) VALUES (?, ?)')
    settings.run('linear.default_team_key', 'ENG')

    const result = resolveLinearTeamKey(db)
    expect(result).to.equal('ENG')
  })

  it('picks up team from provider sources even when API key is in env var only', () => {
    // Simulate: API key in env, team in provider sources (no credential store entry)
    // This is the case where loadLinearConfig would return null but team is still available
    upsertProviderSource(db, {
      id: 'eng-linear',
      provider: 'linear',
      apiKeyRef: 'PRLT_LINEAR_API_KEY',
      teamProjectId: 'ENG',
      prefix: 'ENG-',
      label: 'Engineering',
    })

    const result = resolveLinearTeamKey(db)
    expect(result).to.equal('ENG')
  })
})
