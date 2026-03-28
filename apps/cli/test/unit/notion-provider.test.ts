import { expect } from 'chai'
import type { ProviderStorage } from '../../src/lib/providers/types.js'
import type { StateCategory, Ticket, TicketFilter, CreateTicketInput } from '../../src/lib/pmo/types.js'
import { NotionTicketProvider } from '../../src/lib/providers/notion-provider.js'

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
        metadata: {},
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

/**
 * Create a mock database that simulates Notion configuration.
 * The NotionTicketProvider calls getNotionApiKey which
 * checks provider sources, env vars, and credential store. We mock via env vars.
 */
function withNotionEnv(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const origKey = process.env.PRLT_NOTION_API_KEY
    const origDb = process.env.PRLT_NOTION_DATABASE_ID
    process.env.PRLT_NOTION_API_KEY = 'ntn_test-notion-key'
    process.env.PRLT_NOTION_DATABASE_ID = 'test-database-id'
    try {
      await fn()
    } finally {
      if (origKey === undefined) delete process.env.PRLT_NOTION_API_KEY
      else process.env.PRLT_NOTION_API_KEY = origKey
      if (origDb === undefined) delete process.env.PRLT_NOTION_DATABASE_ID
      else process.env.PRLT_NOTION_DATABASE_ID = origDb
    }
  }
}

function createMockDb(): any {
  return {
    prepare: (sql: string) => ({
      get: (..._args: any[]) => undefined,
      all: (..._args: any[]) => [],
      run: (..._args: any[]) => ({ changes: 0 }),
    }),
    exec: (_sql: string) => {},
    pragma: () => {},
  }
}

// =============================================================================
// NotionTicketProvider Tests
// =============================================================================

describe('NotionTicketProvider', () => {
  it('has name set to "notion"', () => {
    const storage = createMockStorage()
    const db = createMockDb()
    const provider = new NotionTicketProvider(db, storage, 'test-project')
    expect(provider.name).to.equal('notion')
  })

  // ---------------------------------------------------------------------------
  // getTicket — reads from local PMO mirror
  // ---------------------------------------------------------------------------
  describe('getTicket', () => {
    it('reads from local PMO storage', async () => {
      const storage = createMockStorage({
        ticket: { id: 'TKT-100', projectId: 'test-project', statusName: 'Open' },
      })
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.getTicket('TKT-100')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('notion')
      expect(result.ticket).to.not.be.null
      expect(result.ticket!.id).to.equal('TKT-100')
    })

    it('returns null ticket when not found', async () => {
      const storage = createMockStorage({ ticket: null })
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.getTicket('TKT-MISSING')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('notion')
      expect(result.ticket).to.be.null
    })
  })

  // ---------------------------------------------------------------------------
  // assignTicket — updates local PMO mirror
  // ---------------------------------------------------------------------------
  describe('assignTicket', () => {
    it('updates assignee in local PMO storage', async () => {
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({ updateCalls })
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.assignTicket('TKT-100', 'alice')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('notion')
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].id).to.equal('TKT-100')
      expect(updateCalls[0].changes).to.deep.include({ assignee: 'alice' })
    })

    it('returns error when storage fails', async () => {
      const storage = createMockStorage({ updateError: new Error('storage down') })
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.assignTicket('TKT-100', 'alice')

      expect(result.success).to.be.false
      expect(result.provider).to.equal('notion')
      expect(result.error).to.include('storage down')
    })
  })

  // ---------------------------------------------------------------------------
  // moveTicket — requires Notion credentials
  // ---------------------------------------------------------------------------
  describe('moveTicket', () => {
    it('returns error when Notion credentials not configured', async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      // Ensure env vars are not set
      const origKey = process.env.PRLT_NOTION_API_KEY
      delete process.env.PRLT_NOTION_API_KEY
      delete process.env.NOTION_API_KEY

      try {
        const result = await provider.moveTicket('TKT-100', 'Done')

        expect(result.success).to.be.false
        expect(result.provider).to.equal('notion')
        expect(result.error).to.include('not configured')
      } finally {
        if (origKey) process.env.PRLT_NOTION_API_KEY = origKey
      }
    })

    it('returns error when no Notion mapping exists', withNotionEnv(async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.moveTicket('TKT-UNMAPPED', 'Done')

      expect(result.success).to.be.false
      expect(result.provider).to.equal('notion')
      expect(result.error).to.include('No Notion mapping')
    }))
  })

  // ---------------------------------------------------------------------------
  // deleteTicket — archives page in Notion
  // ---------------------------------------------------------------------------
  describe('deleteTicket', () => {
    it('returns error when Notion credentials not configured', async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const origKey = process.env.PRLT_NOTION_API_KEY
      delete process.env.PRLT_NOTION_API_KEY
      delete process.env.NOTION_API_KEY

      try {
        const result = await provider.deleteTicket('TKT-100')

        expect(result.success).to.be.false
        expect(result.provider).to.equal('notion')
        expect(result.error).to.include('not configured')
      } finally {
        if (origKey) process.env.PRLT_NOTION_API_KEY = origKey
      }
    })

    it('deletes local PMO mirror when no Notion mapping exists', withNotionEnv(async () => {
      const deleteCalls: string[] = []
      const storage = createMockStorage({ deleteCalls })
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.deleteTicket('TKT-NO-MAP')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('notion')
      expect(deleteCalls).to.include('TKT-NO-MAP')
    }))
  })

  // ---------------------------------------------------------------------------
  // listTickets — fetches from Notion API
  // ---------------------------------------------------------------------------
  describe('listTickets', () => {
    it('returns error when Notion credentials not configured', async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const origKey = process.env.PRLT_NOTION_API_KEY
      delete process.env.PRLT_NOTION_API_KEY
      delete process.env.NOTION_API_KEY

      try {
        const result = await provider.listTickets()

        expect(result.success).to.be.false
        expect(result.provider).to.equal('notion')
        expect(result.tickets).to.deep.equal([])
        expect(result.error).to.include('not configured')
      } finally {
        if (origKey) process.env.PRLT_NOTION_API_KEY = origKey
      }
    })

    it('returns error when database ID is missing', withNotionEnv(async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      // Remove the database ID
      const origDb = process.env.PRLT_NOTION_DATABASE_ID
      delete process.env.PRLT_NOTION_DATABASE_ID

      try {
        const result = await provider.listTickets()

        expect(result.success).to.be.false
        expect(result.provider).to.equal('notion')
        expect(result.error).to.include('database ID is required')
      } finally {
        if (origDb) process.env.PRLT_NOTION_DATABASE_ID = origDb
      }
    }))
  })

  // ---------------------------------------------------------------------------
  // createTicket — creates page in Notion
  // ---------------------------------------------------------------------------
  describe('createTicket', () => {
    it('returns error when Notion credentials not configured', async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const origKey = process.env.PRLT_NOTION_API_KEY
      delete process.env.PRLT_NOTION_API_KEY
      delete process.env.NOTION_API_KEY

      try {
        const result = await provider.createTicket('test-project', {
          title: 'New page',
          description: 'Description',
          labels: [],
        })

        expect(result.success).to.be.false
        expect(result.provider).to.equal('notion')
        expect(result.error).to.include('not configured')
      } finally {
        if (origKey) process.env.PRLT_NOTION_API_KEY = origKey
      }
    })

    it('returns error when database ID is missing', withNotionEnv(async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const origDb = process.env.PRLT_NOTION_DATABASE_ID
      delete process.env.PRLT_NOTION_DATABASE_ID

      try {
        const result = await provider.createTicket('test-project', {
          title: 'New page',
          description: 'Description',
          labels: [],
        })

        expect(result.success).to.be.false
        expect(result.provider).to.equal('notion')
        expect(result.error).to.include('database ID is required')
      } finally {
        if (origDb) process.env.PRLT_NOTION_DATABASE_ID = origDb
      }
    }))
  })

  // ---------------------------------------------------------------------------
  // updateTicket — updates page in Notion + PMO mirror
  // ---------------------------------------------------------------------------
  describe('updateTicket', () => {
    it('returns error when Notion credentials not configured', async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const origKey = process.env.PRLT_NOTION_API_KEY
      delete process.env.PRLT_NOTION_API_KEY
      delete process.env.NOTION_API_KEY

      try {
        const result = await provider.updateTicket('TKT-100', { title: 'Updated' })

        expect(result.success).to.be.false
        expect(result.provider).to.equal('notion')
        expect(result.error).to.include('not configured')
      } finally {
        if (origKey) process.env.PRLT_NOTION_API_KEY = origKey
      }
    })

    it('updates local PMO mirror when no Notion mapping exists', withNotionEnv(async () => {
      const updateCalls: Array<{ id: string; changes: Partial<Ticket> }> = []
      const storage = createMockStorage({ updateCalls })
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.updateTicket('TKT-NO-MAP', { title: 'Updated title' })

      expect(result.success).to.be.true
      expect(result.provider).to.equal('notion')
      expect(updateCalls).to.have.lengthOf(1)
      expect(updateCalls[0].id).to.equal('TKT-NO-MAP')
    }))

    it('returns error when storage update fails', withNotionEnv(async () => {
      const storage = createMockStorage({ updateError: new Error('storage failure') })
      const db = createMockDb()
      const provider = new NotionTicketProvider(db, storage, 'test-project')

      const result = await provider.updateTicket('TKT-100', { title: 'Updated' })

      expect(result.success).to.be.false
      expect(result.provider).to.equal('notion')
      expect(result.error).to.include('storage failure')
    }))
  })
})

// =============================================================================
// findMatchingNotionStatus (exported helper)
// =============================================================================

import { findMatchingNotionStatus } from '../../src/lib/providers/notion-provider.js'

describe('findMatchingNotionStatus', () => {
  const statuses = [
    { id: '1', name: 'Not started' },
    { id: '2', name: 'In progress' },
    { id: '3', name: 'Done' },
    { id: '4', name: 'Review' },
  ]

  it('finds exact match (case-insensitive)', () => {
    const result = findMatchingNotionStatus(statuses, 'done')
    expect(result).to.not.be.null
    expect(result!.name).to.equal('Done')
  })

  it('finds exact match with different case', () => {
    const result = findMatchingNotionStatus(statuses, 'IN PROGRESS')
    expect(result).to.not.be.null
    expect(result!.name).to.equal('In progress')
  })

  it('finds match when status name contains target', () => {
    const result = findMatchingNotionStatus(statuses, 'progress')
    expect(result).to.not.be.null
    expect(result!.name).to.equal('In progress')
  })

  it('finds match when target contains status name', () => {
    const result = findMatchingNotionStatus(statuses, 'code review needed')
    expect(result).to.not.be.null
    expect(result!.name).to.equal('Review')
  })

  it('returns null when no match found', () => {
    const result = findMatchingNotionStatus(statuses, 'Cancelled')
    expect(result).to.be.null
  })
})

// =============================================================================
// External issues adapter
// =============================================================================

import {
  normalizeNotionPage,
  normalizeNotionPageToEnvelope,
  buildNotionTicketDescription,
  buildNotionMetadata,
  isNotionConfiguredFromEnv,
} from '../../src/lib/external-issues/notion.js'

describe('Notion external issues adapter', () => {
  describe('normalizeNotionPage', () => {
    it('normalizes a valid Notion page into an IssueEnvelope', () => {
      const rawPage = {
        id: 'page-123',
        url: 'https://notion.so/page-123',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-02T00:00:00.000Z',
        archived: false,
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'Test Page' }] },
          Description: { type: 'rich_text', rich_text: [{ plain_text: 'A test description' }] },
          Status: { type: 'status', status: { id: 's1', name: 'In progress', color: 'blue' } },
          Tags: { type: 'multi_select', multi_select: [{ id: 't1', name: 'P1', color: 'red' }] },
        },
      }

      const envelope = normalizeNotionPage(rawPage)

      expect(envelope.source).to.equal('notion')
      expect(envelope.external_id).to.equal('page-123')
      expect(envelope.title).to.equal('Test Page')
      expect(envelope.description).to.equal('A test description')
      expect(envelope.status).to.equal('In progress')
      expect(envelope.labels).to.deep.equal(['P1'])
      expect(envelope.priority).to.equal('P1')
      expect(envelope.item_type).to.equal('page')
    })

    it('handles missing description', () => {
      const rawPage = {
        id: 'page-456',
        url: 'https://notion.so/page-456',
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'No Desc Page' }] },
        },
      }

      const envelope = normalizeNotionPage(rawPage)
      expect(envelope.description).to.equal('')
    })

    it('throws for invalid payload', () => {
      expect(() => normalizeNotionPage(null)).to.throw('invalid')
      expect(() => normalizeNotionPage({})).to.throw('missing required fields')
    })
  })

  describe('normalizeNotionPageToEnvelope', () => {
    it('produces a NormalizedIssueEnvelope', () => {
      const rawPage = {
        id: 'page-789',
        url: 'https://notion.so/page-789',
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'Normalized Page' }] },
          Status: { type: 'status', status: { id: 's1', name: 'Done', color: 'green' } },
        },
      }

      const envelope = normalizeNotionPageToEnvelope(rawPage)
      expect(envelope.source.name).to.equal('notion')
      expect(envelope.source.externalId).to.equal('page-789')
      expect(envelope.title).to.equal('Normalized Page')
      expect(envelope.status).to.equal('Done')
      expect(envelope.category).to.equal('feature')
    })
  })

  describe('buildNotionTicketDescription', () => {
    it('builds a description with metadata', () => {
      const envelope = normalizeNotionPageToEnvelope({
        id: 'page-desc',
        url: 'https://notion.so/page-desc',
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'Desc Test' }] },
          Description: { type: 'rich_text', rich_text: [{ plain_text: 'Body text' }] },
          Status: { type: 'status', status: { id: 's1', name: 'Open', color: 'gray' } },
        },
      })

      const description = buildNotionTicketDescription(envelope)
      expect(description).to.include('Body text')
      expect(description).to.include('External Issue Context')
      expect(description).to.include('Source: notion')
    })
  })

  describe('buildNotionMetadata', () => {
    it('builds metadata with external source info', () => {
      const envelope = normalizeNotionPageToEnvelope({
        id: 'page-meta',
        url: 'https://notion.so/page-meta',
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'Meta Test' }] },
        },
      })

      const metadata = buildNotionMetadata(envelope)
      expect(metadata.external_source).to.equal('notion')
      expect(metadata.external_id).to.equal('page-meta')
      expect(metadata.external_url).to.equal('https://notion.so/page-meta')
    })
  })

  describe('isNotionConfiguredFromEnv', () => {
    it('returns true when API key is set', () => {
      expect(isNotionConfiguredFromEnv({ apiKey: 'test-key' })).to.be.true
    })

    it('returns false when no API key', () => {
      const origKey = process.env.PRLT_NOTION_API_KEY
      const origKey2 = process.env.NOTION_API_KEY
      delete process.env.PRLT_NOTION_API_KEY
      delete process.env.NOTION_API_KEY

      try {
        expect(isNotionConfiguredFromEnv({})).to.be.false
      } finally {
        if (origKey) process.env.PRLT_NOTION_API_KEY = origKey
        if (origKey2) process.env.NOTION_API_KEY = origKey2
      }
    })
  })
})
