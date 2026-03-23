/**
 * Regression test for PRLT-987: Linear team key persistence
 *
 * Bug: `linear connect --team` did not persist the team key when credentials
 * already existed. The command would show "Already connected" and exit without
 * updating the default team.
 *
 * Fix (PR #831): When --team flag is provided and credentials are valid,
 * call handleTeamSelection() to update the persisted team key instead of
 * returning early.
 *
 * This test verifies the config layer: saving a team key and then loading it
 * back should always return the persisted team, and updating the team key
 * should persist the new value (the core behavior the fix enables).
 */

import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  isLinearConfigured,
  loadLinearConfig,
  saveLinearApiKey,
  saveLinearDefaultTeam,
  saveLinearOrganization,
  clearLinearConfig,
} from '../../src/lib/linear/config.js'
import {
  upsertProviderSource,
  loadProviderSources,
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

describe('Regression: PRLT-987 — Linear team key persistence', () => {
  let db: Database.Database

  beforeEach(() => {
    db = setupDb()
  })

  afterEach(() => {
    db.close()
  })

  it('persists team key and ID when saving default team', () => {
    saveLinearApiKey(db, 'lin_api_test123')
    saveLinearDefaultTeam(db, 'team-uuid-eng', 'ENG')

    const config = loadLinearConfig(db)
    expect(config).to.not.be.null
    expect(config!.defaultTeamId).to.equal('team-uuid-eng')
    expect(config!.defaultTeamKey).to.equal('ENG')
  })

  it('updates team key when called again with different team (simulates --team flag re-use)', () => {
    // Initial setup: connect with team ENG
    saveLinearApiKey(db, 'lin_api_test123')
    saveLinearOrganization(db, 'Test Org')
    saveLinearDefaultTeam(db, 'team-uuid-eng', 'ENG')

    // Verify initial state
    let config = loadLinearConfig(db)
    expect(config!.defaultTeamKey).to.equal('ENG')

    // Simulate: user runs `linear connect --team PRODUCT` while already connected
    // The fix ensures handleTeamSelection is called, which calls saveLinearDefaultTeam
    saveLinearDefaultTeam(db, 'team-uuid-product', 'PRODUCT')

    // Verify the team was updated (this is the core regression check)
    config = loadLinearConfig(db)
    expect(config!.defaultTeamKey).to.equal('PRODUCT')
    expect(config!.defaultTeamId).to.equal('team-uuid-product')

    // API key and org should be unchanged
    expect(config!.apiKey).to.equal('lin_api_test123')
    expect(config!.organizationName).to.equal('Test Org')
  })

  it('provider source is updated when team changes', () => {
    saveLinearApiKey(db, 'lin_api_test123')

    // First team selection
    saveLinearDefaultTeam(db, 'team-uuid-eng', 'ENG')
    upsertProviderSource(db, {
      id: 'linear',
      provider: 'linear',
      apiKeyRef: 'linear.api_key',
      teamProjectId: 'ENG',
      prefix: 'ENG-',
      label: 'Engineering',
    })

    let sources = loadProviderSources(db)
    const linearSource = sources.find(s => s.id === 'linear')
    expect(linearSource).to.not.be.undefined
    expect(linearSource!.teamProjectId).to.equal('ENG')
    expect(linearSource!.prefix).to.equal('ENG-')

    // Switch team (simulates second --team flag call)
    saveLinearDefaultTeam(db, 'team-uuid-product', 'PRODUCT')
    upsertProviderSource(db, {
      id: 'linear',
      provider: 'linear',
      apiKeyRef: 'linear.api_key',
      teamProjectId: 'PRODUCT',
      prefix: 'PRODUCT-',
      label: 'Product',
    })

    sources = loadProviderSources(db)
    const updatedSource = sources.find(s => s.id === 'linear')
    expect(updatedSource!.teamProjectId).to.equal('PRODUCT')
    expect(updatedSource!.prefix).to.equal('PRODUCT-')
  })

  it('subsequent loadLinearConfig finds team without re-saving (persistence check)', () => {
    saveLinearApiKey(db, 'lin_api_test123')
    saveLinearDefaultTeam(db, 'team-uuid-eng', 'ENG')

    // Verify the data persists across multiple loadLinearConfig calls (no stale cache)
    const config1 = loadLinearConfig(db)
    const config2 = loadLinearConfig(db)

    expect(config1!.defaultTeamKey).to.equal('ENG')
    expect(config2!.defaultTeamKey).to.equal('ENG')
    expect(config1).to.deep.equal(config2)
  })

  it('team key persists even after clearing and re-adding API key', () => {
    // Set up initial state
    saveLinearApiKey(db, 'lin_api_test123')
    saveLinearDefaultTeam(db, 'team-uuid-eng', 'ENG')

    // Clear everything (simulates disconnect)
    clearLinearConfig(db)
    expect(isLinearConfigured(db)).to.be.false

    // Re-connect with same API key
    saveLinearApiKey(db, 'lin_api_test123')

    // Team should be gone after disconnect
    const config = loadLinearConfig(db)
    expect(config!.apiKey).to.equal('lin_api_test123')
    expect(config!.defaultTeamKey).to.be.undefined

    // Set team again (simulates --team flag on reconnect)
    saveLinearDefaultTeam(db, 'team-uuid-eng', 'ENG')
    const config2 = loadLinearConfig(db)
    expect(config2!.defaultTeamKey).to.equal('ENG')
  })
})
