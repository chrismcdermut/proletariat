import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  createHQConfig,
  createPMODirectories,
  type TestEnvironment,
} from './test-helpers.js'
import { LinearMapper } from '../../src/lib/linear/mapper.js'
import { resolveTicketProvider } from '../../src/lib/providers/resolver.js'
import type { ProviderStorage } from '../../src/lib/providers/types.js'
import type { Ticket, TicketFilter, CreateTicketInput } from '../../src/lib/pmo/types.js'
import {
  saveLinearApiKey,
  saveLinearDefaultTeam,
} from '../../src/lib/linear/config.js'
import { findMatchingLinearState } from '../../src/lib/external-issues/outbound-sync.js'

/**
 * Auto-Transition Provider Tests (PRLT-1003)
 *
 * Verifies that when work ready / work complete / pr merge runs,
 * the ticket provider is resolved correctly so that status changes
 * propagate to external providers (e.g., Linear).
 */

// =============================================================================
// Helpers
// =============================================================================

function createMockStorage(overrides?: {
  ticket?: Partial<Ticket> | null
}): ProviderStorage {
  return {
    getTicket: async (id: string) => {
      if (overrides?.ticket === null) return null
      return {
        id,
        title: 'Test ticket',
        projectId: 'test-project',
        statusId: 'in-progress',
        statusName: 'In Progress',
        statusCategory: 'started',
        subtasks: [],
        labels: [],
        metadata: {
          external_source: 'linear',
          external_key: 'ENG-123',
          external_id: 'lin-123',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides?.ticket,
      } as Ticket
    },
    getProjectBoard: async () => ({
      columns: [
        { name: 'Backlog' },
        { name: 'In Progress' },
        { name: 'In Review' },
        { name: 'Done' },
      ],
    }),
    moveTicket: async (projectId: string, ticketId: string, columnName: string) => {
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
    deleteTicket: async () => {},
    listTickets: async () => [],
    createTicket: async (projectId: string, input: CreateTicketInput) => {
      return {
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
      } as Ticket
    },
    getDatabase: () => null as any,
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('Auto-Transition Provider Resolution (PRLT-1003)', () => {
  let env: TestEnvironment
  let db: Database.Database

  beforeEach(() => {
    env = createTestEnvironment('auto-transition-')
    createHQConfig(env.proletariatDir)
    createPMODirectories(env.pmoPath)
    db = setupProductionSchema(env.dbPath, env.pmoPath)
    db.exec(`CREATE TABLE IF NOT EXISTS workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  })

  afterEach(() => {
    if (db) db.close()
    cleanupTestEnvironment(env)
  })

  it('should resolve Linear provider for tickets imported from Linear', () => {
    // Set up Linear config
    saveLinearApiKey(db, 'test-api-key')
    saveLinearDefaultTeam(db, 'team-eng-id', 'ENG')

    // Create Linear mapping with inbound direction
    const mapper = new LinearMapper(db)
    db.exec(`INSERT OR IGNORE INTO pmo_projects (id, name, status) VALUES ('proj-1', 'Test Project', 'active')`)
    db.exec(`INSERT OR IGNORE INTO pmo_tickets (id, project_id, title, status) VALUES ('TKT-001', 'proj-1', 'Test Ticket', 'In Progress')`)
    mapper.createMapping({
      pmoTicketId: 'TKT-001',
      linearIssueId: 'lin-001',
      linearIdentifier: 'ENG-001',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-001',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const storage = createMockStorage()
    const provider = resolveTicketProvider(
      'TKT-001',
      'proj-1',
      db,
      storage,
      { external_source: 'linear' },
    )

    expect(provider.name).to.equal('linear')
  })

  it('should resolve PMO provider for tickets without external source', () => {
    const storage = createMockStorage()
    const provider = resolveTicketProvider(
      'TKT-002',
      'proj-1',
      db,
      storage,
      {},
    )

    expect(provider.name).to.equal('pmo')
  })

  it('should resolve PMO provider when Linear is not configured', () => {
    const storage = createMockStorage()
    const provider = resolveTicketProvider(
      'TKT-003',
      'proj-1',
      db,
      storage,
      { external_source: 'linear' },
    )

    // No Linear config → falls back to PMO
    expect(provider.name).to.equal('pmo')
  })
})

describe('findMatchingLinearState – Review and Done mapping', () => {
  const mockStates = [
    { id: 'ls-backlog', name: 'Backlog', type: 'backlog' },
    { id: 'ls-todo', name: 'Todo', type: 'unstarted' },
    { id: 'ls-progress', name: 'In Progress', type: 'started' },
    { id: 'ls-review', name: 'In Review', type: 'started' },
    { id: 'ls-done', name: 'Done', type: 'completed' },
  ]

  it('should match "In Review" status by exact name', () => {
    const match = findMatchingLinearState(mockStates, 'In Review', 'started')
    expect(match).to.exist
    expect(match!.name).to.equal('In Review')
    expect(match!.id).to.equal('ls-review')
  })

  it('should match "Done" status by exact name', () => {
    const match = findMatchingLinearState(mockStates, 'Done', 'completed')
    expect(match).to.exist
    expect(match!.name).to.equal('Done')
    expect(match!.id).to.equal('ls-done')
  })

  it('should fall back to category match when name does not match', () => {
    const match = findMatchingLinearState(mockStates, 'Completed', 'completed')
    expect(match).to.exist
    expect(match!.type).to.equal('completed')
    expect(match!.id).to.equal('ls-done')
  })
})
