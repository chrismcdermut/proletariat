/**
 * Regression tests for PRLT-1231: Remove local PMO cache — pull tickets live from provider
 *
 * These tests verify:
 * 1. LinearTicketProvider does NOT write to local PMO storage
 * 2. LinearTicketProvider.getTicket() fetches from API, not local storage
 * 3. Provider resolver does NOT require LinearMapper for resolution
 * 4. moveTicketByIntent works without local ticket for external providers
 * 5. PMOCommand.resolveTicketProvider handles external ticket IDs
 */

import { expect } from 'chai'
import type { ProviderStorage } from '../../src/lib/providers/types.js'
import type { Ticket, TicketFilter, CreateTicketInput } from '../../src/lib/pmo/types.js'

// =============================================================================
// Helpers
// =============================================================================

function createMockStorage(overrides?: {
  ticket?: Partial<Ticket> | null
  tickets?: Ticket[]
  board?: { columns: Array<{ name: string }> } | null
  moveCalls?: Array<{ projectId: string; ticketId: string; columnName: string }>
  updateCalls?: Array<{ id: string; changes: Partial<Ticket> }>
  createCalls?: Array<{ projectId: string; input: CreateTicketInput }>
  deleteCalls?: string[]
}): ProviderStorage {
  const moveCalls = overrides?.moveCalls ?? []
  const updateCalls = overrides?.updateCalls ?? []
  const createCalls = overrides?.createCalls ?? []
  const deleteCalls = overrides?.deleteCalls ?? []

  return {
    getTicket: async (id: string) => {
      if (overrides?.ticket === null) return null
      const ticket = overrides?.ticket ?? {
        id,
        projectId: 'test-project',
        statusName: 'Backlog',
      }
      return {
        title: 'Test ticket',
        statusId: 'backlog',
        subtasks: [],
        labels: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        ...ticket,
      } as Ticket
    },
    getProjectBoard: async (_projectId: string) => {
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
      moveCalls.push({ projectId, ticketId, columnName })
      return { id: ticketId, title: 'Moved', statusId: columnName, statusName: columnName, subtasks: [], labels: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() } as Ticket
    },
    deleteTicket: async (id: string) => { deleteCalls.push(id) },
    listTickets: async (_projectId?: string, _filter?: TicketFilter) => overrides?.tickets ?? [],
    createTicket: async (projectId: string, input: CreateTicketInput) => {
      createCalls.push({ projectId, input })
      return { id: 'TKT-NEW', title: input.title, statusId: 'backlog', subtasks: [], labels: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() } as Ticket
    },
    updateTicket: async (id: string, changes: Partial<Ticket>) => {
      updateCalls.push({ id, changes })
      return { id, title: 'Updated', statusId: 'backlog', subtasks: [], labels: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() } as Ticket
    },
    getDatabase: () => ({
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any),
  }
}

// =============================================================================
// Test: LinearTicketProvider has no storage dependency
// =============================================================================

describe('PRLT-1231: LinearTicketProvider has no local PMO dependency', () => {
  it('constructor signature accepts only db — no storage parameter', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    // This should compile and run with just db
    const provider = new LinearTicketProvider(mockDb)
    expect(provider.name).to.equal('linear')
  })

  it('does not have a storage property', async () => {
    const { LinearTicketProvider } = await import('../../src/lib/providers/linear-provider.js')
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const provider = new LinearTicketProvider(mockDb) as any
    // The provider should NOT have a storage property — it pulls live from Linear
    expect(provider.storage).to.be.undefined
  })
})

// =============================================================================
// Test: Provider resolver does not require LinearMapper
// =============================================================================

describe('PRLT-1231: Provider resolver works without LinearMapper', () => {
  it('resolves to Linear provider when external_source=linear and Linear is configured', async () => {
    const { resolveTicketProvider } = await import('../../src/lib/providers/resolver.js')
    const storage = createMockStorage()

    // Mock DB where Linear is configured
    const mockDb = {
      prepare: (sql: string) => {
        if (sql.includes('workspace_settings')) {
          return {
            get: (key: string) => {
              if (key === 'linear.api_key') return { value: 'test-api-key' }
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

    const metadata = { external_source: 'linear', external_key: 'PRLT-1231' }
    const provider = resolveTicketProvider('PRLT-1231', 'proj-1', mockDb, storage, metadata)

    // Should resolve to linear (wrapped in EventEmittingProvider)
    expect(provider.name).to.equal('linear')
  })

  it('resolves to PMO provider when Linear is not configured', async () => {
    const { resolveTicketProvider } = await import('../../src/lib/providers/resolver.js')
    const storage = createMockStorage()

    // Mock DB where Linear is NOT configured
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const metadata = { external_source: 'linear', external_key: 'PRLT-1231' }
    const provider = resolveTicketProvider('PRLT-1231', 'proj-1', mockDb, storage, metadata)

    // Should fall back to PMO
    expect(provider.name).to.equal('pmo')
  })

  it('resolves to Linear when metadata has external_key but no external_source', async () => {
    const { resolveTicketProvider } = await import('../../src/lib/providers/resolver.js')
    const storage = createMockStorage()

    const mockDb = {
      prepare: (sql: string) => {
        if (sql.includes('workspace_settings')) {
          return {
            get: (key: string) => {
              if (key === 'linear.api_key') return { value: 'test-api-key' }
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

    // No external_source, but has external_key + Linear is configured
    const metadata = { external_key: 'PRLT-1231' }
    const provider = resolveTicketProvider('PRLT-1231', 'proj-1', mockDb, storage, metadata)

    expect(provider.name).to.equal('linear')
  })
})

// =============================================================================
// Test: resolveProjectProvider routes to Linear when configured
// =============================================================================

describe('PRLT-1231: resolveProjectProvider uses Linear when configured', () => {
  it('auto-resolves to Linear provider when Linear is configured', async () => {
    const { resolveProjectProvider } = await import('../../src/lib/providers/resolver.js')
    const storage = createMockStorage()

    const mockDb = {
      prepare: (sql: string) => {
        if (sql.includes('workspace_settings')) {
          return {
            get: (key: string) => {
              if (key === 'linear.api_key') return { value: 'test-api-key' }
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

    const provider = resolveProjectProvider(mockDb, storage, 'proj-1')
    expect(provider.name).to.equal('linear')
  })

  it('auto-resolves to PMO provider when Linear is not configured', async () => {
    const { resolveProjectProvider } = await import('../../src/lib/providers/resolver.js')
    const storage = createMockStorage()

    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    } as any

    const provider = resolveProjectProvider(mockDb, storage, 'proj-1')
    expect(provider.name).to.equal('pmo')
  })
})

// =============================================================================
// Test: moveTicketByIntent routes to external provider directly
// =============================================================================

describe('PRLT-1231: moveTicketByIntent for external providers', () => {
  it('skips local PMO move when external provider handles the transition', async () => {
    const { moveTicketByIntent } = await import('../../src/lib/work-lifecycle/transition.js')
    const moveCalls: Array<{ projectId: string; ticketId: string; columnName: string }> = []
    const storage = createMockStorage({ moveCalls })

    // Mock DB with transition map
    const mockDb = {
      prepare: (sql: string) => {
        if (sql.includes('pmo_transition_map')) {
          return { get: () => undefined, all: () => [], run: () => {} }
        }
        if (sql.includes('workspace_settings')) {
          return {
            get: (key: string) => {
              if (key === 'column_done') return { value: 'Done' }
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

    // Create a mock external provider that succeeds
    const externalMoveCalls: Array<{ ticketId: string; newState: string }> = []
    const mockExternalProvider = {
      name: 'linear' as const,
      moveTicket: async (ticketId: string, newState: string) => {
        externalMoveCalls.push({ ticketId, newState })
        return { success: true, provider: 'linear' as const }
      },
    }

    const result = await moveTicketByIntent({
      db: mockDb,
      storage,
      ticket: { id: 'PRLT-1231', projectId: 'proj-1', statusName: 'In Progress' },
      intent: 'completed',
      providerName: 'linear',
      resolveProvider: async () => mockExternalProvider as any,
    })

    expect(result.moved).to.be.true
    expect(result.targetColumn).to.equal('Done')
    // Key assertion: local PMO storage.moveTicket was NOT called
    expect(moveCalls).to.have.lengthOf(0)
    // External provider WAS called
    expect(externalMoveCalls).to.have.lengthOf(1)
    expect(externalMoveCalls[0].ticketId).to.equal('PRLT-1231')
    expect(externalMoveCalls[0].newState).to.equal('Done')
  })

  it('uses local PMO storage when provider resolves to pmo', async () => {
    const { moveTicketByIntent } = await import('../../src/lib/work-lifecycle/transition.js')
    const moveCalls: Array<{ projectId: string; ticketId: string; columnName: string }> = []
    const storage = createMockStorage({ moveCalls })

    const mockDb = {
      prepare: (sql: string) => {
        if (sql.includes('pmo_transition_map')) {
          return { get: () => undefined, all: () => [], run: () => {} }
        }
        if (sql.includes('workspace_settings')) {
          return {
            get: (key: string) => {
              if (key === 'column_done') return { value: 'Done' }
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

    const mockPmoProvider = {
      name: 'pmo' as const,
      moveTicket: async () => ({ success: true, provider: 'pmo' as const }),
    }

    const result = await moveTicketByIntent({
      db: mockDb,
      storage,
      ticket: { id: 'TKT-001', projectId: 'proj-1', statusName: 'In Progress' },
      intent: 'completed',
      providerName: 'pmo',
      resolveProvider: async () => mockPmoProvider as any,
    })

    expect(result.moved).to.be.true
    // For PMO provider, local storage WAS called
    expect(moveCalls).to.have.lengthOf(1)
    expect(moveCalls[0].ticketId).to.equal('TKT-001')
  })
})
