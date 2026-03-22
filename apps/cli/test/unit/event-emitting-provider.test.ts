import { expect } from 'chai'
import { EventBus, resetEventBus, getEventBus } from '../../src/lib/events/index.js'
import { EventEmittingProvider, type StatusResolver } from '../../src/lib/providers/event-emitting-provider.js'
import type {
  TicketProvider,
  ProviderMoveResult,
  ProviderDeleteResult,
  ProviderListResult,
  ProviderCreateResult,
  ProviderGetResult,
  ProviderUpdateResult,
  ProviderCommentResult,
} from '../../src/lib/providers/types.js'
import type { TicketStatusChangedEvent, TicketPRLinkedEvent } from '../../src/lib/events/events.js'
import type { WorkStatusChangedEvent, WorkStartedEvent, WorkCompletedEvent, WorkPRCreatedEvent } from '../../src/lib/work-lifecycle/events.js'
import type { StateCategory, TicketFilter, CreateTicketInput, Ticket } from '../../src/lib/pmo/types.js'

// =============================================================================
// Mock Provider
// =============================================================================

class MockProvider implements TicketProvider {
  readonly name = 'pmo' as const
  moveResult: ProviderMoveResult = { success: true, provider: 'pmo' }
  deleteResult: ProviderDeleteResult = { success: true, provider: 'pmo' }
  listResult: ProviderListResult = { success: true, provider: 'pmo', tickets: [] }
  createResult: ProviderCreateResult = { success: true, provider: 'pmo' }
  getResult: ProviderGetResult = { success: true, provider: 'pmo', ticket: null }

  async moveTicket(): Promise<ProviderMoveResult> { return this.moveResult }
  async deleteTicket(): Promise<ProviderDeleteResult> { return this.deleteResult }
  async listTickets(): Promise<ProviderListResult> { return this.listResult }
  async createTicket(): Promise<ProviderCreateResult> { return this.createResult }
  async getTicket(): Promise<ProviderGetResult> { return this.getResult }
  async updateTicket(): Promise<ProviderUpdateResult> { return { success: true, provider: 'pmo' } }
  async addComment(): Promise<ProviderCommentResult> { return { success: true, provider: 'pmo' } }
}

class MockLinearProvider implements TicketProvider {
  readonly name = 'linear' as const
  moveResult: ProviderMoveResult = { success: true, provider: 'linear' }
  async moveTicket(): Promise<ProviderMoveResult> { return this.moveResult }
  async deleteTicket(): Promise<ProviderDeleteResult> { return { success: true, provider: 'linear' } }
  async listTickets(): Promise<ProviderListResult> { return { success: true, provider: 'linear', tickets: [] } }
  async createTicket(): Promise<ProviderCreateResult> { return { success: true, provider: 'linear' } }
  async getTicket(): Promise<ProviderGetResult> { return { success: true, provider: 'linear', ticket: null } }
  async updateTicket(): Promise<ProviderUpdateResult> { return { success: true, provider: 'linear' } }
  async addComment(): Promise<ProviderCommentResult> { return { success: true, provider: 'linear' } }
}

// =============================================================================
// Mock Status Resolver
// =============================================================================

function createMockResolver(overrides?: Partial<StatusResolver>): StatusResolver {
  return {
    resolveStatusByName: (_projectId, statusName) => ({
      id: `status-${statusName.toLowerCase().replace(/\s/g, '-')}`,
      name: statusName,
      category: statusName.toLowerCase().includes('progress') ? 'started'
        : statusName.toLowerCase().includes('done') ? 'completed'
        : 'unstarted' as StateCategory,
    }),
    getTicketStatus: () => ({
      statusId: 'status-backlog',
      statusName: 'Backlog',
      statusCategory: 'backlog' as StateCategory,
    }),
    ...overrides,
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('EventEmittingProvider', () => {
  beforeEach(() => {
    resetEventBus()
  })

  afterEach(() => {
    resetEventBus()
  })

  describe('moveTicket()', () => {
    it('emits work:status_changed after successful move', async () => {
      const inner = new MockProvider()
      const resolver = createMockResolver()
      const provider = new EventEmittingProvider(inner, resolver, 'project-1')

      const events: WorkStatusChangedEvent[] = []
      getEventBus().on('work:status_changed', (e) => events.push(e))

      await provider.moveTicket('TKT-1', 'In Progress')

      expect(events).to.have.lengthOf(1)
      expect(events[0].workItemId).to.equal('TKT-1')
      expect(events[0].source).to.equal('pmo')
      expect(events[0].newStatus).to.equal('In Progress')
      expect(events[0].previousStatus).to.equal('Backlog')
    })

    it('emits ticket:status_changed for backward compatibility', async () => {
      const inner = new MockProvider()
      const resolver = createMockResolver()
      const provider = new EventEmittingProvider(inner, resolver, 'project-1')

      const events: TicketStatusChangedEvent[] = []
      getEventBus().on('ticket:status_changed', (e) => events.push(e))

      await provider.moveTicket('TKT-1', 'In Progress')

      expect(events).to.have.lengthOf(1)
      expect(events[0].ticketId).to.equal('TKT-1')
      expect(events[0].projectId).to.equal('project-1')
      expect(events[0].newStatusName).to.equal('In Progress')
    })

    it('emits work:started when entering started category', async () => {
      const inner = new MockProvider()
      const resolver = createMockResolver()
      const provider = new EventEmittingProvider(inner, resolver, 'project-1')

      const events: WorkStartedEvent[] = []
      getEventBus().on('work:started', (e) => events.push(e))

      await provider.moveTicket('TKT-1', 'In Progress')

      expect(events).to.have.lengthOf(1)
      expect(events[0].workItemId).to.equal('TKT-1')
      expect(events[0].source).to.equal('pmo')
      expect(events[0].status).to.equal('In Progress')
    })

    it('emits work:completed when entering completed category', async () => {
      const inner = new MockProvider()
      const resolver = createMockResolver({
        getTicketStatus: () => ({
          statusId: 'status-review',
          statusName: 'Review',
          statusCategory: 'started' as StateCategory,
        }),
      })
      const provider = new EventEmittingProvider(inner, resolver, 'project-1')

      const events: WorkCompletedEvent[] = []
      getEventBus().on('work:completed', (e) => events.push(e))

      await provider.moveTicket('TKT-1', 'Done')

      expect(events).to.have.lengthOf(1)
      expect(events[0].workItemId).to.equal('TKT-1')
      expect(events[0].status).to.equal('Done')
    })

    it('does not emit work:started if already in started category', async () => {
      const inner = new MockProvider()
      const resolver = createMockResolver({
        getTicketStatus: () => ({
          statusId: 'status-in-progress',
          statusName: 'In Progress',
          statusCategory: 'started' as StateCategory,
        }),
        resolveStatusByName: () => ({
          id: 'status-review',
          name: 'Review',
          category: 'started' as StateCategory,
        }),
      })
      const provider = new EventEmittingProvider(inner, resolver, 'project-1')

      const events: WorkStartedEvent[] = []
      getEventBus().on('work:started', (e) => events.push(e))

      await provider.moveTicket('TKT-1', 'Review')

      expect(events).to.have.lengthOf(0)
    })

    it('does not emit events on failed move', async () => {
      const inner = new MockProvider()
      inner.moveResult = { success: false, provider: 'pmo', error: 'not found' }
      const resolver = createMockResolver()
      const provider = new EventEmittingProvider(inner, resolver, 'project-1')

      const events: WorkStatusChangedEvent[] = []
      getEventBus().on('work:status_changed', (e) => events.push(e))

      await provider.moveTicket('TKT-1', 'In Progress')

      expect(events).to.have.lengthOf(0)
    })

    it('uses correct source for Linear provider', async () => {
      const inner = new MockLinearProvider()
      const resolver = createMockResolver()
      const provider = new EventEmittingProvider(inner, resolver, 'project-1')

      const events: WorkStatusChangedEvent[] = []
      getEventBus().on('work:status_changed', (e) => events.push(e))

      await provider.moveTicket('TKT-1', 'In Progress')

      expect(events).to.have.lengthOf(1)
      expect(events[0].source).to.equal('linear')
    })

    it('works without a status resolver (graceful degradation)', async () => {
      const inner = new MockProvider()
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const events: WorkStatusChangedEvent[] = []
      getEventBus().on('work:status_changed', (e) => events.push(e))

      await provider.moveTicket('TKT-1', 'In Progress')

      expect(events).to.have.lengthOf(1)
      expect(events[0].newStatus).to.equal('In Progress')
      expect(events[0].newCategory).to.be.null
      expect(events[0].previousStatus).to.be.null
    })
  })

  describe('createTicket()', () => {
    it('emits work:pr_created when ticket has PR metadata', async () => {
      const inner = new MockProvider()
      inner.createResult = {
        success: true,
        provider: 'pmo',
        ticket: {
          id: 'TKT-99',
          title: 'Test ticket',
          projectId: 'project-1',
          statusId: 'status-1',
          subtasks: [],
          labels: [],
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Ticket,
      }
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const prEvents: WorkPRCreatedEvent[] = []
      getEventBus().on('work:pr_created', (e) => prEvents.push(e))

      const linkEvents: TicketPRLinkedEvent[] = []
      getEventBus().on('ticket:pr_linked', (e) => linkEvents.push(e))

      await provider.createTicket('project-1', {
        title: 'Test',
        metadata: {
          pr_url: 'https://github.com/test/pr/1',
          pr_title: 'Fix bug',
        },
      } as CreateTicketInput)

      expect(prEvents).to.have.lengthOf(1)
      expect(prEvents[0].prUrl).to.equal('https://github.com/test/pr/1')
      expect(prEvents[0].prTitle).to.equal('Fix bug')

      expect(linkEvents).to.have.lengthOf(1)
      expect(linkEvents[0].prUrl).to.equal('https://github.com/test/pr/1')
    })

    it('does not emit PR events when no PR metadata', async () => {
      const inner = new MockProvider()
      inner.createResult = {
        success: true,
        provider: 'pmo',
        ticket: {
          id: 'TKT-99',
          title: 'Test ticket',
          projectId: 'project-1',
          statusId: 'status-1',
          subtasks: [],
          labels: [],
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Ticket,
      }
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const events: WorkPRCreatedEvent[] = []
      getEventBus().on('work:pr_created', (e) => events.push(e))

      await provider.createTicket('project-1', {
        title: 'Test',
      } as CreateTicketInput)

      expect(events).to.have.lengthOf(0)
    })
  })

  describe('passthrough operations', () => {
    it('delegates deleteTicket without events', async () => {
      const inner = new MockProvider()
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const result = await provider.deleteTicket('TKT-1')
      expect(result.success).to.be.true
    })

    it('delegates listTickets without events', async () => {
      const inner = new MockProvider()
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const result = await provider.listTickets()
      expect(result.success).to.be.true
    })

    it('delegates getTicket without events', async () => {
      const inner = new MockProvider()
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const result = await provider.getTicket('TKT-1')
      expect(result.success).to.be.true
    })
  })

  describe('provider name', () => {
    it('inherits name from inner provider', () => {
      const pmo = new EventEmittingProvider(new MockProvider(), null, 'p')
      expect(pmo.name).to.equal('pmo')

      const linear = new EventEmittingProvider(new MockLinearProvider(), null, 'p')
      expect(linear.name).to.equal('linear')
    })
  })
})
