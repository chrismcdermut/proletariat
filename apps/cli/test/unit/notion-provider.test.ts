import { expect } from 'chai'
import type { ProviderStorage } from '../../src/lib/providers/types.js'
import type { StateCategory, Ticket, TicketFilter, CreateTicketInput } from '../../src/lib/pmo/types.js'
import { NotionTicketProvider } from '../../src/lib/providers/notion-provider.js'
import {
  buildStatusGroupMap,
  notionPageToTicket,
} from '../../src/lib/providers/notion-provider.js'
import {
  NOTION_PRIORITY_TO_PMO,
  PMO_PRIORITY_TO_NOTION,
  NOTION_STATUS_GROUP_TO_PMO_CATEGORY,
  NOTION_STATUS_NAME_TO_PMO_CATEGORY,
} from '../../src/lib/notion/types.js'
import type { NotionDatabase, NotionPage } from '../../src/lib/notion/types.js'

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
          'notion.page_id': 'page_abc123',
          external_source: 'notion',
          external_id: 'page_abc123',
          external_key: 'page_abc123',
          external_url: 'https://notion.so/page_abc123',
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
        id: ticketId, title: 'Test ticket', projectId,
        statusId: columnName, statusName: columnName,
        subtasks: [], labels: [], metadata: {},
        createdAt: new Date(), updatedAt: new Date(),
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
        id: input.id || 'TKT-NEW', title: input.title, projectId,
        statusId: input.statusName || 'backlog', statusName: input.statusName || 'Backlog',
        subtasks: [], labels: input.labels || [], metadata: input.metadata || {},
        createdAt: new Date(), updatedAt: new Date(),
      } as Ticket
    },
    updateTicket: async (id: string, changes: Partial<Ticket>) => {
      if (overrides?.updateError) throw overrides.updateError
      updateCalls.push({ id, changes })
      const ticket = overrides?.ticket ?? { id, projectId: 'test-project', statusName: 'In Progress' }
      return {
        ...ticket, ...changes, id,
        title: (changes.title as string) || 'Test ticket',
        statusId: (ticket as MockTicket).statusName || 'backlog',
        subtasks: [], labels: [], metadata: {},
        createdAt: new Date(), updatedAt: new Date(),
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
        if (sql.includes('workspace_settings')) {
          const key = args[0] as string
          const value = settingsMap.get(key)
          return value ? { value } : undefined
        }
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
    name: '',
  }
}

// =============================================================================
// Notion Types Tests
// =============================================================================

describe('Notion Types', () => {
  describe('NOTION_PRIORITY_TO_PMO', () => {
    it('maps Urgent to P0', () => {
      expect(NOTION_PRIORITY_TO_PMO['Urgent']).to.equal('P0')
    })

    it('maps High to P1', () => {
      expect(NOTION_PRIORITY_TO_PMO['High']).to.equal('P1')
    })

    it('maps Medium to P2', () => {
      expect(NOTION_PRIORITY_TO_PMO['Medium']).to.equal('P2')
    })

    it('maps Low to P3', () => {
      expect(NOTION_PRIORITY_TO_PMO['Low']).to.equal('P3')
    })
  })

  describe('PMO_PRIORITY_TO_NOTION', () => {
    it('maps P0 to Urgent', () => {
      expect(PMO_PRIORITY_TO_NOTION['P0']).to.equal('Urgent')
    })

    it('maps P1 to High', () => {
      expect(PMO_PRIORITY_TO_NOTION['P1']).to.equal('High')
    })

    it('maps P2 to Medium', () => {
      expect(PMO_PRIORITY_TO_NOTION['P2']).to.equal('Medium')
    })

    it('maps P3 to Low', () => {
      expect(PMO_PRIORITY_TO_NOTION['P3']).to.equal('Low')
    })
  })

  describe('NOTION_STATUS_GROUP_TO_PMO_CATEGORY', () => {
    it('maps To-do to backlog', () => {
      expect(NOTION_STATUS_GROUP_TO_PMO_CATEGORY['To-do']).to.equal('backlog')
    })

    it('maps In progress to started', () => {
      expect(NOTION_STATUS_GROUP_TO_PMO_CATEGORY['In progress']).to.equal('started')
    })

    it('maps Complete to completed', () => {
      expect(NOTION_STATUS_GROUP_TO_PMO_CATEGORY['Complete']).to.equal('completed')
    })
  })

  describe('NOTION_STATUS_NAME_TO_PMO_CATEGORY', () => {
    it('maps common backlog statuses', () => {
      expect(NOTION_STATUS_NAME_TO_PMO_CATEGORY['Not started']).to.equal('backlog')
      expect(NOTION_STATUS_NAME_TO_PMO_CATEGORY['Backlog']).to.equal('backlog')
    })

    it('maps common started statuses', () => {
      expect(NOTION_STATUS_NAME_TO_PMO_CATEGORY['In progress']).to.equal('started')
      expect(NOTION_STATUS_NAME_TO_PMO_CATEGORY['In Progress']).to.equal('started')
    })

    it('maps common completed statuses', () => {
      expect(NOTION_STATUS_NAME_TO_PMO_CATEGORY['Done']).to.equal('completed')
      expect(NOTION_STATUS_NAME_TO_PMO_CATEGORY['Complete']).to.equal('completed')
    })
  })
})

// =============================================================================
// Helper Function Tests
// =============================================================================

describe('buildStatusGroupMap', () => {
  it('maps status options to their group names', () => {
    const dbSchema: NotionDatabase = {
      id: 'db-1',
      title: [{ plain_text: 'Test DB' }],
      properties: {
        Status: {
          type: 'status',
          status: {
            options: [
              { id: 'opt-1', name: 'Not started', color: 'default' },
              { id: 'opt-2', name: 'In progress', color: 'blue' },
              { id: 'opt-3', name: 'Done', color: 'green' },
            ],
            groups: [
              { id: 'grp-1', name: 'To-do', option_ids: ['opt-1'], color: 'gray' },
              { id: 'grp-2', name: 'In progress', option_ids: ['opt-2'], color: 'blue' },
              { id: 'grp-3', name: 'Complete', option_ids: ['opt-3'], color: 'green' },
            ],
          },
        },
      },
    }

    const map = buildStatusGroupMap(dbSchema, 'Status')
    expect(map.get('Not started')).to.equal('To-do')
    expect(map.get('In progress')).to.equal('In progress')
    expect(map.get('Done')).to.equal('Complete')
  })

  it('returns empty map when property is not status type', () => {
    const dbSchema: NotionDatabase = {
      id: 'db-1',
      title: [{ plain_text: 'Test DB' }],
      properties: {
        Status: { type: 'select', select: { options: [] } },
      },
    }

    const map = buildStatusGroupMap(dbSchema, 'Status')
    expect(map.size).to.equal(0)
  })
})

describe('notionPageToTicket', () => {
  it('converts a Notion page with status property to a Ticket', () => {
    const page: NotionPage = {
      id: 'page-123',
      url: 'https://notion.so/page-123',
      created_time: '2026-01-01T00:00:00.000Z',
      last_edited_time: '2026-01-02T00:00:00.000Z',
      properties: {
        Name: { type: 'title', title: [{ plain_text: 'My Task' }] },
        Status: { type: 'status', status: { id: 's-1', name: 'In progress', color: 'blue' } },
        Priority: { type: 'select', select: { id: 'p-1', name: 'High', color: 'red' } },
        Description: { type: 'rich_text', rich_text: [{ plain_text: 'Task description' }] },
        Tags: { type: 'multi_select', multi_select: [{ id: 't-1', name: 'bug', color: 'red' }] },
      },
    }

    const ticket = notionPageToTicket(page, 'Name', 'Status')
    expect(ticket.title).to.equal('My Task')
    expect(ticket.statusName).to.equal('In progress')
    expect(ticket.priority).to.equal('P1')
    expect(ticket.description).to.equal('Task description')
    expect(ticket.labels).to.deep.equal(['bug'])
    expect(ticket.metadata.external_source).to.equal('notion')
    expect(ticket.metadata['notion.page_id']).to.equal('page-123')
  })

  it('handles missing optional properties gracefully', () => {
    const page: NotionPage = {
      id: 'page-456',
      url: 'https://notion.so/page-456',
      created_time: '2026-01-01T00:00:00.000Z',
      last_edited_time: '2026-01-02T00:00:00.000Z',
      properties: {
        Name: { type: 'title', title: [{ plain_text: 'Minimal Task' }] },
      },
    }

    const ticket = notionPageToTicket(page, 'Name', 'Status')
    expect(ticket.title).to.equal('Minimal Task')
    expect(ticket.statusName).to.equal('Not started')
    expect(ticket.priority).to.be.undefined
    expect(ticket.labels).to.deep.equal([])
  })

  it('extracts unique_id for ticket ID when available', () => {
    const page: NotionPage = {
      id: 'page-789',
      url: 'https://notion.so/page-789',
      created_time: '2026-01-01T00:00:00.000Z',
      last_edited_time: '2026-01-02T00:00:00.000Z',
      properties: {
        Name: { type: 'title', title: [{ plain_text: 'ID Task' }] },
        ID: { type: 'unique_id', unique_id: { prefix: 'TASK', number: 42 } },
      },
    }

    const ticket = notionPageToTicket(page, 'Name', 'Status')
    expect(ticket.id).to.equal('TASK-42')
  })

  it('uses status group mapping when provided', () => {
    const page: NotionPage = {
      id: 'page-abc',
      url: 'https://notion.so/page-abc',
      created_time: '2026-01-01T00:00:00.000Z',
      last_edited_time: '2026-01-02T00:00:00.000Z',
      properties: {
        Name: { type: 'title', title: [{ plain_text: 'Grouped Task' }] },
        Status: { type: 'status', status: { id: 's-1', name: 'Custom Status', color: 'purple' } },
      },
    }

    const groupMap = new Map([['Custom Status', 'Complete']])
    const ticket = notionPageToTicket(page, 'Name', 'Status', groupMap)
    expect(ticket.statusCategory).to.equal('completed')
  })
})

// =============================================================================
// NotionTicketProvider Tests
// =============================================================================

describe('NotionTicketProvider', () => {
  it('has name property set to notion', () => {
    const db = createMockDb()
    const storage = createMockStorage()
    const provider = new NotionTicketProvider(db, storage, 'test-project')
    expect(provider.name).to.equal('notion')
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
            'notion.page_id': 'page_abc',
            external_source: 'notion',
            external_id: 'page_abc',
            external_key: 'page_abc',
            external_url: 'https://notion.so/page_abc',
          },
        },
      })
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.getTicket('TKT-001')
      expect(result.success).to.be.true
      expect(result.provider).to.equal('notion')
      expect(result.ticket).to.not.be.null
      expect(result.ticket?.id).to.equal('TKT-001')
    })

    it('returns null ticket when not found', async () => {
      const db = createMockDb()
      const storage = createMockStorage({ ticket: null })
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.getTicket('TKT-MISSING')
      expect(result.success).to.be.true
      expect(result.ticket).to.be.null
    })
  })

  describe('moveTicket', () => {
    it('returns error when API key is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.moveTicket('TKT-001', 'Done')
      expect(result.success).to.be.false
      expect(result.provider).to.equal('notion')
      expect(result.error).to.include('API key not configured')
    })

    it('returns error when ticket is not found', async () => {
      const db = createMockDb({ 'notion.api_key': 'ntn_test_123' })
      const storage = createMockStorage({ ticket: null })
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.moveTicket('TKT-MISSING', 'Done')
      expect(result.success).to.be.false
      expect(result.error).to.include('not found')
    })

    it('returns error when ticket has no Notion mapping', async () => {
      const db = createMockDb({ 'notion.api_key': 'ntn_test_123' })
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'In Progress',
          metadata: {},
        },
      })
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.moveTicket('TKT-001', 'Done')
      expect(result.success).to.be.false
      expect(result.error).to.include('No Notion mapping')
    })
  })

  describe('deleteTicket', () => {
    it('returns error when API key is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.deleteTicket('TKT-001')
      expect(result.success).to.be.false
      expect(result.error).to.include('API key not configured')
    })

    it('deletes local PMO ticket when no Notion mapping exists', async () => {
      const db = createMockDb({ 'notion.api_key': 'ntn_test_123' })
      const deleteCalls: string[] = []
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'Backlog',
          metadata: {},
        },
        deleteCalls,
      })
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.deleteTicket('TKT-001')
      expect(result.success).to.be.true
      expect(result.provider).to.equal('notion')
      expect(deleteCalls).to.deep.equal(['TKT-001'])
    })
  })

  describe('listTickets', () => {
    it('returns error when API key is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.listTickets()
      expect(result.success).to.be.false
      expect(result.tickets).to.deep.equal([])
      expect(result.error).to.include('API key not configured')
    })

    it('returns error when no database ID is configured', async () => {
      const db = createMockDb({ 'notion.api_key': 'ntn_test_123' })
      const storage = createMockStorage()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.listTickets()
      expect(result.success).to.be.false
      expect(result.tickets).to.deep.equal([])
      expect(result.error).to.include('database ID is required')
    })
  })

  describe('createTicket', () => {
    it('returns error when API key is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.createTicket('test-project', { title: 'New task' })
      expect(result.success).to.be.false
      expect(result.error).to.include('API key not configured')
    })

    it('returns error when no database ID is configured', async () => {
      const db = createMockDb({ 'notion.api_key': 'ntn_test_123' })
      const storage = createMockStorage()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.createTicket('test-project', { title: 'New task' })
      expect(result.success).to.be.false
      expect(result.error).to.include('database ID is required')
    })
  })

  describe('updateTicket', () => {
    it('returns error when API key is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.updateTicket('TKT-001', { title: 'Updated' })
      expect(result.success).to.be.false
      expect(result.error).to.include('API key not configured')
    })

    it('updates local PMO even when no Notion mapping exists', async () => {
      const db = createMockDb({ 'notion.api_key': 'ntn_test_123' })
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'In Progress',
          metadata: {},
        },
        updateCalls,
      })
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.updateTicket('TKT-001', { title: 'Updated title' })
      expect(result.success).to.be.true
      expect(result.provider).to.equal('notion')
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].id).to.equal('TKT-001')
    })
  })

  describe('assignTicket', () => {
    it('returns error when API key is not configured', async () => {
      const db = createMockDb()
      const storage = createMockStorage()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.assignTicket('TKT-001', 'user@example.com')
      expect(result.success).to.be.false
      expect(result.error).to.include('API key not configured')
    })

    it('updates local PMO assignee', async () => {
      const db = createMockDb({ 'notion.api_key': 'ntn_test_123' })
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-001',
          projectId: 'test-project',
          statusName: 'In Progress',
          metadata: {},
        },
        updateCalls,
      })
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.assignTicket('TKT-001', 'agent-123')
      expect(result.success).to.be.true
      expect(result.provider).to.equal('notion')
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].changes).to.deep.include({ assignee: 'agent-123' })
    })
  })
})
