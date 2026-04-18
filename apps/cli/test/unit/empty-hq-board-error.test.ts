/**
 * PRLT-1325: Empty HQ silently falls back to other HQ's board — should error clearly
 *
 * Tests that:
 * 1. An HQ with Linear API key but no team key configured errors clearly
 * 2. resolveProjectProvider auto-mode does not select Linear without HQ-local team config
 * 3. LinearTicketProvider.listTickets() returns clear error when team key is missing
 */

import { expect } from 'chai'

// =============================================================================
// Mock DB helpers
// =============================================================================

/**
 * Mock DB where Linear API key exists in credential store but NO team key.
 * Simulates: `prlt linear connect` was run in another HQ (API key is global)
 * but this HQ never configured a default team.
 */
function createApiKeyOnlyDb() {
  return {
    name: '', // in-memory — getCredential uses workspace_settings fallback
    prepare: (sql: string) => ({
      get: (key?: string) => {
        // hasCredential / getCredential: API key exists
        if (sql.includes('workspace_settings') && key === 'linear.api_key') {
          return { value: 'lin_api_test_key_12345' }
        }
        // resolveLinearTeamKey → SettingsStore: no team key
        if (sql.includes('workspace_settings') && key === 'linear.default_team_key') {
          return undefined
        }
        // provider_sources table: empty
        if (sql.includes('provider_sources')) {
          return undefined
        }
        return undefined
      },
      all: () => [],
      run: () => {},
    }),
    exec: () => {},
    pragma: () => {},
  } as any
}

/**
 * Mock DB where Linear has BOTH API key and team key configured.
 * Simulates a properly configured HQ.
 */
function createFullyConfiguredDb() {
  return {
    name: '',
    prepare: (sql: string) => ({
      get: (key?: string) => {
        if (sql.includes('workspace_settings') && key === 'linear.api_key') {
          return { value: 'lin_api_test_key_12345' }
        }
        if (sql.includes('workspace_settings') && key === 'linear.default_team_key') {
          return { value: 'PRLT' }
        }
        return undefined
      },
      all: () => [],
      run: () => {},
    }),
    exec: () => {},
    pragma: () => {},
  } as any
}

/**
 * Mock DB with no Linear config at all (empty HQ).
 */
function createEmptyDb() {
  return {
    name: '',
    prepare: () => ({
      get: () => undefined,
      all: () => [],
      run: () => {},
    }),
    exec: () => {},
    pragma: () => {},
  } as any
}

function createMockStorage() {
  return {
    getTicket: async () => null,
    getProjectBoard: async () => null,
    moveTicket: async () => ({} as any),
    deleteTicket: async () => {},
    listTickets: async () => [],
    createTicket: async () => ({} as any),
    updateTicket: async () => ({} as any),
    getDatabase: () => createEmptyDb(),
  }
}

// =============================================================================
// hasLinearTeamConfig
// =============================================================================

describe('hasLinearTeamConfig (PRLT-1325)', () => {
  let hasLinearTeamConfig: typeof import('../../src/lib/linear/config.js').hasLinearTeamConfig

  before(async () => {
    const mod = await import('../../src/lib/linear/config.js')
    hasLinearTeamConfig = mod.hasLinearTeamConfig
  })

  it('returns false when no team key is configured', () => {
    const db = createApiKeyOnlyDb()
    expect(hasLinearTeamConfig(db)).to.be.false
  })

  it('returns true when team key is in workspace_settings', () => {
    const db = createFullyConfiguredDb()
    expect(hasLinearTeamConfig(db)).to.be.true
  })

  it('returns false for completely empty HQ', () => {
    const db = createEmptyDb()
    expect(hasLinearTeamConfig(db)).to.be.false
  })
})

// =============================================================================
// resolveProjectProvider auto-mode (PRLT-1325)
// =============================================================================

describe('resolveProjectProvider auto-mode skips Linear without team config (PRLT-1325)', () => {
  let resolveProjectProvider: typeof import('../../src/lib/providers/resolver.js').resolveProjectProvider

  before(async () => {
    const mod = await import('../../src/lib/providers/resolver.js')
    resolveProjectProvider = mod.resolveProjectProvider
  })

  it('falls back to PMO when Linear has API key but no team key (auto mode)', () => {
    const db = createApiKeyOnlyDb()
    const storage = createMockStorage()
    const provider = resolveProjectProvider(db, storage, 'test-project')

    // Should NOT select Linear — should fall back to PMO
    expect(provider.name).to.equal('pmo')
  })

  it('falls back to PMO when Linear has API key but no team key (explicit auto)', () => {
    const db = createApiKeyOnlyDb()
    const storage = createMockStorage()
    const provider = resolveProjectProvider(db, storage, 'test-project', 'auto')

    expect(provider.name).to.equal('pmo')
  })

  it('selects Linear when both API key and team key are configured (auto mode)', () => {
    const db = createFullyConfiguredDb()
    const storage = createMockStorage()
    const provider = resolveProjectProvider(db, storage, 'test-project')

    expect(provider.name).to.equal('linear')
  })

  it('selects Linear when source is explicitly "linear" even without team config', () => {
    // Explicit source selection should still work — the error will come
    // from the provider itself when it tries to list tickets
    const db = createApiKeyOnlyDb()
    const storage = createMockStorage()
    const provider = resolveProjectProvider(db, storage, 'test-project', 'linear')

    expect(provider.name).to.equal('linear')
  })

  it('falls back to PMO for completely empty HQ (auto mode)', () => {
    const db = createEmptyDb()
    const storage = createMockStorage()
    const provider = resolveProjectProvider(db, storage, 'test-project')

    expect(provider.name).to.equal('pmo')
  })
})

// =============================================================================
// LinearTicketProvider.listTickets error on missing team key (PRLT-1325)
// =============================================================================

describe('LinearTicketProvider.listTickets errors on missing team key (PRLT-1325)', () => {
  it('returns clear error when API key exists but no team key', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    const db = createApiKeyOnlyDb()
    const provider = new LinearTicketProvider(db)

    // Save and clear env vars to prevent env-var fallback
    const savedTeam = process.env.PRLT_LINEAR_TEAM
    const savedTeamKey = process.env.LINEAR_TEAM_KEY
    delete process.env.PRLT_LINEAR_TEAM
    delete process.env.LINEAR_TEAM_KEY

    try {
      const result = await provider.listTickets()

      expect(result.success).to.be.false
      expect(result.provider).to.equal('linear')
      expect(result.tickets).to.have.lengthOf(0)
      expect(result.error).to.include("isn't connected to a board")
      expect(result.error).to.include('prlt linear connect')
    } finally {
      // Restore env vars
      if (savedTeam !== undefined) process.env.PRLT_LINEAR_TEAM = savedTeam
      if (savedTeamKey !== undefined) process.env.LINEAR_TEAM_KEY = savedTeamKey
    }
  })

  it('error message includes actionable next step', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    const db = createApiKeyOnlyDb()
    const provider = new LinearTicketProvider(db)

    const savedTeam = process.env.PRLT_LINEAR_TEAM
    const savedTeamKey = process.env.LINEAR_TEAM_KEY
    delete process.env.PRLT_LINEAR_TEAM
    delete process.env.LINEAR_TEAM_KEY

    try {
      const result = await provider.listTickets()

      expect(result.success).to.be.false
      // Verify the error message tells the user what to do
      expect(result.error).to.match(/prlt linear connect/)
    } finally {
      if (savedTeam !== undefined) process.env.PRLT_LINEAR_TEAM = savedTeam
      if (savedTeamKey !== undefined) process.env.LINEAR_TEAM_KEY = savedTeamKey
    }
  })
})
