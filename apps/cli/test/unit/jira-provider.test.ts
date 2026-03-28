import { expect } from 'chai'
import type { ProviderStorage } from '../../src/lib/providers/types.js'
import type { StateCategory, Ticket, TicketFilter, CreateTicketInput } from '../../src/lib/pmo/types.js'
import { JiraTicketProvider } from '../../src/lib/providers/jira-provider.js'
import {
  PMO_PRIORITY_TO_JIRA,
  JIRA_PRIORITY_TO_PMO,
  JIRA_STATUS_CATEGORY_TO_PMO,
} from '../../src/lib/jira/types.js'

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
          'jira.issue_key': 'PROJ-123',
          'jira.issue_id': '10001',
          'jira.project_key': 'PROJ',
          'jira.status': 'In Progress',
          external_source: 'jira',
          external_id: '10001',
          external_key: 'PROJ-123',
          external_url: 'https://acme.atlassian.net/browse/PROJ-123',
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
// Jira Type Tests
// =============================================================================

describe('Jira Types', () => {
  describe('PMO_PRIORITY_TO_JIRA', () => {
    it('maps P0 to Highest', () => {
      expect(PMO_PRIORITY_TO_JIRA.P0).to.equal('Highest')
    })

    it('maps P1 to High', () => {
      expect(PMO_PRIORITY_TO_JIRA.P1).to.equal('High')
    })

    it('maps P2 to Medium', () => {
      expect(PMO_PRIORITY_TO_JIRA.P2).to.equal('Medium')
    })

    it('maps P3 to Low', () => {
      expect(PMO_PRIORITY_TO_JIRA.P3).to.equal('Low')
    })
  })

  describe('JIRA_PRIORITY_TO_PMO', () => {
    it('maps Highest to P0', () => {
      expect(JIRA_PRIORITY_TO_PMO.Highest).to.equal('P0')
    })

    it('maps High to P1', () => {
      expect(JIRA_PRIORITY_TO_PMO.High).to.equal('P1')
    })

    it('maps Medium to P2', () => {
      expect(JIRA_PRIORITY_TO_PMO.Medium).to.equal('P2')
    })

    it('maps Low to P3', () => {
      expect(JIRA_PRIORITY_TO_PMO.Low).to.equal('P3')
    })

    it('maps Blocker to P0', () => {
      expect(JIRA_PRIORITY_TO_PMO.Blocker).to.equal('P0')
    })

    it('maps Trivial to P3', () => {
      expect(JIRA_PRIORITY_TO_PMO.Trivial).to.equal('P3')
    })
  })

  describe('JIRA_STATUS_CATEGORY_TO_PMO', () => {
    it('maps new to unstarted', () => {
      expect(JIRA_STATUS_CATEGORY_TO_PMO.new).to.equal('unstarted')
    })

    it('maps indeterminate to started', () => {
      expect(JIRA_STATUS_CATEGORY_TO_PMO.indeterminate).to.equal('started')
    })

    it('maps done to completed', () => {
      expect(JIRA_STATUS_CATEGORY_TO_PMO.done).to.equal('completed')
    })
  })
})

// =============================================================================
// JiraTicketProvider Tests
// =============================================================================

describe('JiraTicketProvider', () => {
  it('has name property set to jira', () => {
    const db = createMockDb()
    const storage = createMockStorage()
    const provider = new JiraTicketProvider(db, storage, 'test-project')

    expect(provider.name).to.equal('jira')
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
            'jira.issue_key': 'PROJ-123',
            'jira.issue_id': '10001',
            external_source: 'jira',
            external_id: '10001',
            external_key: 'PROJ-123',
            external_url: 'https://acme.atlassian.net/browse/PROJ-123',
          },
        },
      })
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.getTicket('TKT-001')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('jira')
      expect(result.ticket).to.not.be.null
      expect(result.ticket?.id).to.equal('TKT-001')
    })

    it('returns null ticket when not found', async () => {
      const db = createMockDb()
      const storage = createMockStorage({ ticket: null })
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.getTicket('TKT-MISSING')

      expect(result.success).to.be.true
      expect(result.ticket).to.be.null
    })
  })

  describe('moveTicket', () => {
    it('returns error when Jira is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.moveTicket('TKT-001', 'Done')

      expect(result.success).to.be.false
      expect(result.provider).to.equal('jira')
      expect(result.error).to.include('not configured')
    })

    it('returns error when ticket is not found', async () => {
      const db = createMockDb({
        'jira.base_url': 'https://acme.atlassian.net',
        'jira.api_token': 'tok_123',
      })
      const storage = createMockStorage({ ticket: null })
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.moveTicket('TKT-MISSING', 'Done')

      expect(result.success).to.be.false
      expect(result.error).to.include('not found')
    })

    it('returns error when ticket has no Jira mapping', async () => {
      const db = createMockDb({
        'jira.base_url': 'https://acme.atlassian.net',
        'jira.api_token': 'tok_123',
      })
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'In Progress',
          metadata: {},  // no jira.issue_key
        },
      })
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.moveTicket('TKT-001', 'Done')

      expect(result.success).to.be.false
      expect(result.error).to.include('No Jira mapping')
    })
  })

  describe('deleteTicket', () => {
    it('returns error when Jira is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.deleteTicket('TKT-001')

      expect(result.success).to.be.false
      expect(result.error).to.include('not configured')
    })

    it('deletes local PMO ticket when no Jira mapping exists', async () => {
      const db = createMockDb({
        'jira.base_url': 'https://acme.atlassian.net',
        'jira.api_token': 'tok_123',
      })
      const deleteCalls: string[] = []
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'Backlog',
          metadata: {},  // no jira.issue_key
        },
        deleteCalls,
      })
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.deleteTicket('TKT-001')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('jira')
      expect(deleteCalls).to.deep.equal(['TKT-001'])
    })
  })

  describe('listTickets', () => {
    it('returns error when Jira is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.listTickets()

      expect(result.success).to.be.false
      expect(result.tickets).to.deep.equal([])
      expect(result.error).to.include('not configured')
    })

    it('returns error when no project key is configured', async () => {
      const db = createMockDb({
        'jira.base_url': 'https://acme.atlassian.net',
        'jira.api_token': 'tok_123',
      })
      const storage = createMockStorage()
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.listTickets()

      expect(result.success).to.be.false
      expect(result.tickets).to.deep.equal([])
      expect(result.error).to.include('project key is required')
    })
  })

  describe('createTicket', () => {
    it('returns error when Jira is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.createTicket('test-project', {
        title: 'New issue',
      })

      expect(result.success).to.be.false
      expect(result.error).to.include('not configured')
    })

    it('returns error when no project key is configured', async () => {
      const db = createMockDb({
        'jira.base_url': 'https://acme.atlassian.net',
        'jira.api_token': 'tok_123',
      })
      const storage = createMockStorage()
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.createTicket('test-project', {
        title: 'New issue',
      })

      expect(result.success).to.be.false
      expect(result.error).to.include('project key is required')
    })
  })

  describe('updateTicket', () => {
    it('returns error when Jira is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.updateTicket('TKT-001', { title: 'Updated' })

      expect(result.success).to.be.false
      expect(result.error).to.include('not configured')
    })

    it('updates local PMO even when no Jira mapping exists', async () => {
      const db = createMockDb({
        'jira.base_url': 'https://acme.atlassian.net',
        'jira.api_token': 'tok_123',
      })
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'In Progress',
          metadata: {},  // no jira.issue_key
        },
        updateCalls,
      })
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.updateTicket('TKT-001', { title: 'Updated title' })

      expect(result.success).to.be.true
      expect(result.provider).to.equal('jira')
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].id).to.equal('TKT-001')
    })
  })

  describe('assignTicket', () => {
    it('returns error when Jira is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.assignTicket('TKT-001', 'user@example.com')

      expect(result.success).to.be.false
      expect(result.error).to.include('not configured')
    })

    it('updates local PMO assignee', async () => {
      const db = createMockDb({
        'jira.base_url': 'https://acme.atlassian.net',
        'jira.api_token': 'tok_123',
      })
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'In Progress',
          metadata: {},  // no jira.issue_key — skip Jira API call
        },
        updateCalls,
      })
      const provider = new JiraTicketProvider(db, storage, 'test-project')

      const result = await provider.assignTicket('TKT-001', 'agent-123')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('jira')
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].changes).to.deep.include({ assignee: 'agent-123' })
    })
  })
})
