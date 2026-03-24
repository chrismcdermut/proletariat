/**
 * Tests for State Resolution Engine (PRLT-1087)
 *
 * Tests the move() function and its resolution flow:
 * 1. Config override → exact match
 * 2. Semantic intent alias matching
 * 3. LLM fallback (mocked)
 * 4. Skip when no match
 */
import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  move,
  moveWithProvider,
  createPMProviderAdapter,
  getStateMapConfig,
  setStateMapConfig,
  deleteStateMapConfig,
  listStateMapConfigs,
  llmResolveState,
  type PMProvider,
  type PMState,
} from '../../src/lib/providers/state-resolution.js'
import {
  DEFAULT_INTENTS,
  getDefaultIntent,
  matchIntentByAliases,
} from '../../src/lib/providers/state-intents.js'
import type { ProviderStorage } from '../../src/lib/providers/types.js'
import type { Ticket, CreateTicketInput } from '../../src/lib/pmo/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE workspace_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
  return db
}

function createMockPMProvider(
  states: PMState[],
  moveCalls: Array<{ ticketId: string; stateId: string }> = [],
  moveSuccess = true,
): PMProvider {
  return {
    async fetchStates() {
      return states
    },
    async moveTicket(ticketId: string, stateId: string) {
      moveCalls.push({ ticketId, stateId })
      return { success: moveSuccess }
    },
  }
}

function createMockStorage(columns: string[]): ProviderStorage {
  return {
    getTicket: async (id: string) => ({
      id,
      title: 'Test ticket',
      projectId: 'test-project',
      statusId: 'backlog',
      statusName: 'Backlog',
      subtasks: [],
      labels: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as Ticket,
    getProjectBoard: async () => ({
      columns: columns.map(name => ({ name })),
    }),
    moveTicket: async (projectId: string, ticketId: string, columnName: string) => ({
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
    }) as Ticket,
    deleteTicket: async () => {},
    listTickets: async () => [],
    createTicket: async (projectId: string, input: CreateTicketInput) => ({
      id: 'TKT-NEW',
      title: input.title,
      projectId,
      statusId: 'backlog',
      statusName: 'Backlog',
      subtasks: [],
      labels: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as Ticket,
    updateTicket: async (id: string) => ({
      id,
      title: 'Test ticket',
      statusId: 'backlog',
      statusName: 'Backlog',
      subtasks: [],
      labels: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as Ticket,
    getDatabase: () => new Database(':memory:') as any,
  }
}

// ---------------------------------------------------------------------------
// Tests: Semantic Intent Presets
// ---------------------------------------------------------------------------

describe('PRLT-1087: State Resolution Engine', () => {
  describe('Semantic Intent Presets', () => {
    it('should have default intents for active, review, done, blocked', () => {
      expect(DEFAULT_INTENTS).to.have.lengthOf(4)
      const names = DEFAULT_INTENTS.map(i => i.name)
      expect(names).to.include('active')
      expect(names).to.include('review')
      expect(names).to.include('done')
      expect(names).to.include('blocked')
    })

    it('should get a specific default intent by name', () => {
      const review = getDefaultIntent('review')
      expect(review).to.not.be.undefined
      expect(review!.name).to.equal('review')
      expect(review!.aliases).to.include('Review')
      expect(review!.aliases).to.include('In Review')
    })

    it('should return undefined for unknown intent', () => {
      expect(getDefaultIntent('nonexistent')).to.be.undefined
    })

    it('should match intent aliases case-insensitively', () => {
      const states = [
        { id: 'st-1', name: 'Backlog' },
        { id: 'st-2', name: 'in progress' },
        { id: 'st-3', name: 'Review' },
        { id: 'st-4', name: 'Done' },
      ]
      const activeIntent = getDefaultIntent('active')!
      const match = matchIntentByAliases(states, activeIntent)
      expect(match).to.not.be.null
      expect(match!.name).to.equal('in progress')
    })

    it('should match partial aliases (contains)', () => {
      const states = [
        { id: 'st-1', name: 'Triage' },
        { id: 'st-2', name: 'Currently In Progress Now' },
      ]
      const activeIntent = getDefaultIntent('active')!
      const match = matchIntentByAliases(states, activeIntent)
      expect(match).to.not.be.null
      expect(match!.id).to.equal('st-2')
    })

    it('should return null when no aliases match', () => {
      const states = [
        { id: 'st-1', name: 'Alpha' },
        { id: 'st-2', name: 'Beta' },
      ]
      const activeIntent = getDefaultIntent('active')!
      const match = matchIntentByAliases(states, activeIntent)
      expect(match).to.be.null
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: Config Override
  // ---------------------------------------------------------------------------

  describe('Config State Map', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
    })

    afterEach(() => {
      db.close()
    })

    it('should return null when no config is set', () => {
      expect(getStateMapConfig(db, 'review')).to.be.null
    })

    it('should set and get a state map config', () => {
      setStateMapConfig(db, 'review', 'Awaiting Client Feedback')
      expect(getStateMapConfig(db, 'review')).to.equal('Awaiting Client Feedback')
    })

    it('should overwrite an existing config', () => {
      setStateMapConfig(db, 'review', 'Awaiting Client Feedback')
      setStateMapConfig(db, 'review', 'QA Review')
      expect(getStateMapConfig(db, 'review')).to.equal('QA Review')
    })

    it('should delete a config', () => {
      setStateMapConfig(db, 'review', 'Awaiting Client Feedback')
      deleteStateMapConfig(db, 'review')
      expect(getStateMapConfig(db, 'review')).to.be.null
    })

    it('should list all state map configs', () => {
      setStateMapConfig(db, 'active', 'Working On')
      setStateMapConfig(db, 'review', 'Awaiting Client Feedback')
      setStateMapConfig(db, 'done', 'Complete')

      const configs = listStateMapConfigs(db)
      expect(configs).to.have.lengthOf(3)
      expect(configs.find(c => c.intent === 'active')!.stateName).to.equal('Working On')
      expect(configs.find(c => c.intent === 'review')!.stateName).to.equal('Awaiting Client Feedback')
      expect(configs.find(c => c.intent === 'done')!.stateName).to.equal('Complete')
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: move() — Resolution Flow
  // ---------------------------------------------------------------------------

  describe('move() resolution flow', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
    })

    afterEach(() => {
      db.close()
    })

    it('should resolve via config override when set', async () => {
      setStateMapConfig(db, 'review', 'Awaiting Client Feedback')

      const moveCalls: Array<{ ticketId: string; stateId: string }> = []
      const provider = createMockPMProvider([
        { id: 'st-1', name: 'Backlog' },
        { id: 'st-2', name: 'In Progress' },
        { id: 'st-3', name: 'Awaiting Client Feedback' },
        { id: 'st-4', name: 'Done' },
      ], moveCalls)

      const result = await move(provider, 'TKT-1', 'review', db)
      expect(result.success).to.be.true
      expect(result.resolvedVia).to.equal('config')
      expect(result.stateName).to.equal('Awaiting Client Feedback')
      expect(moveCalls).to.have.lengthOf(1)
      expect(moveCalls[0].stateId).to.equal('st-3')
    })

    it('should fall through to alias matching when config state not found', async () => {
      setStateMapConfig(db, 'review', 'Nonexistent State')

      const moveCalls: Array<{ ticketId: string; stateId: string }> = []
      const provider = createMockPMProvider([
        { id: 'st-1', name: 'Backlog' },
        { id: 'st-2', name: 'In Progress' },
        { id: 'st-3', name: 'Review' },
        { id: 'st-4', name: 'Done' },
      ], moveCalls)

      const result = await move(provider, 'TKT-1', 'review', db)
      expect(result.success).to.be.true
      expect(result.resolvedVia).to.equal('alias')
      expect(result.stateName).to.equal('Review')
    })

    it('should resolve via alias matching when no config is set', async () => {
      const moveCalls: Array<{ ticketId: string; stateId: string }> = []
      const provider = createMockPMProvider([
        { id: 'st-1', name: 'Backlog' },
        { id: 'st-2', name: 'In Progress' },
        { id: 'st-3', name: 'In Review' },
        { id: 'st-4', name: 'Done' },
      ], moveCalls)

      const result = await move(provider, 'TKT-1', 'review', db)
      expect(result.success).to.be.true
      expect(result.resolvedVia).to.equal('alias')
      expect(result.stateName).to.equal('In Review')
    })

    it('should resolve "active" intent to "In Progress"', async () => {
      const moveCalls: Array<{ ticketId: string; stateId: string }> = []
      const provider = createMockPMProvider([
        { id: 'st-1', name: 'Backlog' },
        { id: 'st-2', name: 'In Progress' },
        { id: 'st-3', name: 'Review' },
        { id: 'st-4', name: 'Done' },
      ], moveCalls)

      const result = await move(provider, 'TKT-1', 'active', db)
      expect(result.success).to.be.true
      expect(result.resolvedVia).to.equal('alias')
      expect(result.stateName).to.equal('In Progress')
    })

    it('should resolve "done" intent to "Done"', async () => {
      const moveCalls: Array<{ ticketId: string; stateId: string }> = []
      const provider = createMockPMProvider([
        { id: 'st-1', name: 'Backlog' },
        { id: 'st-2', name: 'In Progress' },
        { id: 'st-3', name: 'Review' },
        { id: 'st-4', name: 'Done' },
      ], moveCalls)

      const result = await move(provider, 'TKT-1', 'done', db)
      expect(result.success).to.be.true
      expect(result.resolvedVia).to.equal('alias')
      expect(result.stateName).to.equal('Done')
    })

    it('should resolve "blocked" intent to "Blocked"', async () => {
      const moveCalls: Array<{ ticketId: string; stateId: string }> = []
      const provider = createMockPMProvider([
        { id: 'st-1', name: 'Backlog' },
        { id: 'st-2', name: 'In Progress' },
        { id: 'st-3', name: 'Blocked' },
        { id: 'st-4', name: 'Done' },
      ], moveCalls)

      const result = await move(provider, 'TKT-1', 'blocked', db)
      expect(result.success).to.be.true
      expect(result.resolvedVia).to.equal('alias')
      expect(result.stateName).to.equal('Blocked')
    })

    it('should skip when no states available', async () => {
      const provider = createMockPMProvider([])
      const result = await move(provider, 'TKT-1', 'review', db)
      expect(result.success).to.be.false
      expect(result.error).to.include('No states available')
    })

    it('should skip when no match and no LLM key', async () => {
      // Ensure ANTHROPIC_API_KEY is not set
      const originalKey = process.env.ANTHROPIC_API_KEY
      delete process.env.ANTHROPIC_API_KEY

      const provider = createMockPMProvider([
        { id: 'st-1', name: 'Alpha' },
        { id: 'st-2', name: 'Beta' },
        { id: 'st-3', name: 'Gamma' },
      ])

      const result = await move(provider, 'TKT-1', 'review', db)
      expect(result.success).to.be.false
      expect(result.resolvedVia).to.equal('skipped')
      expect(result.warning).to.include("No state match for intent 'review'")

      // Restore
      if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey
    })

    it('should handle fetchStates failure gracefully', async () => {
      const provider: PMProvider = {
        async fetchStates() {
          throw new Error('Provider unreachable')
        },
        async moveTicket() {
          return { success: true }
        },
      }

      const result = await move(provider, 'TKT-1', 'review', db)
      expect(result.success).to.be.false
      expect(result.error).to.include('Failed to fetch states')
    })

    it('should handle moveTicket failure gracefully', async () => {
      const provider = createMockPMProvider([
        { id: 'st-1', name: 'Review' },
      ], [], false)

      const result = await move(provider, 'TKT-1', 'review', db)
      expect(result.success).to.be.false
      expect(result.resolvedVia).to.equal('alias')
    })

    it('should work without db (skip config check)', async () => {
      const moveCalls: Array<{ ticketId: string; stateId: string }> = []
      const provider = createMockPMProvider([
        { id: 'st-1', name: 'In Progress' },
        { id: 'st-2', name: 'Review' },
        { id: 'st-3', name: 'Done' },
      ], moveCalls)

      const result = await move(provider, 'TKT-1', 'review')
      expect(result.success).to.be.true
      expect(result.resolvedVia).to.equal('alias')
      expect(result.stateName).to.equal('Review')
    })

    it('should prefer config over alias when both match', async () => {
      // Config maps 'review' to 'QA' (a non-standard name)
      setStateMapConfig(db, 'review', 'QA')

      const moveCalls: Array<{ ticketId: string; stateId: string }> = []
      const provider = createMockPMProvider([
        { id: 'st-1', name: 'In Progress' },
        { id: 'st-2', name: 'Review' },      // Would match alias
        { id: 'st-3', name: 'QA' },           // Config maps to this
        { id: 'st-4', name: 'Done' },
      ], moveCalls)

      const result = await move(provider, 'TKT-1', 'review', db)
      expect(result.success).to.be.true
      expect(result.resolvedVia).to.equal('config')
      expect(result.stateName).to.equal('QA')
      expect(moveCalls[0].stateId).to.equal('st-3')
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: createPMProviderAdapter
  // ---------------------------------------------------------------------------

  describe('createPMProviderAdapter', () => {
    it('should fetch states from storage board columns', async () => {
      const storage = createMockStorage(['Backlog', 'In Progress', 'Review', 'Done'])
      const mockProvider = {
        name: 'pmo' as const,
        moveTicket: async () => ({ success: true, provider: 'pmo' as const }),
        deleteTicket: async () => ({ success: true, provider: 'pmo' as const }),
        listTickets: async () => ({ success: true, provider: 'pmo' as const, tickets: [] }),
        createTicket: async () => ({ success: true, provider: 'pmo' as const }),
        getTicket: async () => ({ success: true, provider: 'pmo' as const, ticket: null }),
        updateTicket: async () => ({ success: true, provider: 'pmo' as const }),
        assignTicket: async () => ({ success: true, provider: 'pmo' as const }),
      }

      const adapter = createPMProviderAdapter(mockProvider, storage, 'test-project')
      const states = await adapter.fetchStates('TKT-1')

      expect(states).to.have.lengthOf(4)
      expect(states.map(s => s.name)).to.deep.equal(['Backlog', 'In Progress', 'Review', 'Done'])
    })

    it('should return empty states when board not found', async () => {
      const storage = {
        ...createMockStorage([]),
        getProjectBoard: async () => null,
      }
      const mockProvider = {
        name: 'pmo' as const,
        moveTicket: async () => ({ success: true, provider: 'pmo' as const }),
        deleteTicket: async () => ({ success: true, provider: 'pmo' as const }),
        listTickets: async () => ({ success: true, provider: 'pmo' as const, tickets: [] }),
        createTicket: async () => ({ success: true, provider: 'pmo' as const }),
        getTicket: async () => ({ success: true, provider: 'pmo' as const, ticket: null }),
        updateTicket: async () => ({ success: true, provider: 'pmo' as const }),
        assignTicket: async () => ({ success: true, provider: 'pmo' as const }),
      }

      const adapter = createPMProviderAdapter(mockProvider, storage, 'test-project')
      const states = await adapter.fetchStates('TKT-1')

      expect(states).to.have.lengthOf(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: moveWithProvider (convenience wrapper)
  // ---------------------------------------------------------------------------

  describe('moveWithProvider', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
    })

    afterEach(() => {
      db.close()
    })

    it('should resolve intent through provider + storage', async () => {
      const moveCalls: Array<{ ticketId: string; newState: string }> = []
      const mockProvider = {
        name: 'pmo' as const,
        moveTicket: async (ticketId: string, newState: string) => {
          moveCalls.push({ ticketId, newState })
          return { success: true, provider: 'pmo' as const }
        },
        deleteTicket: async () => ({ success: true, provider: 'pmo' as const }),
        listTickets: async () => ({ success: true, provider: 'pmo' as const, tickets: [] }),
        createTicket: async () => ({ success: true, provider: 'pmo' as const }),
        getTicket: async () => ({ success: true, provider: 'pmo' as const, ticket: null }),
        updateTicket: async () => ({ success: true, provider: 'pmo' as const }),
        assignTicket: async () => ({ success: true, provider: 'pmo' as const }),
      }
      const storage = createMockStorage(['Backlog', 'In Progress', 'Review', 'Done'])

      const result = await moveWithProvider(
        mockProvider,
        storage,
        'test-project',
        'TKT-1',
        'review',
        db,
      )

      expect(result.success).to.be.true
      expect(result.resolvedVia).to.equal('alias')
      expect(result.stateName).to.equal('Review')
      expect(moveCalls).to.have.lengthOf(1)
      expect(moveCalls[0].newState).to.equal('Review')
    })

    it('should use config override with moveWithProvider', async () => {
      setStateMapConfig(db, 'review', 'QA')

      const moveCalls: Array<{ ticketId: string; newState: string }> = []
      const mockProvider = {
        name: 'pmo' as const,
        moveTicket: async (ticketId: string, newState: string) => {
          moveCalls.push({ ticketId, newState })
          return { success: true, provider: 'pmo' as const }
        },
        deleteTicket: async () => ({ success: true, provider: 'pmo' as const }),
        listTickets: async () => ({ success: true, provider: 'pmo' as const, tickets: [] }),
        createTicket: async () => ({ success: true, provider: 'pmo' as const }),
        getTicket: async () => ({ success: true, provider: 'pmo' as const, ticket: null }),
        updateTicket: async () => ({ success: true, provider: 'pmo' as const }),
        assignTicket: async () => ({ success: true, provider: 'pmo' as const }),
      }
      const storage = createMockStorage(['Backlog', 'In Progress', 'QA', 'Done'])

      const result = await moveWithProvider(
        mockProvider,
        storage,
        'test-project',
        'TKT-1',
        'review',
        db,
      )

      expect(result.success).to.be.true
      expect(result.resolvedVia).to.equal('config')
      expect(result.stateName).to.equal('QA')
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: llmResolveState (without actual API call)
  // ---------------------------------------------------------------------------

  describe('llmResolveState', () => {
    it('should return null when ANTHROPIC_API_KEY is not set', async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY
      delete process.env.ANTHROPIC_API_KEY

      const result = await llmResolveState(
        [{ id: 'st-1', name: 'Review' }],
        'review',
      )
      expect(result).to.be.null

      if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: Multi-board / cross-provider scenarios
  // ---------------------------------------------------------------------------

  describe('Cross-provider state resolution', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
    })

    afterEach(() => {
      db.close()
    })

    it('should resolve states from a Linear-like board', async () => {
      const moveCalls: Array<{ ticketId: string; stateId: string }> = []
      const provider = createMockPMProvider([
        { id: 'lin-1', name: 'Triage' },
        { id: 'lin-2', name: 'Backlog' },
        { id: 'lin-3', name: 'In Progress' },
        { id: 'lin-4', name: 'In Review' },
        { id: 'lin-5', name: 'Done' },
        { id: 'lin-6', name: 'Canceled' },
      ], moveCalls)

      const result = await move(provider, 'TKT-1', 'review', db)
      expect(result.success).to.be.true
      expect(result.stateName).to.equal('In Review')
    })

    it('should resolve states from a Trello-like board', async () => {
      const moveCalls: Array<{ ticketId: string; stateId: string }> = []
      const provider = createMockPMProvider([
        { id: 'tr-1', name: 'To Do' },
        { id: 'tr-2', name: 'Doing' },
        { id: 'tr-3', name: 'QA' },
        { id: 'tr-4', name: 'Done' },
      ], moveCalls)

      const result = await move(provider, 'TKT-1', 'active', db)
      expect(result.success).to.be.true
      expect(result.stateName).to.equal('Doing')
    })

    it('should resolve states from a ClickUp-like board', async () => {
      const moveCalls: Array<{ ticketId: string; stateId: string }> = []
      const provider = createMockPMProvider([
        { id: 'cu-1', name: 'Open' },
        { id: 'cu-2', name: 'In Development' },
        { id: 'cu-3', name: 'Needs Review' },
        { id: 'cu-4', name: 'Complete' },
      ], moveCalls)

      // Test 'active' resolves to 'In Development'
      let result = await move(provider, 'TKT-1', 'active', db)
      expect(result.success).to.be.true
      expect(result.stateName).to.equal('In Development')

      // Test 'review' resolves to 'Needs Review'
      result = await move(provider, 'TKT-1', 'review', db)
      expect(result.success).to.be.true
      expect(result.stateName).to.equal('Needs Review')

      // Test 'done' resolves to 'Complete'
      result = await move(provider, 'TKT-1', 'done', db)
      expect(result.success).to.be.true
      expect(result.stateName).to.equal('Complete')
    })
  })
})
