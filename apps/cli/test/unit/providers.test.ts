import { expect } from 'chai'
import type { PostExecutionStorage } from '../../src/lib/work-lifecycle/post-execution.js'
import type { StateCategory } from '../../src/lib/pmo/types.js'
import { PMOTicketProvider } from '../../src/lib/providers/pmo-provider.js'

// =============================================================================
// Test Helpers
// =============================================================================

interface MockTicket {
  id: string
  projectId?: string
  statusName?: string
  statusCategory?: StateCategory | null
  metadata?: Record<string, string> | null
}

function createMockStorage(overrides?: {
  ticket?: MockTicket | null
  board?: { columns: Array<{ name: string }> } | null
  moveError?: Error
  moveCalls?: Array<{ projectId: string; ticketId: string; columnName: string }>
}): PostExecutionStorage {
  const moveCalls = overrides?.moveCalls ?? []

  return {
    getTicket: async (id: string) => {
      if (overrides?.ticket === null) return null
      return overrides?.ticket ?? {
        id,
        projectId: 'test-project',
        statusName: 'In Progress',
        statusCategory: 'started' as StateCategory,
        metadata: { pr_url: 'https://github.com/test/pr/1' },
      }
    },
    getProjectBoard: async () => {
      if (overrides?.board === null) return null
      return overrides?.board ?? {
        columns: [
          { name: 'Backlog' },
          { name: 'In Progress' },
          { name: 'Review' },
          { name: 'Done' },
        ],
      }
    },
    moveTicket: async (projectId: string, ticketId: string, columnName: string) => {
      if (overrides?.moveError) throw overrides.moveError
      moveCalls.push({ projectId, ticketId, columnName })
      return {} as unknown
    },
  }
}

// =============================================================================
// PMOTicketProvider Tests
// =============================================================================

describe('PMOTicketProvider', () => {
  it('delegates moveTicket to storage with correct arguments', async () => {
    const moveCalls: Array<{ projectId: string; ticketId: string; columnName: string }> = []
    const storage = createMockStorage({ moveCalls })
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.moveTicket('TKT-001', 'Review')

    expect(result.success).to.be.true
    expect(result.provider).to.equal('pmo')
    expect(moveCalls).to.have.lengthOf(1)
    expect(moveCalls[0]).to.deep.equal({
      projectId: 'test-project',
      ticketId: 'TKT-001',
      columnName: 'Review',
    })
  })

  it('returns failure with error message when storage throws', async () => {
    const storage = createMockStorage({
      moveError: new Error('Database locked'),
    })
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.moveTicket('TKT-001', 'Review')

    expect(result.success).to.be.false
    expect(result.provider).to.equal('pmo')
    expect(result.error).to.equal('Database locked')
  })

  it('has name "pmo"', () => {
    const storage = createMockStorage()
    const provider = new PMOTicketProvider(storage, 'test-project')
    expect(provider.name).to.equal('pmo')
  })
})

// =============================================================================
// Provider Resolution Tests (resolveTicketProvider)
// =============================================================================

describe('resolveTicketProvider', () => {
  // Import dynamically to avoid needing DB setup for every test
  let resolveTicketProvider: typeof import('../../src/lib/providers/resolver.js').resolveTicketProvider

  before(async () => {
    const mod = await import('../../src/lib/providers/resolver.js')
    resolveTicketProvider = mod.resolveTicketProvider
  })

  it('returns PMOTicketProvider when no external_source metadata', () => {
    const storage = createMockStorage()
    // We need a real DB for the resolver, but for the no-provider path
    // it just returns PMOTicketProvider without touching the DB
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const provider = resolveTicketProvider(
      'TKT-001',
      'test-project',
      mockDb,
      storage,
      null, // no metadata
    )

    expect(provider.name).to.equal('pmo')
  })

  it('returns PMOTicketProvider when external_source is not a recognized provider', () => {
    const storage = createMockStorage()
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const provider = resolveTicketProvider(
      'TKT-001',
      'test-project',
      mockDb,
      storage,
      { external_source: 'github' },
    )

    expect(provider.name).to.equal('pmo')
  })

  it('returns PMOTicketProvider when external_source is linear but no config', () => {
    const storage = createMockStorage()
    // Mock DB that returns no Linear API key (not configured)
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const provider = resolveTicketProvider(
      'TKT-001',
      'test-project',
      mockDb,
      storage,
      { external_source: 'linear' },
    )

    // Without Linear configured, falls back to PMO
    expect(provider.name).to.equal('pmo')
  })
})

// =============================================================================
// handlePostExecutionTransition with Provider Tests
// =============================================================================

describe('handlePostExecutionTransition (provider routing)', () => {
  let handlePostExecutionTransition: typeof import('../../src/lib/work-lifecycle/post-execution.js').handlePostExecutionTransition

  before(async () => {
    const mod = await import('../../src/lib/work-lifecycle/post-execution.js')
    handlePostExecutionTransition = mod.handlePostExecutionTransition
  })

  it('returns transitioned=false when ticket not found', async () => {
    const storage = createMockStorage({ ticket: null })
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const result = await handlePostExecutionTransition(
      { ticketId: 'TKT-001' },
      storage,
      mockDb,
    )

    expect(result.transitioned).to.be.false
  })

  it('returns transitioned=false when ticket is not in started category', async () => {
    const storage = createMockStorage({
      ticket: {
        id: 'TKT-001',
        projectId: 'test-project',
        statusName: 'Done',
        statusCategory: 'completed',
        metadata: { pr_url: 'https://github.com/test/pr/1' },
      },
    })
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const result = await handlePostExecutionTransition(
      { ticketId: 'TKT-001' },
      storage,
      mockDb,
    )

    expect(result.transitioned).to.be.false
  })

  it('returns transitioned=false when no PR URL in metadata', async () => {
    const storage = createMockStorage({
      ticket: {
        id: 'TKT-001',
        projectId: 'test-project',
        statusName: 'In Progress',
        statusCategory: 'started',
        metadata: {}, // no pr_url
      },
    })
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const result = await handlePostExecutionTransition(
      { ticketId: 'TKT-001' },
      storage,
      mockDb,
    )

    expect(result.transitioned).to.be.false
  })

  it('uses PMO provider for tickets without external_source and transitions successfully', async () => {
    const moveCalls: Array<{ projectId: string; ticketId: string; columnName: string }> = []
    const storage = createMockStorage({
      ticket: {
        id: 'TKT-001',
        projectId: 'test-project',
        statusName: 'In Progress',
        statusCategory: 'started',
        metadata: { pr_url: 'https://github.com/test/pr/1' },
      },
      moveCalls,
    })

    // Mock DB: return 'Review' as the work column setting
    const mockDb = {
      prepare: (sql: string) => {
        if (sql.includes('workspace_settings')) {
          return {
            get: (key: string) => {
              if (key === 'work.columns.review') return { value: 'Review' }
              return undefined
            },
            all: () => [],
            run: () => {},
          }
        }
        return { get: () => undefined, all: () => [], run: () => {} }
      },
      exec: () => {},
      pragma: () => {},
    } as any

    const result = await handlePostExecutionTransition(
      { ticketId: 'TKT-001' },
      storage,
      mockDb,
    )

    expect(result.transitioned).to.be.true
    expect(result.fromState).to.equal('In Progress')
    expect(result.toState).to.equal('Review')
    expect(result.provider).to.equal('pmo')
    expect(moveCalls).to.have.lengthOf(1)
    expect(moveCalls[0].columnName).to.equal('Review')
  })

  it('returns provider info in result when transition succeeds', async () => {
    const storage = createMockStorage({
      ticket: {
        id: 'TKT-001',
        projectId: 'test-project',
        statusName: 'In Progress',
        statusCategory: 'started',
        metadata: { pr_url: 'https://github.com/test/pr/1' },
      },
    })

    const mockDb = {
      prepare: (sql: string) => {
        if (sql.includes('workspace_settings')) {
          return {
            get: () => ({ value: 'Review' }),
            all: () => [],
            run: () => {},
          }
        }
        return { get: () => undefined, all: () => [], run: () => {} }
      },
      exec: () => {},
      pragma: () => {},
    } as any

    const result = await handlePostExecutionTransition(
      { ticketId: 'TKT-001' },
      storage,
      mockDb,
    )

    expect(result.provider).to.be.a('string')
    expect(result.providerError).to.be.undefined
  })

  it('returns transitioned=false when already in Review', async () => {
    const storage = createMockStorage({
      ticket: {
        id: 'TKT-001',
        projectId: 'test-project',
        statusName: 'Review',
        statusCategory: 'started',
        metadata: { pr_url: 'https://github.com/test/pr/1' },
      },
    })

    const mockDb = {
      prepare: (sql: string) => {
        if (sql.includes('workspace_settings')) {
          return {
            get: () => ({ value: 'Review' }),
            all: () => [],
            run: () => {},
          }
        }
        return { get: () => undefined, all: () => [], run: () => {} }
      },
      exec: () => {},
      pragma: () => {},
    } as any

    const result = await handlePostExecutionTransition(
      { ticketId: 'TKT-001' },
      storage,
      mockDb,
    )

    expect(result.transitioned).to.be.false
  })

  it('returns provider error when PMO move fails', async () => {
    const storage = createMockStorage({
      ticket: {
        id: 'TKT-001',
        projectId: 'test-project',
        statusName: 'In Progress',
        statusCategory: 'started',
        metadata: { pr_url: 'https://github.com/test/pr/1' },
      },
      moveError: new Error('Status not found: Review'),
    })

    const mockDb = {
      prepare: (sql: string) => {
        if (sql.includes('workspace_settings')) {
          return {
            get: () => ({ value: 'Review' }),
            all: () => [],
            run: () => {},
          }
        }
        return { get: () => undefined, all: () => [], run: () => {} }
      },
      exec: () => {},
      pragma: () => {},
    } as any

    const result = await handlePostExecutionTransition(
      { ticketId: 'TKT-001' },
      storage,
      mockDb,
    )

    expect(result.transitioned).to.be.false
    expect(result.provider).to.equal('pmo')
    expect(result.providerError).to.equal('Status not found: Review')
  })
})

// =============================================================================
// LinearTicketProvider Tests (unit tests with mocked dependencies)
// =============================================================================

describe('LinearTicketProvider', () => {
  it('has name "linear"', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    const storage = createMockStorage()
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const provider = new LinearTicketProvider(mockDb, storage, 'test-project', null)
    expect(provider.name).to.equal('linear')
  })

  it('returns failure when Linear API key is not configured', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    const storage = createMockStorage()
    // Mock DB that returns no API key
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const provider = new LinearTicketProvider(mockDb, storage, 'test-project', null)
    const result = await provider.moveTicket('TKT-001', 'Review')

    expect(result.success).to.be.false
    expect(result.provider).to.equal('linear')
    expect(result.error).to.include('API key not configured')
  })

  it('returns failure when no Linear mapping exists for ticket', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    const storage = createMockStorage()

    // Mock DB that has API key but no mapping
    const mockDb = {
      prepare: (sql: string) => {
        if (sql.includes('workspace_settings') && sql.includes('SELECT')) {
          return {
            get: (key: string) => {
              if (key === 'linear.api_key') return { value: 'test-api-key' }
              return undefined
            },
            all: () => [],
            run: () => {},
          }
        }
        // No mapping found
        return { get: () => undefined, all: () => [], run: () => {} }
      },
      exec: () => {},
      pragma: () => {},
    } as any

    const provider = new LinearTicketProvider(mockDb, storage, 'test-project', null)
    const result = await provider.moveTicket('TKT-001', 'Review')

    expect(result.success).to.be.false
    expect(result.provider).to.equal('linear')
    expect(result.error).to.include('No Linear mapping')
  })
})
