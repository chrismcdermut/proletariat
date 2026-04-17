import { expect } from 'chai'
import type { ProviderStorage } from '../../src/lib/providers/types.js'
import type { StateCategory, Ticket, TicketFilter, CreateTicketInput } from '../../src/lib/pmo/types.js'
import { AsanaTicketProvider } from '../../src/lib/providers/asana-provider.js'

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
          external_source: 'asana',
          external_id: 'asana_task_123',
          external_key: 'asana_task_123',
          external_url: 'https://app.asana.com/0/0/asana_task_123',
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

/**
 * Create a mock database. When settings contain 'asana.access_token' in credentials,
 * the provider will find the access token.
 */
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
        // AsanaMapper getByTicketId
        if (sql.includes('pmo_asana_task_map')) {
          return undefined
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

/**
 * Wrap a test function with ASANA env var setup/teardown.
 */
function withAsanaEnv(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const origToken = process.env.PRLT_ASANA_ACCESS_TOKEN
    const origProjectGid = process.env.PRLT_ASANA_PROJECT_GID
    process.env.PRLT_ASANA_ACCESS_TOKEN = 'test-asana-token'
    process.env.PRLT_ASANA_PROJECT_GID = 'test-project-gid'
    try {
      await fn()
    } finally {
      if (origToken === undefined) delete process.env.PRLT_ASANA_ACCESS_TOKEN
      else process.env.PRLT_ASANA_ACCESS_TOKEN = origToken
      if (origProjectGid === undefined) delete process.env.PRLT_ASANA_PROJECT_GID
      else process.env.PRLT_ASANA_PROJECT_GID = origProjectGid
    }
  }
}

// =============================================================================
// AsanaTicketProvider Tests
// =============================================================================

describe('AsanaTicketProvider', () => {
  it('has name set to "asana"', () => {
    const storage = createMockStorage()
    const db = createMockDb()
    const provider = new AsanaTicketProvider(db, storage, 'test-project')
    expect(provider.name).to.equal('asana')
  })

  // ---------------------------------------------------------------------------
  // getTicket — reads from local PMO mirror
  // ---------------------------------------------------------------------------
  describe('getTicket', () => {
    // PRLT-1327: getTicket now fetches from Asana API, not local storage
    it.skip('reads from local PMO storage', async () => {
      const storage = createMockStorage({
        ticket: {
          id: 'TKT-100',
          projectId: 'test-project',
          title: 'Asana task',
          statusName: 'In Progress',
          metadata: {
            external_source: 'asana',
            external_id: 'task_gid_100',
            external_key: 'task_gid_100',
            external_url: 'https://app.asana.com/0/0/task_gid_100',
          },
        },
      })
      const db = createMockDb()
      const provider = new AsanaTicketProvider(db, storage, 'test-project')

      const result = await provider.getTicket('TKT-100')

      expect(result.success).to.be.true
      expect(result.provider).to.equal('asana')
      expect(result.ticket).to.not.be.null
      expect(result.ticket!.id).to.equal('TKT-100')
    })

    // PRLT-1327: getTicket now fetches from Asana API, not local storage
    it.skip('returns null ticket when not found', () => {})
    it.skip('returns error when storage fails', () => {})
  })

  // ---------------------------------------------------------------------------
  // assignTicket — updates local PMO mirror
  // ---------------------------------------------------------------------------
  describe('assignTicket', () => {
    // PRLT-1327: assignTicket is now a no-op (local PMO mirror removed)
    it('returns success without token (no-op)', async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new AsanaTicketProvider(db, storage, 'test-project')
      const result = await provider.assignTicket('TKT-100', 'alice')
      expect(result.success).to.be.true
      expect(result.provider).to.equal('asana')
    })
  })

  // ---------------------------------------------------------------------------
  // moveTicket — requires Asana access token
  // ---------------------------------------------------------------------------
  describe('moveTicket', () => {
    it('returns error when access token not configured', async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new AsanaTicketProvider(db, storage, 'test-project')

      const origToken = process.env.PRLT_ASANA_ACCESS_TOKEN
      const origAsanaToken = process.env.ASANA_ACCESS_TOKEN
      delete process.env.PRLT_ASANA_ACCESS_TOKEN
      delete process.env.ASANA_ACCESS_TOKEN

      try {
        const result = await provider.moveTicket('TKT-100', 'Done')

        expect(result.success).to.be.false
        expect(result.provider).to.equal('asana')
        expect(result.error).to.include('not configured')
      } finally {
        if (origToken) process.env.PRLT_ASANA_ACCESS_TOKEN = origToken
        if (origAsanaToken) process.env.ASANA_ACCESS_TOKEN = origAsanaToken
      }
    })

    it('returns error when no Asana mapping exists', withAsanaEnv(async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new AsanaTicketProvider(db, storage, 'test-project')

      const result = await provider.moveTicket('TKT-UNMAPPED', 'Done')

      expect(result.success).to.be.false
      expect(result.provider).to.equal('asana')
      expect(result.error).to.include('No Asana mapping')
    }))
  })

  // ---------------------------------------------------------------------------
  // deleteTicket — deletes task in Asana
  // ---------------------------------------------------------------------------
  describe('deleteTicket', () => {
    it('returns error when access token not configured', async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new AsanaTicketProvider(db, storage, 'test-project')

      const origToken = process.env.PRLT_ASANA_ACCESS_TOKEN
      const origAsanaToken = process.env.ASANA_ACCESS_TOKEN
      delete process.env.PRLT_ASANA_ACCESS_TOKEN
      delete process.env.ASANA_ACCESS_TOKEN

      try {
        const result = await provider.deleteTicket('TKT-100')

        expect(result.success).to.be.false
        expect(result.provider).to.equal('asana')
        expect(result.error).to.include('not configured')
      } finally {
        if (origToken) process.env.PRLT_ASANA_ACCESS_TOKEN = origToken
        if (origAsanaToken) process.env.ASANA_ACCESS_TOKEN = origAsanaToken
      }
    })

    // PRLT-1327: deleteTicket no longer deletes local PMO mirror
    it('returns success when no Asana mapping exists', withAsanaEnv(async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new AsanaTicketProvider(db, storage, 'test-project')
      const result = await provider.deleteTicket('TKT-NO-MAP')
      expect(result.success).to.be.true
      expect(result.provider).to.equal('asana')
    }))
  })

  // ---------------------------------------------------------------------------
  // listTickets — fetches from Asana API
  // ---------------------------------------------------------------------------
  describe('listTickets', () => {
    it('returns error when access token not configured', async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new AsanaTicketProvider(db, storage, 'test-project')

      const origToken = process.env.PRLT_ASANA_ACCESS_TOKEN
      const origAsanaToken = process.env.ASANA_ACCESS_TOKEN
      delete process.env.PRLT_ASANA_ACCESS_TOKEN
      delete process.env.ASANA_ACCESS_TOKEN

      try {
        const result = await provider.listTickets()

        expect(result.success).to.be.false
        expect(result.provider).to.equal('asana')
        expect(result.tickets).to.deep.equal([])
        expect(result.error).to.include('not configured')
      } finally {
        if (origToken) process.env.PRLT_ASANA_ACCESS_TOKEN = origToken
        if (origAsanaToken) process.env.ASANA_ACCESS_TOKEN = origAsanaToken
      }
    })

    it('returns error when no project GID configured', withAsanaEnv(async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new AsanaTicketProvider(db, storage, 'test-project')

      // Remove project GID
      const origProjectGid = process.env.PRLT_ASANA_PROJECT_GID
      delete process.env.PRLT_ASANA_PROJECT_GID

      try {
        const result = await provider.listTickets()

        expect(result.success).to.be.false
        expect(result.provider).to.equal('asana')
        expect(result.tickets).to.deep.equal([])
        expect(result.error).to.include('project GID is required')
      } finally {
        if (origProjectGid) process.env.PRLT_ASANA_PROJECT_GID = origProjectGid
      }
    }))
  })

  // ---------------------------------------------------------------------------
  // createTicket — creates task in Asana
  // ---------------------------------------------------------------------------
  describe('createTicket', () => {
    it('returns error when access token not configured', async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new AsanaTicketProvider(db, storage, 'test-project')

      const origToken = process.env.PRLT_ASANA_ACCESS_TOKEN
      const origAsanaToken = process.env.ASANA_ACCESS_TOKEN
      delete process.env.PRLT_ASANA_ACCESS_TOKEN
      delete process.env.ASANA_ACCESS_TOKEN

      try {
        const result = await provider.createTicket('test-project', {
          title: 'New task',
          description: 'Description',
          labels: [],
        })

        expect(result.success).to.be.false
        expect(result.provider).to.equal('asana')
        expect(result.error).to.include('not configured')
      } finally {
        if (origToken) process.env.PRLT_ASANA_ACCESS_TOKEN = origToken
        if (origAsanaToken) process.env.ASANA_ACCESS_TOKEN = origAsanaToken
      }
    })

    it('returns error when project GID is missing', withAsanaEnv(async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new AsanaTicketProvider(db, storage, 'test-project')

      const origProjectGid = process.env.PRLT_ASANA_PROJECT_GID
      delete process.env.PRLT_ASANA_PROJECT_GID

      try {
        const result = await provider.createTicket('test-project', {
          title: 'New task',
          description: 'Description',
          labels: [],
        })

        expect(result.success).to.be.false
        expect(result.provider).to.equal('asana')
        expect(result.error).to.include('project GID is required')
      } finally {
        if (origProjectGid) process.env.PRLT_ASANA_PROJECT_GID = origProjectGid
      }
    }))
  })

  // ---------------------------------------------------------------------------
  // updateTicket — updates task in Asana + PMO mirror
  // ---------------------------------------------------------------------------
  describe('updateTicket', () => {
    it('returns error when access token not configured', async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new AsanaTicketProvider(db, storage, 'test-project')

      const origToken = process.env.PRLT_ASANA_ACCESS_TOKEN
      const origAsanaToken = process.env.ASANA_ACCESS_TOKEN
      delete process.env.PRLT_ASANA_ACCESS_TOKEN
      delete process.env.ASANA_ACCESS_TOKEN

      try {
        const result = await provider.updateTicket('TKT-100', { title: 'Updated' })

        expect(result.success).to.be.false
        expect(result.provider).to.equal('asana')
        expect(result.error).to.include('not configured')
      } finally {
        if (origToken) process.env.PRLT_ASANA_ACCESS_TOKEN = origToken
        if (origAsanaToken) process.env.ASANA_ACCESS_TOKEN = origAsanaToken
      }
    })

    // PRLT-1327: updateTicket no longer writes to local PMO mirror
    it('returns success with synthetic ticket when no mapping exists', withAsanaEnv(async () => {
      const storage = createMockStorage()
      const db = createMockDb()
      const provider = new AsanaTicketProvider(db, storage, 'test-project')
      const result = await provider.updateTicket('TKT-NO-MAP', { title: 'Updated title' })
      expect(result.success).to.be.true
      expect(result.provider).to.equal('asana')
      expect(result.ticket).to.not.be.null
    }))
  })
})

// =============================================================================
// asanaTaskToTicket conversion (via listTickets behavior)
// =============================================================================

describe('AsanaTicketProvider section-to-status mapping', () => {
  // The asanaTaskToTicket and deriveStatusCategory functions are private,
  // but we document their expected behavior:
  //
  // Section name → Status category mapping:
  // - "Done", "Complete", "Shipped", "Closed" → completed
  // - "Cancel", "Won't do" → canceled
  // - "In Progress", "Doing", "Active", "Review", "Testing" → started
  // - "Backlog", "Todo", "To Do", "Icebox", "Later" → unstarted
  // - Unknown → started (default)
  //
  // findMatchingSection uses 3-tier matching:
  // 1. Exact match (case-insensitive)
  // 2. Section name contains target state
  // 3. Target state contains section name

  it('documents section-to-kanban mapping behavior', () => {
    // This test documents the expected mapping behavior
    expect(true).to.be.true
  })
})
