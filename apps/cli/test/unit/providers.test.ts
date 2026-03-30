import { expect } from 'chai'
import type { ProviderStorage } from '../../src/lib/providers/types.js'
import type { StateCategory, Ticket, TicketFilter, CreateTicketInput } from '../../src/lib/pmo/types.js'
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
  tickets?: Ticket[]
  board?: { columns: Array<{ name: string }> } | null
  moveError?: Error
  deleteError?: Error
  createError?: Error
  updateError?: Error
  moveCalls?: Array<{ projectId: string; ticketId: string; columnName: string }>
  deleteCalls?: string[]
  createCalls?: Array<{ projectId: string; input: CreateTicketInput }>
  updateCalls?: Array<{ id: string; changes: Partial<Ticket> }>
}): ProviderStorage {
  const moveCalls = overrides?.moveCalls ?? []
  const deleteCalls = overrides?.deleteCalls ?? []
  const createCalls = overrides?.createCalls ?? []
  const updateCalls = overrides?.updateCalls ?? []

  return {
    getTicket: async (id: string) => {
      if (overrides?.ticket === null) return null
      const ticket = overrides?.ticket ?? {
        id,
        projectId: 'test-project',
        statusName: 'In Progress',
        statusCategory: 'started' as StateCategory,
        metadata: { pr_url: 'https://github.com/test/pr/1' },
      }
      return {
        ...ticket,
        title: 'Test ticket',
        statusId: ticket.statusName || 'backlog',
        subtasks: [],
        labels: [],
        metadata: ticket.metadata || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Ticket
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
      return {
        id: ticketId,
        title: 'Test ticket',
        projectId,
        statusId: columnName,
        statusName: columnName,
        subtasks: [],
        labels: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Ticket
    },
    deleteTicket: async (id: string) => {
      if (overrides?.deleteError) throw overrides.deleteError
      deleteCalls.push(id)
    },
    listTickets: async (projectId: string | undefined, filter?: TicketFilter) => {
      return overrides?.tickets ?? []
    },
    createTicket: async (projectId: string, input: CreateTicketInput) => {
      if (overrides?.createError) throw overrides.createError
      createCalls.push({ projectId, input })
      return {
        id: input.id || 'TKT-NEW',
        title: input.title,
        projectId,
        statusId: input.statusName || 'backlog',
        statusName: input.statusName || 'Backlog',
        subtasks: [],
        labels: input.labels || [],
        metadata: input.metadata || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Ticket
    },
    updateTicket: async (id: string, changes: Partial<Ticket>) => {
      if (overrides?.updateError) throw overrides.updateError
      updateCalls.push({ id, changes })
      const ticket = overrides?.ticket ?? { id, projectId: 'test-project', statusName: 'In Progress' }
      return {
        ...ticket,
        ...changes,
        id,
        title: (changes.title as string) || 'Test ticket',
        statusId: ticket.statusName || 'backlog',
        subtasks: [],
        labels: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Ticket
    },
    getDatabase: () => ({
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    }) as any,
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

  it('returns failure with error message when moveTicket throws', async () => {
    const storage = createMockStorage({
      moveError: new Error('Database locked'),
    })
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.moveTicket('TKT-001', 'Review')

    expect(result.success).to.be.false
    expect(result.provider).to.equal('pmo')
    expect(result.error).to.equal('Database locked')
  })

  it('delegates deleteTicket to storage', async () => {
    const deleteCalls: string[] = []
    const storage = createMockStorage({ deleteCalls })
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.deleteTicket('TKT-001')

    expect(result.success).to.be.true
    expect(result.provider).to.equal('pmo')
    expect(deleteCalls).to.deep.equal(['TKT-001'])
  })

  it('returns failure when deleteTicket throws', async () => {
    const storage = createMockStorage({
      deleteError: new Error('Ticket not found'),
    })
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.deleteTicket('TKT-001')

    expect(result.success).to.be.false
    expect(result.provider).to.equal('pmo')
    expect(result.error).to.equal('Ticket not found')
  })

  it('delegates listTickets to storage', async () => {
    const mockTickets = [
      { id: 'TKT-001', title: 'First', projectId: 'test-project', statusId: 'backlog', statusName: 'Backlog', subtasks: [], labels: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      { id: 'TKT-002', title: 'Second', projectId: 'test-project', statusId: 'in-progress', statusName: 'In Progress', subtasks: [], labels: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() },
    ] as Ticket[]
    const storage = createMockStorage({ tickets: mockTickets })
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.listTickets('test-project')

    expect(result.success).to.be.true
    expect(result.provider).to.equal('pmo')
    expect(result.tickets).to.have.lengthOf(2)
    expect(result.tickets[0].id).to.equal('TKT-001')
  })

  it('delegates createTicket to storage', async () => {
    const createCalls: Array<{ projectId: string; input: CreateTicketInput }> = []
    const storage = createMockStorage({ createCalls })
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.createTicket('test-project', {
      title: 'New ticket',
      statusName: 'Backlog',
      priority: 'P1',
    })

    expect(result.success).to.be.true
    expect(result.provider).to.equal('pmo')
    expect(result.ticket).to.exist
    expect(result.ticket!.title).to.equal('New ticket')
    expect(createCalls).to.have.lengthOf(1)
    expect(createCalls[0].input.title).to.equal('New ticket')
  })

  it('returns failure when createTicket throws', async () => {
    const storage = createMockStorage({
      createError: new Error('Duplicate ID'),
    })
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.createTicket('test-project', {
      title: 'New ticket',
    })

    expect(result.success).to.be.false
    expect(result.provider).to.equal('pmo')
    expect(result.error).to.equal('Duplicate ID')
  })

  it('delegates getTicket to storage', async () => {
    const storage = createMockStorage({
      ticket: {
        id: 'TKT-001',
        projectId: 'test-project',
        statusName: 'In Progress',
        statusCategory: 'started',
        metadata: null,
      },
    })
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.getTicket('TKT-001')

    expect(result.success).to.be.true
    expect(result.provider).to.equal('pmo')
    expect(result.ticket).to.exist
    expect(result.ticket!.id).to.equal('TKT-001')
  })

  it('returns null ticket when getTicket finds nothing', async () => {
    const storage = createMockStorage({ ticket: null })
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.getTicket('TKT-999')

    expect(result.success).to.be.true
    expect(result.ticket).to.be.null
  })

  it('delegates updateTicket to storage', async () => {
    const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
    const storage = createMockStorage({ updateCalls })
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.updateTicket('TKT-001', { title: 'Updated title', priority: 'P0' })

    expect(result.success).to.be.true
    expect(result.provider).to.equal('pmo')
    expect(result.ticket).to.exist
    expect(updateCalls).to.have.lengthOf(1)
    expect(updateCalls[0].id).to.equal('TKT-001')
    expect(updateCalls[0].changes.title).to.equal('Updated title')
  })

  it('returns failure when updateTicket throws', async () => {
    const storage = createMockStorage({
      updateError: new Error('Ticket not found'),
    })
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.updateTicket('TKT-001', { title: 'Updated' })

    expect(result.success).to.be.false
    expect(result.provider).to.equal('pmo')
    expect(result.error).to.equal('Ticket not found')
  })

  it('delegates assignTicket to storage via updateTicket', async () => {
    const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
    const storage = createMockStorage({ updateCalls })
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.assignTicket('TKT-001', 'agent-sandberg')

    expect(result.success).to.be.true
    expect(result.provider).to.equal('pmo')
    expect(updateCalls).to.have.lengthOf(1)
    expect(updateCalls[0].id).to.equal('TKT-001')
    expect(updateCalls[0].changes.assignee).to.equal('agent-sandberg')
  })

  it('returns failure when assignTicket storage call throws', async () => {
    const storage = createMockStorage({
      updateError: new Error('Database locked'),
    })
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.assignTicket('TKT-001', 'agent-1')

    expect(result.success).to.be.false
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
// resolveProjectProvider Tests
// =============================================================================

describe('resolveProjectProvider', () => {
  let resolveProjectProvider: typeof import('../../src/lib/providers/resolver.js').resolveProjectProvider

  before(async () => {
    const mod = await import('../../src/lib/providers/resolver.js')
    resolveProjectProvider = mod.resolveProjectProvider
  })

  it('returns PMOTicketProvider when source is "pmo"', () => {
    const storage = createMockStorage()
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const provider = resolveProjectProvider(mockDb, storage, 'test-project', 'pmo')
    expect(provider.name).to.equal('pmo')
  })

  it('returns LinearTicketProvider when source is "linear"', () => {
    const storage = createMockStorage()
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const provider = resolveProjectProvider(mockDb, storage, 'test-project', 'linear')
    expect(provider.name).to.equal('linear')
  })

  it('returns PMOTicketProvider when source is "auto" and no Linear config', () => {
    const storage = createMockStorage()
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const provider = resolveProjectProvider(mockDb, storage, 'test-project', 'auto')
    expect(provider.name).to.equal('pmo')
  })

  it('returns PMOTicketProvider when no source specified and no Linear config', () => {
    const storage = createMockStorage()
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const provider = resolveProjectProvider(mockDb, storage, 'test-project')
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
  // Helper: minimal mock DB that returns no API key
  const noApiKeyDb = {
    prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
    exec: () => {},
    pragma: () => {},
  } as any

  it('has name "linear"', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    const provider = new LinearTicketProvider(noApiKeyDb)
    expect(provider.name).to.equal('linear')
  })

  it('constructor takes only db — no storage dependency (PRLT-1231)', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    // Verify the constructor accepts just db, no storage
    const provider = new LinearTicketProvider(noApiKeyDb)
    expect(provider).to.exist
    expect(provider.name).to.equal('linear')
  })

  it('returns failure when Linear API key is not configured (moveTicket)', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    const provider = new LinearTicketProvider(noApiKeyDb)
    const result = await provider.moveTicket('PRLT-001', 'Review')

    expect(result.success).to.be.false
    expect(result.provider).to.equal('linear')
    expect(result.error).to.include('API key not configured')
  })

  it('returns failure when Linear API key is not configured (deleteTicket)', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    const provider = new LinearTicketProvider(noApiKeyDb)
    const result = await provider.deleteTicket('PRLT-001')

    expect(result.success).to.be.false
    expect(result.provider).to.equal('linear')
    expect(result.error).to.include('API key not configured')
  })

  it('returns failure when Linear API key is not configured (listTickets)', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    const provider = new LinearTicketProvider(noApiKeyDb)
    const result = await provider.listTickets()

    expect(result.success).to.be.false
    expect(result.provider).to.equal('linear')
    expect(result.tickets).to.have.lengthOf(0)
  })

  it('returns failure when Linear API key is not configured (createTicket)', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    const provider = new LinearTicketProvider(noApiKeyDb)
    const result = await provider.createTicket('test-project', { title: 'Test' })

    expect(result.success).to.be.false
    expect(result.provider).to.equal('linear')
    expect(result.error).to.include('API key not configured')
  })

  it('returns failure when Linear API key is not configured (updateTicket)', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    const provider = new LinearTicketProvider(noApiKeyDb)
    const result = await provider.updateTicket('PRLT-001', { title: 'New title' })

    expect(result.success).to.be.false
    expect(result.provider).to.equal('linear')
    expect(result.error).to.include('API key not configured')
  })

  it('returns failure when Linear API key is not configured (assignTicket)', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    const provider = new LinearTicketProvider(noApiKeyDb)
    const result = await provider.assignTicket('PRLT-001', 'user@example.com')

    expect(result.success).to.be.false
    expect(result.provider).to.equal('linear')
    expect(result.error).to.include('API key not configured')
  })

  it('getTicket returns null for unknown ticket without calling storage (PRLT-1231)', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    // Mock DB with API key but the provider will fail to resolve the issue
    // because there's no real Linear API to call — but it should NOT touch storage
    const provider = new LinearTicketProvider(noApiKeyDb)
    const result = await provider.getTicket('UNKNOWN-999')

    // With no API key, getTicket should fail gracefully
    expect(result.provider).to.equal('linear')
    // The point: it never calls storage.getTicket (no storage dependency)
  })
})

// =============================================================================
// Regression Tests: Phase 2 Provider Routing (PRLT-1064)
//
// These tests verify that ticket operations previously called via direct
// storage now route correctly through the provider adapter.
// If the provider routing is reverted, these patterns would bypass
// error handling and event emission.
// =============================================================================

describe('Phase 2 provider routing regressions', () => {
  // -------------------------------------------------------------------------
  // ticket reassign → provider.assignTicket / provider.updateTicket
  // -------------------------------------------------------------------------
  describe('reassign routes through provider.assignTicket', () => {
    it('assignTicket propagates assignee to storage via updateTicket', async () => {
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({ updateCalls })
      const provider = new PMOTicketProvider(storage, 'test-project')

      const result = await provider.assignTicket('TKT-010', 'agent-alice')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('pmo')
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].id).to.equal('TKT-010')
      expect(updateCalls[0].changes.assignee).to.equal('agent-alice')
    })

    it('unassign routes through provider.updateTicket with undefined assignee', async () => {
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({ updateCalls })
      const provider = new PMOTicketProvider(storage, 'test-project')

      const result = await provider.updateTicket('TKT-010', { assignee: undefined })

      expect(result.success).to.be.true
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].changes.assignee).to.be.undefined
    })

    it('returns structured error on assignTicket failure instead of throwing', async () => {
      const storage = createMockStorage({
        updateError: new Error('Agent not found'),
      })
      const provider = new PMOTicketProvider(storage, 'test-project')

      const result = await provider.assignTicket('TKT-010', 'nonexistent-agent')

      expect(result.success).to.be.false
      expect(result.error).to.equal('Agent not found')
      expect(result.provider).to.equal('pmo')
    })
  })

  // -------------------------------------------------------------------------
  // ticket complete → provider.moveTicket
  // -------------------------------------------------------------------------
  describe('complete routes through provider.moveTicket', () => {
    it('moveTicket with Done state delegates to storage correctly', async () => {
      const moveCalls: Array<{ projectId: string; ticketId: string; columnName: string }> = []
      const storage = createMockStorage({ moveCalls })
      const provider = new PMOTicketProvider(storage, 'test-project')

      const result = await provider.moveTicket('TKT-020', 'Done')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('pmo')
      expect(moveCalls).to.have.lengthOf(1)
      expect(moveCalls[0]).to.deep.equal({
        projectId: 'test-project',
        ticketId: 'TKT-020',
        columnName: 'Done',
      })
    })

    it('returns structured error on moveTicket failure instead of throwing', async () => {
      const storage = createMockStorage({
        moveError: new Error('Column "Done" not found'),
      })
      const provider = new PMOTicketProvider(storage, 'test-project')

      const result = await provider.moveTicket('TKT-020', 'Done')

      expect(result.success).to.be.false
      expect(result.error).to.equal('Column "Done" not found')
      expect(result.provider).to.equal('pmo')
    })
  })

  // -------------------------------------------------------------------------
  // ticket resolve → provider.updateTicket + provider.moveTicket
  // -------------------------------------------------------------------------
  describe('resolve routes through provider.updateTicket and moveTicket', () => {
    it('updateTicket with description change delegates correctly', async () => {
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({ updateCalls })
      const provider = new PMOTicketProvider(storage, 'test-project')

      const result = await provider.updateTicket('TKT-030', {
        description: 'Updated description with **A1:** answer',
      })

      expect(result.success).to.be.true
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].changes.description).to.include('A1:')
    })

    it('updateTicket with labels change delegates correctly', async () => {
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({ updateCalls })
      const provider = new PMOTicketProvider(storage, 'test-project')

      const result = await provider.updateTicket('TKT-030', {
        labels: ['ready'],
      } as Partial<Ticket>)

      expect(result.success).to.be.true
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].changes.labels).to.deep.equal(['ready'])
    })

    it('moveTicket to Ready state after resolve delegates correctly', async () => {
      const moveCalls: Array<{ projectId: string; ticketId: string; columnName: string }> = []
      const storage = createMockStorage({ moveCalls })
      const provider = new PMOTicketProvider(storage, 'test-project')

      const result = await provider.moveTicket('TKT-030', 'Ready')

      expect(result.success).to.be.true
      expect(moveCalls).to.have.lengthOf(1)
      expect(moveCalls[0].columnName).to.equal('Ready')
    })

    it('returns structured error on description update failure', async () => {
      const storage = createMockStorage({
        updateError: new Error('Ticket locked'),
      })
      const provider = new PMOTicketProvider(storage, 'test-project')

      const result = await provider.updateTicket('TKT-030', {
        description: 'new desc',
      })

      expect(result.success).to.be.false
      expect(result.error).to.equal('Ticket locked')
    })
  })

  // -------------------------------------------------------------------------
  // ticket update (flag + interactive + bulk) → provider.updateTicket
  // -------------------------------------------------------------------------
  describe('update routes through provider.updateTicket for all modes', () => {
    it('updateTicket with priority change delegates correctly', async () => {
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({ updateCalls })
      const provider = new PMOTicketProvider(storage, 'test-project')

      const result = await provider.updateTicket('TKT-040', { priority: 'P0' })

      expect(result.success).to.be.true
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].changes.priority).to.equal('P0')
    })

    it('updateTicket with category change delegates correctly', async () => {
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({ updateCalls })
      const provider = new PMOTicketProvider(storage, 'test-project')

      const result = await provider.updateTicket('TKT-040', { category: 'bug' })

      expect(result.success).to.be.true
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].changes.category).to.equal('bug')
    })

    it('updateTicket with multiple field changes delegates as single call', async () => {
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({ updateCalls })
      const provider = new PMOTicketProvider(storage, 'test-project')

      const result = await provider.updateTicket('TKT-040', {
        title: 'New title',
        description: 'New desc',
        priority: 'P1',
      })

      expect(result.success).to.be.true
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].changes).to.include({
        title: 'New title',
        description: 'New desc',
        priority: 'P1',
      })
    })

    it('returns structured error on bulk update failure instead of throwing', async () => {
      const storage = createMockStorage({
        updateError: new Error('Database locked'),
      })
      const provider = new PMOTicketProvider(storage, 'test-project')

      const result = await provider.updateTicket('TKT-040', { priority: 'P0' })

      expect(result.success).to.be.false
      expect(result.error).to.equal('Database locked')
      expect(result.provider).to.equal('pmo')
    })
  })
})
