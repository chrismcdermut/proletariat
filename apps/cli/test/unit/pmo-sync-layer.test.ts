/**
 * PMO Sync Layer Tests (PRLT-1230)
 *
 * Tests for:
 * 1. EventEmittingProvider.updateTicket() emits work:pr_created
 * 2. LinearMapper.importIssue() updates statusId on existing tickets
 * 3. LinearMapper.issueToTicketInput() maps status category correctly
 * 4. LINEAR_STATE_TO_PMO_CATEGORY mapping completeness
 */

import { expect } from 'chai'
import Database from 'better-sqlite3'
import { resetEventBus, getEventBus } from '../../src/lib/events/index.js'
import { EventEmittingProvider } from '../../src/lib/providers/event-emitting-provider.js'
import type {
  TicketProvider,
  ProviderMoveResult,
  ProviderDeleteResult,
  ProviderListResult,
  ProviderCreateResult,
  ProviderGetResult,
  ProviderUpdateResult,
  ProviderAssignResult,
} from '../../src/lib/providers/types.js'
import type { TicketPRLinkedEvent } from '../../src/lib/events/events.js'
import type { WorkPRCreatedEvent } from '../../src/lib/work-lifecycle/events.js'
import type { Ticket, UpdateTicketInput } from '../../src/lib/pmo/types.js'
import { LINEAR_STATE_TO_PMO_CATEGORY } from '../../src/lib/linear/types.js'
import { LinearMapper } from '../../src/lib/linear/mapper.js'
import type { LinearIssue } from '../../src/lib/linear/types.js'
import type { WorkflowStatus } from '../../src/lib/pmo/types.js'

// =============================================================================
// Mock Provider
// =============================================================================

class MockProvider implements TicketProvider {
  readonly name = 'pmo' as const
  updateResult: ProviderUpdateResult = { success: true, provider: 'pmo' }
  updateCalls: Array<{ ticketId: string; input: UpdateTicketInput }> = []

  async moveTicket(): Promise<ProviderMoveResult> { return { success: true, provider: 'pmo' } }
  async deleteTicket(): Promise<ProviderDeleteResult> { return { success: true, provider: 'pmo' } }
  async listTickets(): Promise<ProviderListResult> { return { success: true, provider: 'pmo', tickets: [] } }
  async createTicket(): Promise<ProviderCreateResult> { return { success: true, provider: 'pmo' } }
  async getTicket(): Promise<ProviderGetResult> { return { success: true, provider: 'pmo', ticket: null } }
  async updateTicket(ticketId: string, input: UpdateTicketInput): Promise<ProviderUpdateResult> {
    this.updateCalls.push({ ticketId, input })
    return this.updateResult
  }
  async assignTicket(): Promise<ProviderAssignResult> { return { success: true, provider: 'pmo' } }
}

// =============================================================================
// Mock PMO Storage for LinearMapper tests
// =============================================================================

function createMockStorage(db: Database.Database) {
  const tickets = new Map<string, Ticket>()
  let ticketCounter = 0

  return {
    tickets,
    storage: {
      createTicket: async (_projectId: string, input: Record<string, unknown>): Promise<Ticket> => {
        ticketCounter++
        const ticket: Ticket = {
          id: `TKT-${String(ticketCounter).padStart(3, '0')}`,
          title: input.title as string,
          description: input.description as string | undefined,
          priority: input.priority as string | undefined,
          statusId: input.statusId as string || 'default-status',
          assignee: input.assignee as string | undefined,
          subtasks: [],
          labels: (input.labels as string[]) || [],
          metadata: (input.metadata as Record<string, string>) || {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        tickets.set(ticket.id, ticket)
        // Also insert into DB so that FK constraints on pmo_external_issue_map are satisfied
        db.prepare('INSERT INTO pmo_tickets (id, title) VALUES (?, ?)').run(ticket.id, ticket.title)
        return ticket
      },
      updateTicket: async (id: string, changes: Partial<Ticket>): Promise<Ticket> => {
        const existing = tickets.get(id)
        if (!existing) throw new Error(`Ticket ${id} not found`)
        const updated = { ...existing, ...changes, updatedAt: new Date() }
        tickets.set(id, updated)
        return updated
      },
    },
  }
}

// =============================================================================
// Helper: create in-memory DB with required tables for LinearMapper
// =============================================================================

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')

  // Create minimal PMO tables needed by LinearMapper
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_external_execution_map (
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      external_key TEXT,
      canonical_url TEXT,
      latest_state_snapshot TEXT,
      last_synced_at TIMESTAMP,
      last_spawned_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider, external_id)
    );

    CREATE TABLE IF NOT EXISTS pmo_external_execution_links (
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider, external_id, execution_id),
      FOREIGN KEY (provider, external_id)
        REFERENCES pmo_external_execution_map(provider, external_id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pmo_external_execution_prs (
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      pr_url TEXT NOT NULL,
      linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider, external_id, pr_url),
      FOREIGN KEY (provider, external_id)
        REFERENCES pmo_external_execution_map(provider, external_id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pmo_external_execution_map_external_key
      ON pmo_external_execution_map(provider, external_key);
    CREATE INDEX IF NOT EXISTS idx_pmo_external_execution_links_execution_id
      ON pmo_external_execution_links(execution_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_external_execution_prs_pr_url
      ON pmo_external_execution_prs(pr_url);
  `)

  return db
}

// =============================================================================
// Helper: create a mock LinearIssue
// =============================================================================

function makeLinearIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: 'linear-uuid-1',
    identifier: 'PRLT-100',
    title: 'Test issue',
    description: 'A test issue description',
    priority: 2,
    state: {
      id: 'state-started',
      name: 'In Progress',
      type: 'started',
    },
    team: {
      id: 'team-1',
      key: 'PRLT',
      name: 'Proletariat',
    },
    labels: [],
    url: 'https://linear.app/test/issue/PRLT-100',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// =============================================================================
// Helper: create workflow statuses
// =============================================================================

function makeWorkflowStatuses(): WorkflowStatus[] {
  const now = new Date()
  return [
    { id: 'ws-backlog', name: 'Backlog', category: 'backlog' as const, position: 0, isDefault: true, workflowId: 'wf-1', createdAt: now },
    { id: 'ws-unstarted', name: 'Ready', category: 'unstarted' as const, position: 1, isDefault: false, workflowId: 'wf-1', createdAt: now },
    { id: 'ws-started', name: 'In Progress', category: 'started' as const, position: 2, isDefault: false, workflowId: 'wf-1', createdAt: now },
    { id: 'ws-completed', name: 'Done', category: 'completed' as const, position: 3, isDefault: false, workflowId: 'wf-1', createdAt: now },
    { id: 'ws-canceled', name: 'Canceled', category: 'canceled' as const, position: 4, isDefault: false, workflowId: 'wf-1', createdAt: now },
  ]
}

// =============================================================================
// Tests
// =============================================================================

describe('PMO Sync Layer (PRLT-1230)', () => {
  beforeEach(() => {
    resetEventBus()
  })

  afterEach(() => {
    resetEventBus()
  })

  // ===========================================================================
  // EventEmittingProvider.updateTicket() — PR event emission
  // ===========================================================================

  describe('EventEmittingProvider.updateTicket() — PR event emission', () => {
    it('emits work:pr_created when updateTicket includes pr_url in metadata', async () => {
      const inner = new MockProvider()
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const prEvents: WorkPRCreatedEvent[] = []
      getEventBus().on('work:pr_created', (e) => prEvents.push(e))

      await provider.updateTicket('TKT-42', {
        metadata: {
          pr_url: 'https://github.com/test/repo/pull/123',
          pr_title: 'feat: add feature',
        },
      } as UpdateTicketInput)

      expect(prEvents).to.have.lengthOf(1)
      expect(prEvents[0].workItemId).to.equal('TKT-42')
      expect(prEvents[0].prUrl).to.equal('https://github.com/test/repo/pull/123')
      expect(prEvents[0].prTitle).to.equal('feat: add feature')
      expect(prEvents[0].projectId).to.equal('project-1')
    })

    it('emits ticket:pr_linked when updateTicket includes pr_url in metadata', async () => {
      const inner = new MockProvider()
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const linkEvents: TicketPRLinkedEvent[] = []
      getEventBus().on('ticket:pr_linked', (e) => linkEvents.push(e))

      await provider.updateTicket('TKT-42', {
        metadata: {
          pr_url: 'https://github.com/test/repo/pull/456',
        },
      } as UpdateTicketInput)

      expect(linkEvents).to.have.lengthOf(1)
      expect(linkEvents[0].ticketId).to.equal('TKT-42')
      expect(linkEvents[0].prUrl).to.equal('https://github.com/test/repo/pull/456')
    })

    it('does not emit PR events when no pr_url in metadata', async () => {
      const inner = new MockProvider()
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const prEvents: WorkPRCreatedEvent[] = []
      getEventBus().on('work:pr_created', (e) => prEvents.push(e))

      await provider.updateTicket('TKT-42', {
        title: 'Updated title',
        metadata: { some_key: 'some_value' },
      } as UpdateTicketInput)

      expect(prEvents).to.have.lengthOf(0)
    })

    it('does not emit PR events when update has no metadata', async () => {
      const inner = new MockProvider()
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const prEvents: WorkPRCreatedEvent[] = []
      getEventBus().on('work:pr_created', (e) => prEvents.push(e))

      await provider.updateTicket('TKT-42', {
        title: 'Updated title',
      } as UpdateTicketInput)

      expect(prEvents).to.have.lengthOf(0)
    })

    it('does not emit PR events when updateTicket fails', async () => {
      const inner = new MockProvider()
      inner.updateResult = { success: false, provider: 'pmo', error: 'not found' }
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const prEvents: WorkPRCreatedEvent[] = []
      getEventBus().on('work:pr_created', (e) => prEvents.push(e))

      await provider.updateTicket('TKT-42', {
        metadata: { pr_url: 'https://github.com/test/repo/pull/789' },
      } as UpdateTicketInput)

      expect(prEvents).to.have.lengthOf(0)
    })

    it('pr_title defaults to null when not provided in metadata', async () => {
      const inner = new MockProvider()
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const prEvents: WorkPRCreatedEvent[] = []
      getEventBus().on('work:pr_created', (e) => prEvents.push(e))

      await provider.updateTicket('TKT-42', {
        metadata: { pr_url: 'https://github.com/test/repo/pull/100' },
      } as UpdateTicketInput)

      expect(prEvents).to.have.lengthOf(1)
      expect(prEvents[0].prTitle).to.be.null
    })
  })

  // ===========================================================================
  // LinearMapper.importIssue() — statusId sync on update
  // ===========================================================================

  describe('LinearMapper.importIssue() — statusId sync', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
    })

    afterEach(() => {
      db.close()
    })

    it('includes statusId when updating existing mapped tickets', async () => {
      const mapper = new LinearMapper(db)
      const mockStorage = createMockStorage(db)
      const statuses = makeWorkflowStatuses()

      // First import — creates the ticket with In Progress status
      const issue = makeLinearIssue({ state: { id: 's1', name: 'In Progress', type: 'started' } })
      const result1 = await mapper.importIssue(issue, 'proj-1', mockStorage.storage as never, statuses)
      expect(result1.created).to.be.true
      expect(result1.updated).to.be.false

      const createdTicket = mockStorage.tickets.get(result1.ticketId)!
      expect(createdTicket.statusId).to.equal('ws-started')

      // Second import — same issue, different state (now completed)
      const updatedIssue = makeLinearIssue({ state: { id: 's2', name: 'Done', type: 'completed' } })
      const result2 = await mapper.importIssue(updatedIssue, 'proj-1', mockStorage.storage as never, statuses)
      expect(result2.created).to.be.false
      expect(result2.updated).to.be.true
      expect(result2.ticketId).to.equal(result1.ticketId)

      // Verify statusId was updated (this is the regression that PRLT-1230 fixes)
      const updatedTicket = mockStorage.tickets.get(result2.ticketId)!
      expect(updatedTicket.statusId).to.equal('ws-completed')
    })

    it('maps backlog state type to backlog status', async () => {
      const mapper = new LinearMapper(db)
      const mockStorage = createMockStorage(db)
      const statuses = makeWorkflowStatuses()

      const issue = makeLinearIssue({ state: { id: 's1', name: 'Backlog', type: 'backlog' } })
      const result = await mapper.importIssue(issue, 'proj-1', mockStorage.storage as never, statuses)

      const ticket = mockStorage.tickets.get(result.ticketId)!
      expect(ticket.statusId).to.equal('ws-backlog')
    })

    it('maps unstarted state type to Ready status', async () => {
      const mapper = new LinearMapper(db)
      const mockStorage = createMockStorage(db)
      const statuses = makeWorkflowStatuses()

      const issue = makeLinearIssue({ state: { id: 's1', name: 'Todo', type: 'unstarted' } })
      const result = await mapper.importIssue(issue, 'proj-1', mockStorage.storage as never, statuses)

      const ticket = mockStorage.tickets.get(result.ticketId)!
      expect(ticket.statusId).to.equal('ws-unstarted')
    })

    it('creates mapping in pmo_external_issue_map on first import', async () => {
      const mapper = new LinearMapper(db)
      const mockStorage = createMockStorage(db)
      const statuses = makeWorkflowStatuses()

      const issue = makeLinearIssue()
      await mapper.importIssue(issue, 'proj-1', mockStorage.storage as never, statuses)

      // Verify the mapping was created
      const mapping = mapper.getByLinearId('linear-uuid-1')
      expect(mapping).to.not.be.null
      expect(mapping!.linearIssueId).to.equal('linear-uuid-1')
      expect(mapping!.linearIdentifier).to.equal('PRLT-100')
      expect(mapping!.syncDirection).to.equal('inbound')
    })

    it('is idempotent — does not create duplicate mappings', async () => {
      const mapper = new LinearMapper(db)
      const mockStorage = createMockStorage(db)
      const statuses = makeWorkflowStatuses()

      const issue = makeLinearIssue()
      await mapper.importIssue(issue, 'proj-1', mockStorage.storage as never, statuses)
      await mapper.importIssue(issue, 'proj-1', mockStorage.storage as never, statuses)

      // Should still have only 1 mapping and 1 ticket
      const mappings = mapper.listMappings()
      expect(mappings).to.have.lengthOf(1)
      expect(mockStorage.tickets.size).to.equal(1)
    })
  })

  // ===========================================================================
  // LinearMapper.issueToTicketInput() — status mapping
  // ===========================================================================

  describe('LinearMapper.issueToTicketInput() — status mapping', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
    })

    afterEach(() => {
      db.close()
    })

    it('maps started state type to started category status', () => {
      const mapper = new LinearMapper(db)
      const statuses = makeWorkflowStatuses()
      const issue = makeLinearIssue({ state: { id: 's1', name: 'In Progress', type: 'started' } })

      const input = mapper.issueToTicketInput(issue, statuses)
      expect(input.statusId).to.equal('ws-started')
    })

    it('maps completed state type to completed category status', () => {
      const mapper = new LinearMapper(db)
      const statuses = makeWorkflowStatuses()
      const issue = makeLinearIssue({ state: { id: 's1', name: 'Done', type: 'completed' } })

      const input = mapper.issueToTicketInput(issue, statuses)
      expect(input.statusId).to.equal('ws-completed')
    })

    it('maps backlog state type to backlog category status', () => {
      const mapper = new LinearMapper(db)
      const statuses = makeWorkflowStatuses()
      const issue = makeLinearIssue({ state: { id: 's1', name: 'Backlog', type: 'backlog' } })

      const input = mapper.issueToTicketInput(issue, statuses)
      expect(input.statusId).to.equal('ws-backlog')
    })

    it('falls back to default status for unknown state type', () => {
      const mapper = new LinearMapper(db)
      const statuses = makeWorkflowStatuses()
      const issue = makeLinearIssue({ state: { id: 's1', name: 'Custom', type: 'custom_unknown' as string } })

      const input = mapper.issueToTicketInput(issue, statuses)
      // Falls back to default status (Backlog is default)
      expect(input.statusId).to.equal('ws-backlog')
    })

    it('stores Linear state name in metadata', () => {
      const mapper = new LinearMapper(db)
      const statuses = makeWorkflowStatuses()
      const issue = makeLinearIssue({ state: { id: 's1', name: 'Review Requested', type: 'started' } })

      const input = mapper.issueToTicketInput(issue, statuses)
      expect(input.metadata?.['linear.state']).to.equal('Review Requested')
    })
  })

  // ===========================================================================
  // LINEAR_STATE_TO_PMO_CATEGORY mapping completeness
  // ===========================================================================

  describe('LINEAR_STATE_TO_PMO_CATEGORY', () => {
    it('maps all Linear state types to PMO categories', () => {
      const linearStateTypes = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']

      for (const stateType of linearStateTypes) {
        expect(LINEAR_STATE_TO_PMO_CATEGORY[stateType], `Missing mapping for "${stateType}"`).to.be.a('string')
      }
    })

    it('maps started to started (for In Progress tickets)', () => {
      expect(LINEAR_STATE_TO_PMO_CATEGORY['started']).to.equal('started')
    })

    it('maps completed to completed (for Done tickets)', () => {
      expect(LINEAR_STATE_TO_PMO_CATEGORY['completed']).to.equal('completed')
    })

    it('maps backlog to backlog', () => {
      expect(LINEAR_STATE_TO_PMO_CATEGORY['backlog']).to.equal('backlog')
    })

    it('maps unstarted to unstarted (for Ready tickets)', () => {
      expect(LINEAR_STATE_TO_PMO_CATEGORY['unstarted']).to.equal('unstarted')
    })
  })
})
