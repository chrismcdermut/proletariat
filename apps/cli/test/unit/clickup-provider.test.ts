import { expect } from 'chai'
import type { ProviderStorage } from '../../src/lib/providers/types.js'
import type { StateCategory, Ticket, TicketFilter, CreateTicketInput } from '../../src/lib/pmo/types.js'
import { ClickUpTicketProvider } from '../../src/lib/providers/clickup-provider.js'
import {
  CLICKUP_PRIORITY_TO_PMO,
  PMO_PRIORITY_TO_CLICKUP,
  CLICKUP_STATUS_TYPE_TO_PMO_CATEGORY,
} from '../../src/lib/clickup/types.js'

// =============================================================================
// Test Helpers
// =============================================================================

interface MockTicket {
  id: string
  projectId?: string
  title?: string
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
        title: 'Test ticket',
        statusName: 'In Progress',
        statusCategory: 'started' as StateCategory,
        metadata: {
          'clickup.task_id': 'cu_task_123',
          external_source: 'clickup',
          external_id: 'cu_task_123',
          external_key: 'cu_task_123',
          external_url: 'https://app.clickup.com/t/cu_task_123',
        },
      }
      return {
        ...ticket,
        title: ticket.title || 'Test ticket',
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
    listTickets: async (_projectId: string | undefined, _filter?: TicketFilter) => {
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
        statusId: (ticket as MockTicket).statusName || 'backlog',
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

function createMockDb(settings?: Record<string, string>): any {
  const settingsMap = new Map(Object.entries(settings ?? {}))
  return {
    prepare: (sql: string) => ({
      get: (...args: unknown[]) => {
        // Simulate workspace_settings lookup
        if (sql.includes('workspace_settings')) {
          const key = args[0] as string
          const value = settingsMap.get(key)
          return value ? { value } : undefined
        }
        // Simulate credentials lookup
        if (sql.includes('credentials')) {
          const key = args[0] as string
          const value = settingsMap.get(key)
          return value ? { value } : undefined
        }
        return undefined
      },
      all: () => [],
      run: () => {},
    }),
    exec: () => {},
    pragma: () => {},
    name: '',  // empty name triggers in-memory path in credential store
  }
}

// =============================================================================
// ClickUp Type Tests
// =============================================================================

describe('ClickUp Types', () => {
  describe('CLICKUP_PRIORITY_TO_PMO', () => {
    it('maps ClickUp priority 1 (urgent) to P0', () => {
      expect(CLICKUP_PRIORITY_TO_PMO['1']).to.equal('P0')
    })

    it('maps ClickUp priority 2 (high) to P1', () => {
      expect(CLICKUP_PRIORITY_TO_PMO['2']).to.equal('P1')
    })

    it('maps ClickUp priority 3 (normal) to P2', () => {
      expect(CLICKUP_PRIORITY_TO_PMO['3']).to.equal('P2')
    })

    it('maps ClickUp priority 4 (low) to P3', () => {
      expect(CLICKUP_PRIORITY_TO_PMO['4']).to.equal('P3')
    })
  })

  describe('PMO_PRIORITY_TO_CLICKUP', () => {
    it('maps P0 to ClickUp 1 (urgent)', () => {
      expect(PMO_PRIORITY_TO_CLICKUP.P0).to.equal(1)
    })

    it('maps P1 to ClickUp 2 (high)', () => {
      expect(PMO_PRIORITY_TO_CLICKUP.P1).to.equal(2)
    })

    it('maps P2 to ClickUp 3 (normal)', () => {
      expect(PMO_PRIORITY_TO_CLICKUP.P2).to.equal(3)
    })

    it('maps P3 to ClickUp 4 (low)', () => {
      expect(PMO_PRIORITY_TO_CLICKUP.P3).to.equal(4)
    })
  })

  describe('CLICKUP_STATUS_TYPE_TO_PMO_CATEGORY', () => {
    it('maps open to unstarted', () => {
      expect(CLICKUP_STATUS_TYPE_TO_PMO_CATEGORY.open).to.equal('unstarted')
    })

    it('maps custom to started', () => {
      expect(CLICKUP_STATUS_TYPE_TO_PMO_CATEGORY.custom).to.equal('started')
    })

    it('maps closed to completed', () => {
      expect(CLICKUP_STATUS_TYPE_TO_PMO_CATEGORY.closed).to.equal('completed')
    })
  })
})

// =============================================================================
// ClickUpTicketProvider Tests
// =============================================================================

describe('ClickUpTicketProvider', () => {
  it('has name property set to clickup', () => {
    const db = createMockDb()
    const storage = createMockStorage()
    const provider = new ClickUpTicketProvider(db, storage, 'test-project')

    expect(provider.name).to.equal('clickup')
  })

  describe('getTicket', () => {
    it('returns ticket from local storage', async () => {
      const db = createMockDb()
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          title: 'Test task',
          projectId: 'test-project',
          statusName: 'In Progress',
          metadata: {
            'clickup.task_id': 'cu_123',
            external_source: 'clickup',
            external_id: 'cu_123',
            external_key: 'cu_123',
            external_url: 'https://app.clickup.com/t/cu_123',
          },
        },
      })
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.getTicket('TKT-001')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('clickup')
      expect(result.ticket).to.not.be.null
      expect(result.ticket?.id).to.equal('TKT-001')
    })

    it('returns null ticket when not found', async () => {
      const db = createMockDb()
      const storage = createMockStorage({ ticket: null })
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.getTicket('TKT-MISSING')

      expect(result.success).to.be.true
      expect(result.ticket).to.be.null
    })
  })

  describe('moveTicket', () => {
    it('returns error when API key is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.moveTicket('TKT-001', 'Done')

      expect(result.success).to.be.false
      expect(result.provider).to.equal('clickup')
      expect(result.error).to.include('API key not configured')
    })

    it('returns error when ticket is not found', async () => {
      const db = createMockDb({ 'clickup.api_key': 'pk_test_123' })
      const storage = createMockStorage({ ticket: null })
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.moveTicket('TKT-MISSING', 'Done')

      expect(result.success).to.be.false
      expect(result.error).to.include('not found')
    })

    it('returns error when ticket has no ClickUp mapping', async () => {
      const db = createMockDb({ 'clickup.api_key': 'pk_test_123' })
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'In Progress',
          metadata: {},  // no clickup.task_id
        },
      })
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.moveTicket('TKT-001', 'Done')

      expect(result.success).to.be.false
      expect(result.error).to.include('No ClickUp mapping')
    })
  })

  describe('deleteTicket', () => {
    it('returns error when API key is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.deleteTicket('TKT-001')

      expect(result.success).to.be.false
      expect(result.error).to.include('API key not configured')
    })

    it('deletes local PMO ticket when no ClickUp mapping exists', async () => {
      const db = createMockDb({ 'clickup.api_key': 'pk_test_123' })
      const deleteCalls: string[] = []
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'Backlog',
          metadata: {},  // no clickup.task_id
        },
        deleteCalls,
      })
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.deleteTicket('TKT-001')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('clickup')
      expect(deleteCalls).to.deep.equal(['TKT-001'])
    })
  })

  describe('listTickets', () => {
    it('returns error when API key is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.listTickets()

      expect(result.success).to.be.false
      expect(result.tickets).to.deep.equal([])
      expect(result.error).to.include('API key not configured')
    })

    it('returns error when no list ID is configured', async () => {
      const db = createMockDb({ 'clickup.api_key': 'pk_test_123' })
      const storage = createMockStorage()
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.listTickets()

      expect(result.success).to.be.false
      expect(result.tickets).to.deep.equal([])
      expect(result.error).to.include('list ID is required')
    })
  })

  describe('createTicket', () => {
    it('returns error when API key is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.createTicket('test-project', {
        title: 'New task',
      })

      expect(result.success).to.be.false
      expect(result.error).to.include('API key not configured')
    })

    it('returns error when no list ID is configured', async () => {
      const db = createMockDb({ 'clickup.api_key': 'pk_test_123' })
      const storage = createMockStorage()
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.createTicket('test-project', {
        title: 'New task',
      })

      expect(result.success).to.be.false
      expect(result.error).to.include('list ID is required')
    })
  })

  describe('updateTicket', () => {
    it('returns error when API key is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.updateTicket('TKT-001', { title: 'Updated' })

      expect(result.success).to.be.false
      expect(result.error).to.include('API key not configured')
    })

    it('updates local PMO even when no ClickUp mapping exists', async () => {
      const db = createMockDb({ 'clickup.api_key': 'pk_test_123' })
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'In Progress',
          metadata: {},  // no clickup.task_id
        },
        updateCalls,
      })
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.updateTicket('TKT-001', { title: 'Updated title' })

      expect(result.success).to.be.true
      expect(result.provider).to.equal('clickup')
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].id).to.equal('TKT-001')
    })
  })

  describe('assignTicket', () => {
    it('returns error when API key is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.assignTicket('TKT-001', 'user@example.com')

      expect(result.success).to.be.false
      expect(result.error).to.include('API key not configured')
    })

    it('updates local PMO assignee', async () => {
      const db = createMockDb({ 'clickup.api_key': 'pk_test_123' })
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'In Progress',
          metadata: {},  // no clickup.task_id — skip ClickUp API call
        },
        updateCalls,
      })
      const provider = new ClickUpTicketProvider(db, storage, 'test-project')

      const result = await provider.assignTicket('TKT-001', 'agent-123')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('clickup')
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].changes).to.deep.include({ assignee: 'agent-123' })
    })
  })
})
