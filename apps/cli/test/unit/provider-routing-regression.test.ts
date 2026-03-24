/**
 * Regression test: ticket commands must route through provider adapter
 *
 * PRLT-1064: Decouple runtime from local PMO — use external ID as primary key.
 * Phase 2: All ticket operations route through the provider adapter.
 *
 * These tests verify that the TicketProvider interface includes all 6 universal
 * operations and that commands cannot bypass the provider to access storage directly.
 * If the provider interface is reverted (removing updateTicket/assignTicket), these
 * tests will fail at compile time (TS) and at runtime (missing methods).
 */

import { expect } from 'chai'
import type { TicketProvider, ProviderStorage } from '../../src/lib/providers/types.js'
import type { Ticket, CreateTicketInput, UpdateTicketInput } from '../../src/lib/pmo/types.js'
import { PMOTicketProvider } from '../../src/lib/providers/pmo-provider.js'
import { TrelloTicketProvider } from '../../src/lib/providers/trello-provider.js'
import { EventEmittingProvider } from '../../src/lib/providers/event-emitting-provider.js'

// =============================================================================
// Helpers
// =============================================================================

function createMockStorage(): ProviderStorage {
  const calls: string[] = []
  return {
    getTicket: async (id) => {
      calls.push(`getTicket:${id}`)
      return {
        id, title: 'Test', statusId: 'backlog', statusName: 'Backlog',
        subtasks: [], labels: [], metadata: {}, createdAt: new Date(), updatedAt: new Date(),
      } as Ticket
    },
    getProjectBoard: async () => ({ columns: [{ name: 'Backlog' }] }),
    moveTicket: async (_p, id, col) => {
      calls.push(`moveTicket:${id}:${col}`)
      return { id, title: 'Test', statusId: col, statusName: col, subtasks: [], labels: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() } as Ticket
    },
    deleteTicket: async (id) => { calls.push(`deleteTicket:${id}`) },
    listTickets: async () => {
      calls.push('listTickets')
      return []
    },
    createTicket: async (_p, input) => {
      calls.push(`createTicket:${input.title}`)
      return { id: 'TKT-NEW', title: input.title, statusId: 'backlog', statusName: 'Backlog', subtasks: [], labels: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() } as Ticket
    },
    updateTicket: async (id, changes) => {
      calls.push(`updateTicket:${id}`)
      return { id, title: changes.title || 'Test', statusId: 'backlog', statusName: 'Backlog', subtasks: [], labels: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() } as Ticket
    },
    getDatabase: () => ({
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    }) as any,
    _calls: calls,
  } as ProviderStorage & { _calls: string[] }
}

// =============================================================================
// Regression: TicketProvider interface must include all 6 universal operations
// =============================================================================

describe('TicketProvider interface completeness (PRLT-1064 Phase 2)', () => {
  it('PMOTicketProvider implements all 6 universal operations', () => {
    const storage = createMockStorage()
    const provider: TicketProvider = new PMOTicketProvider(storage, 'test-project')

    // These would cause TypeScript compile errors if any method is missing
    expect(typeof provider.listTickets).to.equal('function')
    expect(typeof provider.getTicket).to.equal('function')
    expect(typeof provider.createTicket).to.equal('function')
    expect(typeof provider.updateTicket).to.equal('function')
    expect(typeof provider.moveTicket).to.equal('function')
    expect(typeof provider.assignTicket).to.equal('function')
  })

  it('TrelloTicketProvider implements all 6 universal operations', () => {
    const storage = createMockStorage()
    const mockDb = {
      prepare: () => ({ get: () => undefined, all: () => [], run: () => ({}) }),
      exec: () => {},
      pragma: () => {},
    } as any
    const provider: TicketProvider = new TrelloTicketProvider(mockDb, storage, 'test-project', null)

    expect(typeof provider.listTickets).to.equal('function')
    expect(typeof provider.getTicket).to.equal('function')
    expect(typeof provider.createTicket).to.equal('function')
    expect(typeof provider.updateTicket).to.equal('function')
    expect(typeof provider.moveTicket).to.equal('function')
    expect(typeof provider.assignTicket).to.equal('function')
  })

  it('EventEmittingProvider delegates all 6 operations', () => {
    const storage = createMockStorage()
    const inner = new PMOTicketProvider(storage, 'test-project')
    const provider: TicketProvider = new EventEmittingProvider(inner, null, 'test-project')

    expect(typeof provider.listTickets).to.equal('function')
    expect(typeof provider.getTicket).to.equal('function')
    expect(typeof provider.createTicket).to.equal('function')
    expect(typeof provider.updateTicket).to.equal('function')
    expect(typeof provider.moveTicket).to.equal('function')
    expect(typeof provider.assignTicket).to.equal('function')
  })
})

// =============================================================================
// Regression: updateTicket routes through provider, not storage directly
// =============================================================================

describe('updateTicket routes through provider (PRLT-1064 regression)', () => {
  it('PMOTicketProvider.updateTicket calls storage.updateTicket and returns result', async () => {
    const storage = createMockStorage()
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.updateTicket('TKT-001', { title: 'New title' })

    expect(result.success).to.be.true
    expect(result.provider).to.equal('pmo')
    expect(result.ticket).to.exist
    expect(result.ticket!.id).to.equal('TKT-001')
    expect((storage as any)._calls).to.include('updateTicket:TKT-001')
  })

  it('EventEmittingProvider.updateTicket delegates to inner provider', async () => {
    const storage = createMockStorage()
    const inner = new PMOTicketProvider(storage, 'test-project')
    const provider = new EventEmittingProvider(inner, null, 'test-project')

    const result = await provider.updateTicket('TKT-001', { title: 'New title' })

    expect(result.success).to.be.true
    expect((storage as any)._calls).to.include('updateTicket:TKT-001')
  })
})

// =============================================================================
// Regression: assignTicket routes through provider, not storage directly
// =============================================================================

describe('assignTicket routes through provider (PRLT-1064 regression)', () => {
  it('PMOTicketProvider.assignTicket calls storage.updateTicket with assignee', async () => {
    const storage = createMockStorage()
    const provider = new PMOTicketProvider(storage, 'test-project')

    const result = await provider.assignTicket('TKT-001', 'agent-sandberg')

    expect(result.success).to.be.true
    expect(result.provider).to.equal('pmo')
    expect((storage as any)._calls).to.include('updateTicket:TKT-001')
  })

  it('EventEmittingProvider.assignTicket delegates to inner provider', async () => {
    const storage = createMockStorage()
    const inner = new PMOTicketProvider(storage, 'test-project')
    const provider = new EventEmittingProvider(inner, null, 'test-project')

    const result = await provider.assignTicket('TKT-001', 'agent-sandberg')

    expect(result.success).to.be.true
    expect((storage as any)._calls).to.include('updateTicket:TKT-001')
  })
})

// =============================================================================
// Regression: ProviderStorage must include updateTicket
// =============================================================================

describe('ProviderStorage interface includes updateTicket (PRLT-1064 regression)', () => {
  it('mock storage satisfies ProviderStorage with updateTicket', () => {
    const storage: ProviderStorage = createMockStorage()
    // This would fail to compile if updateTicket is removed from ProviderStorage
    expect(typeof storage.updateTicket).to.equal('function')
  })
})
