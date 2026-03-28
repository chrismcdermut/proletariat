import { expect } from 'chai'
import type { ProviderStorage } from '../../src/lib/providers/types.js'
import type { StateCategory, Ticket, TicketFilter, CreateTicketInput } from '../../src/lib/pmo/types.js'
import { GitHubIssuesTicketProvider } from '../../src/lib/providers/github-provider.js'
import {
  GITHUB_LABEL_TO_PMO_CATEGORY,
  GITHUB_PRIORITY_LABELS,
  PMO_PRIORITY_TO_GITHUB_LABEL,
} from '../../src/lib/github/types.js'

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
          'github.issue_number': '42',
          'github.owner': 'testowner',
          'github.repo': 'testrepo',
          external_source: 'github',
          external_id: '12345',
          external_key: 'testowner/testrepo#42',
          external_url: 'https://github.com/testowner/testrepo/issues/42',
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
// GitHub Types Tests
// =============================================================================

describe('GitHub Types', () => {
  describe('GITHUB_LABEL_TO_PMO_CATEGORY', () => {
    it('maps "in progress" to started', () => {
      expect(GITHUB_LABEL_TO_PMO_CATEGORY['in progress']).to.equal('started')
    })

    it('maps "todo" to unstarted', () => {
      expect(GITHUB_LABEL_TO_PMO_CATEGORY['todo']).to.equal('unstarted')
    })

    it('maps "backlog" to backlog', () => {
      expect(GITHUB_LABEL_TO_PMO_CATEGORY['backlog']).to.equal('backlog')
    })

    it('maps "done" to completed', () => {
      expect(GITHUB_LABEL_TO_PMO_CATEGORY['done']).to.equal('completed')
    })

    it('maps "wontfix" to canceled', () => {
      expect(GITHUB_LABEL_TO_PMO_CATEGORY['wontfix']).to.equal('canceled')
    })

    it('maps "review" to started', () => {
      expect(GITHUB_LABEL_TO_PMO_CATEGORY['review']).to.equal('started')
    })
  })

  describe('GITHUB_PRIORITY_LABELS', () => {
    it('maps "priority: critical" to P0', () => {
      expect(GITHUB_PRIORITY_LABELS['priority: critical']).to.equal('P0')
    })

    it('maps "priority: high" to P1', () => {
      expect(GITHUB_PRIORITY_LABELS['priority: high']).to.equal('P1')
    })

    it('maps "priority: medium" to P2', () => {
      expect(GITHUB_PRIORITY_LABELS['priority: medium']).to.equal('P2')
    })

    it('maps "priority: low" to P3', () => {
      expect(GITHUB_PRIORITY_LABELS['priority: low']).to.equal('P3')
    })

    it('maps shorthand "P0" to P0', () => {
      expect(GITHUB_PRIORITY_LABELS['P0']).to.equal('P0')
    })
  })

  describe('PMO_PRIORITY_TO_GITHUB_LABEL', () => {
    it('maps P0 to "priority: critical"', () => {
      expect(PMO_PRIORITY_TO_GITHUB_LABEL.P0).to.equal('priority: critical')
    })

    it('maps P1 to "priority: high"', () => {
      expect(PMO_PRIORITY_TO_GITHUB_LABEL.P1).to.equal('priority: high')
    })

    it('maps P2 to "priority: medium"', () => {
      expect(PMO_PRIORITY_TO_GITHUB_LABEL.P2).to.equal('priority: medium')
    })

    it('maps P3 to "priority: low"', () => {
      expect(PMO_PRIORITY_TO_GITHUB_LABEL.P3).to.equal('priority: low')
    })
  })
})

// =============================================================================
// GitHubIssuesTicketProvider Tests
// =============================================================================

describe('GitHubIssuesTicketProvider', () => {
  it('has name property set to github', () => {
    const db = createMockDb()
    const storage = createMockStorage()
    const provider = new GitHubIssuesTicketProvider(db, storage, 'test-project')

    expect(provider.name).to.equal('github')
  })

  describe('getTicket', () => {
    it('returns ticket from local storage', async () => {
      const db = createMockDb()
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          title: 'Test issue',
          projectId: 'test-project',
          statusName: 'In Progress',
          metadata: {
            'github.issue_number': '42',
            external_source: 'github',
            external_id: '12345',
            external_key: 'testowner/testrepo#42',
            external_url: 'https://github.com/testowner/testrepo/issues/42',
          },
        },
      })
      const provider = new GitHubIssuesTicketProvider(db, storage, 'test-project')

      const result = await provider.getTicket('TKT-001')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('github')
      expect(result.ticket).to.not.be.null
      expect(result.ticket?.id).to.equal('TKT-001')
    })

    it('returns null ticket when not found', async () => {
      const db = createMockDb()
      const storage = createMockStorage({ ticket: null })
      const provider = new GitHubIssuesTicketProvider(db, storage, 'test-project')

      const result = await provider.getTicket('TKT-MISSING')

      expect(result.success).to.be.true
      expect(result.ticket).to.be.null
    })
  })

  describe('moveTicket', () => {
    it('returns error when not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new GitHubIssuesTicketProvider(db, storage, 'test-project')

      const result = await provider.moveTicket('TKT-001', 'Done')

      expect(result.success).to.be.false
      expect(result.provider).to.equal('github')
      expect(result.error).to.include('not configured')
    })

    it('returns error when ticket is not found', async () => {
      const db = createMockDb({
        'github.token': 'ghp_test_token',
        'github.owner': 'testowner',
        'github.repo': 'testrepo',
      })
      const storage = createMockStorage({ ticket: null })
      const provider = new GitHubIssuesTicketProvider(db, storage, 'test-project')

      const result = await provider.moveTicket('TKT-MISSING', 'Done')

      expect(result.success).to.be.false
      expect(result.error).to.include('not found')
    })

    it('returns error when ticket has no GitHub issue mapping', async () => {
      const db = createMockDb({
        'github.token': 'ghp_test_token',
        'github.owner': 'testowner',
        'github.repo': 'testrepo',
      })
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'In Progress',
          metadata: {},  // no github.issue_number
        },
      })
      const provider = new GitHubIssuesTicketProvider(db, storage, 'test-project')

      const result = await provider.moveTicket('TKT-001', 'Done')

      expect(result.success).to.be.false
      expect(result.error).to.include('No GitHub issue mapping')
    })
  })

  describe('deleteTicket', () => {
    it('returns error when not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new GitHubIssuesTicketProvider(db, storage, 'test-project')

      const result = await provider.deleteTicket('TKT-001')

      expect(result.success).to.be.false
      expect(result.error).to.include('not configured')
    })

    it('deletes local PMO ticket when no GitHub mapping exists', async () => {
      const db = createMockDb({
        'github.token': 'ghp_test_token',
        'github.owner': 'testowner',
        'github.repo': 'testrepo',
      })
      const deleteCalls: string[] = []
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'Backlog',
          metadata: {},  // no github.issue_number
        },
        deleteCalls,
      })
      const provider = new GitHubIssuesTicketProvider(db, storage, 'test-project')

      const result = await provider.deleteTicket('TKT-001')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('github')
      expect(deleteCalls).to.deep.equal(['TKT-001'])
    })
  })

  describe('listTickets', () => {
    it('returns error when not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new GitHubIssuesTicketProvider(db, storage, 'test-project')

      const result = await provider.listTickets()

      expect(result.success).to.be.false
      expect(result.tickets).to.deep.equal([])
      expect(result.error).to.include('not configured')
    })
  })

  describe('createTicket', () => {
    it('returns error when not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new GitHubIssuesTicketProvider(db, storage, 'test-project')

      const result = await provider.createTicket('test-project', {
        title: 'New issue',
      })

      expect(result.success).to.be.false
      expect(result.error).to.include('not configured')
    })
  })

  describe('updateTicket', () => {
    it('returns error when not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new GitHubIssuesTicketProvider(db, storage, 'test-project')

      const result = await provider.updateTicket('TKT-001', { title: 'Updated' })

      expect(result.success).to.be.false
      expect(result.error).to.include('not configured')
    })

    it('updates local PMO even when no GitHub mapping exists', async () => {
      const db = createMockDb({
        'github.token': 'ghp_test_token',
        'github.owner': 'testowner',
        'github.repo': 'testrepo',
      })
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'In Progress',
          metadata: {},  // no github.issue_number
        },
        updateCalls,
      })
      const provider = new GitHubIssuesTicketProvider(db, storage, 'test-project')

      const result = await provider.updateTicket('TKT-001', { title: 'Updated title' })

      expect(result.success).to.be.true
      expect(result.provider).to.equal('github')
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].id).to.equal('TKT-001')
    })
  })

  describe('assignTicket', () => {
    it('returns error when not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new GitHubIssuesTicketProvider(db, storage, 'test-project')

      const result = await provider.assignTicket('TKT-001', 'octocat')

      expect(result.success).to.be.false
      expect(result.error).to.include('not configured')
    })

    it('updates local PMO assignee', async () => {
      const db = createMockDb({
        'github.token': 'ghp_test_token',
        'github.owner': 'testowner',
        'github.repo': 'testrepo',
      })
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'In Progress',
          metadata: {},  // no github.issue_number — skip GitHub API call
        },
        updateCalls,
      })
      const provider = new GitHubIssuesTicketProvider(db, storage, 'test-project')

      const result = await provider.assignTicket('TKT-001', 'octocat')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('github')
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].changes).to.deep.include({ assignee: 'octocat' })
    })
  })
})
