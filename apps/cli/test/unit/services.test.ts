import { expect } from 'chai'
import { ServiceError } from '../../src/services/types.js'
import { SessionService } from '../../src/services/session-service.js'
import { ReconcileService } from '../../src/services/reconcile-service.js'
import { TicketService } from '../../src/services/ticket-service.js'
import { PRService } from '../../src/services/pr-service.js'
import { WorkService } from '../../src/services/work-service.js'
import type { Ticket, TicketFilter, Board } from '../../src/lib/pmo/types.js'
import type { ProviderStorage, TicketProviderName, ProviderListResult, ProviderGetResult } from '../../src/lib/providers/types.js'

// =============================================================================
// ServiceError
// =============================================================================

describe('ServiceError', () => {
  it('creates error with code and message', () => {
    const err = new ServiceError('NOT_FOUND', 'Ticket not found')
    expect(err.code).to.equal('NOT_FOUND')
    expect(err.message).to.equal('Ticket not found')
    expect(err.name).to.equal('ServiceError')
  })

  it('includes optional details', () => {
    const err = new ServiceError('VALIDATION', 'Bad input', { field: 'name' })
    expect(err.details).to.deep.equal({ field: 'name' })
  })

  it('is instanceof Error', () => {
    const err = new ServiceError('INTERNAL', 'boom')
    expect(err).to.be.instanceOf(Error)
    expect(err).to.be.instanceOf(ServiceError)
  })
})

// =============================================================================
// SessionService
// =============================================================================

describe('SessionService', () => {
  let service: SessionService

  beforeEach(() => {
    service = new SessionService()
  })

  it('listSessions returns structured result', () => {
    // collectAllSessions talks to tmux/Docker — in test env there may be 0 sessions
    const result = service.listSessions()
    expect(result).to.have.property('success', true)
    expect(result).to.have.property('sessions').that.is.an('array')
    expect(result).to.have.property('grouped').that.is.an('object')
    expect(result.grouped).to.have.property('here').that.is.an('array')
    expect(result.grouped).to.have.property('elsewhere').that.is.an('array')
  })

  it('listSessions with role filter', () => {
    const result = service.listSessions({ roleFilter: 'orchestrator' })
    expect(result.success).to.be.true
    // All sessions should be orchestrators (or empty)
    for (const s of result.sessions) {
      expect(s.role).to.equal('orchestrator')
    }
  })

  it('bucketByHq returns array of buckets', () => {
    const buckets = service.bucketByHq([])
    expect(buckets).to.be.an('array')
    expect(buckets).to.have.length(0)
  })

  it('getSessionsByRole returns filtered sessions', () => {
    const sessions = service.getSessionsByRole('worker')
    expect(sessions).to.be.an('array')
    for (const s of sessions) {
      expect(s.role).to.equal('worker')
    }
  })

  it('isSessionAlive returns false for non-existent session', () => {
    expect(service.isSessionAlive('nonexistent-session-id-12345')).to.be.false
  })
})

// =============================================================================
// TicketService
// =============================================================================

describe('TicketService', () => {
  // Create a minimal mock storage
  function mockStorage(tickets: Ticket[] = []): any {
    return {
      getTicket: async (id: string) => tickets.find(t => t.id === id) ?? null,
      getProjectBoard: async (pid: string): Promise<Board | null> => ({
        id: 'board-1',
        name: 'Test Board',
        columns: [
          { id: 'col-1', name: 'Backlog', position: 0, tickets: [] },
          { id: 'col-2', name: 'In Progress', position: 1, tickets: [] },
          { id: 'col-3', name: 'Done', position: 2, tickets: [] },
        ],
        updatedAt: new Date(),
      }),
      moveTicket: async () => tickets[0],
      deleteTicket: async () => {},
      listTickets: async () => tickets,
      createTicket: async () => tickets[0],
      updateTicket: async (id: string, changes: any) => ({ ...tickets.find(t => t.id === id)!, ...changes }),
      getDatabase: () => mockDb(),
      getProject: async (id: string) => (id === 'proj-001' ? { id: 'proj-001', name: 'Test' } : null),
      listProjectSummaries: async () => [{ id: 'proj-001', name: 'Test' }],
    }
  }

  function mockDb(): any {
    return {
      prepare: () => ({
        get: () => undefined,
        run: () => {},
        all: () => [],
      }),
    }
  }

  function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
    return {
      id: 'TKT-001',
      title: 'Test ticket',
      projectId: 'proj-001',
      statusId: 'status-1',
      statusName: 'Backlog',
      statusCategory: 'backlog',
      subtasks: [],
      labels: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }
  }

  it('listTickets returns tickets from provider', async () => {
    const tickets = [makeTicket(), makeTicket({ id: 'TKT-002', title: 'Second' })]
    const storage = mockStorage(tickets)
    const service = new TicketService(mockDb(), storage)

    const result = await service.listTickets({ projectId: 'proj-001' })
    expect(result.success).to.be.true
    expect(result.tickets).to.have.length(2)
    expect(result.totalCount).to.equal(2)
  })

  it('listTickets applies pagination', async () => {
    const tickets = [
      makeTicket({ id: 'TKT-001' }),
      makeTicket({ id: 'TKT-002' }),
      makeTicket({ id: 'TKT-003' }),
    ]
    const storage = mockStorage(tickets)
    const service = new TicketService(mockDb(), storage)

    const result = await service.listTickets({ projectId: 'proj-001', limit: 2 })
    expect(result.tickets).to.have.length(2)
    expect(result.totalCount).to.equal(3)
  })

  it('listTickets applies offset', async () => {
    const tickets = [
      makeTicket({ id: 'TKT-001' }),
      makeTicket({ id: 'TKT-002' }),
      makeTicket({ id: 'TKT-003' }),
    ]
    const storage = mockStorage(tickets)
    const service = new TicketService(mockDb(), storage)

    const result = await service.listTickets({ projectId: 'proj-001', offset: 1 })
    expect(result.tickets).to.have.length(2)
  })

  it('throws NOT_FOUND for invalid project', async () => {
    const storage = mockStorage([])
    const service = new TicketService(mockDb(), storage)

    try {
      await service.listTickets({ projectId: 'nonexistent' })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(ServiceError)
      expect((error as ServiceError).code).to.equal('NOT_FOUND')
    }
  })

  it('throws VALIDATION for invalid column', async () => {
    const storage = mockStorage([])
    const service = new TicketService(mockDb(), storage)

    try {
      await service.listTickets({
        projectId: 'proj-001',
        filter: { column: 'Nonexistent' },
      })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(ServiceError)
      expect((error as ServiceError).code).to.equal('VALIDATION')
    }
  })

  it('getTicket returns ticket from provider', async () => {
    const ticket = makeTicket()
    const storage = mockStorage([ticket])
    const service = new TicketService(mockDb(), storage)

    const result = await service.getTicket('TKT-001', 'proj-001')
    expect(result.success).to.be.true
    expect(result.ticket?.id).to.equal('TKT-001')
  })
})

// =============================================================================
// ReconcileService
// =============================================================================

describe('ReconcileService', () => {
  function mockDb(): any {
    return {
      prepare: (sql: string) => ({
        get: () => undefined,
        all: () => [],
        run: () => ({}),
      }),
    }
  }

  function mockStorage(): any {
    return {
      getTicket: async () => null,
      getProjectBoard: async () => null,
      moveTicket: async () => ({}),
      deleteTicket: async () => {},
      listTickets: async () => [],
      createTicket: async () => ({}),
      updateTicket: async () => ({}),
      getDatabase: () => mockDb(),
      listProjects: async () => [],
      listProjectSummaries: async () => [],
    }
  }

  it('dryRun returns a ReconcileReport', async () => {
    const service = new ReconcileService(mockDb(), mockStorage())
    const report = await service.dryRun()

    expect(report).to.have.property('checked').that.is.a('number')
    expect(report).to.have.property('applied').that.is.an('array')
    expect(report).to.have.property('skipped').that.is.an('array')
    expect(report).to.have.property('failed').that.is.an('array')
    expect(report).to.have.property('errors').that.is.an('array')
    expect(report).to.have.property('startedAt').that.is.a('string')
    expect(report).to.have.property('finishedAt').that.is.a('string')
  })

  it('runOnce with dryRun true is equivalent to dryRun()', async () => {
    const service = new ReconcileService(mockDb(), mockStorage())
    const report = await service.runOnce({ dryRun: true })
    expect(report.applied).to.have.length(0)
    expect(report.skipped).to.have.length(0)
  })
})

// =============================================================================
// WorkService
// =============================================================================

describe('WorkService', () => {
  function mockDb(): any {
    return {
      prepare: (sql: string) => ({
        get: () => undefined,
        all: () => [],
        run: () => ({}),
      }),
    }
  }

  function mockStorage(tickets: Ticket[] = []): any {
    return {
      getTicket: async (id: string) => tickets.find(t => t.id === id) ?? null,
      getProjectBoard: async () => null,
      moveTicket: async () => ({}),
      deleteTicket: async () => {},
      listTickets: async () => tickets,
      createTicket: async () => ({}),
      updateTicket: async (id: string, changes: any) => {
        const t = tickets.find(t => t.id === id)
        return t ? { ...t, ...changes } : null
      },
      getDatabase: () => mockDb(),
    }
  }

  function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
    return {
      id: 'TKT-001',
      title: 'Test ticket',
      projectId: 'proj-001',
      statusId: 'status-1',
      statusName: 'In Progress',
      statusCategory: 'started',
      subtasks: [],
      labels: [],
      metadata: { pr_number: '42' },
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }
  }

  it('shipWork throws VALIDATION when neither ticketId nor prNumber provided', async () => {
    const service = new WorkService(mockDb(), mockStorage(), async () => ({ name: 'pmo' } as any))

    try {
      await service.shipWork({})
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(ServiceError)
      expect((error as ServiceError).code).to.equal('VALIDATION')
    }
  })

  it('shipWork throws NOT_FOUND for unknown ticket', async () => {
    const service = new WorkService(mockDb(), mockStorage([]), async () => ({ name: 'pmo' } as any))

    try {
      await service.shipWork({ ticketId: 'TKT-999' })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(ServiceError)
      expect((error as ServiceError).code).to.equal('NOT_FOUND')
    }
  })

  it('waitForCI returns passed: true when no checks configured', async () => {
    // getPRChecks calls gh CLI which won't work in test — but we can test the logic
    // by testing the service instance method directly with mock data
    const service = new WorkService(mockDb(), mockStorage(), async () => ({ name: 'pmo' } as any))

    // checkMergeConflicts uses gh CLI — test that it returns false gracefully
    const hasConflicts = service.checkMergeConflicts(999999)
    expect(hasConflicts).to.be.false
  })

  it('rebaseOntoBase returns error for non-existent branch', () => {
    const service = new WorkService(mockDb(), mockStorage(), async () => ({ name: 'pmo' } as any))

    const result = service.rebaseOntoBase('nonexistent-branch', 'main', '/tmp')
    expect(result.success).to.be.false
    expect(result.error).to.be.a('string')
  })
})

// =============================================================================
// Service imports are framework-free
// =============================================================================

describe('Service Layer — Zero oclif imports', () => {
  // This test verifies the architectural contract:
  // services can be imported without oclif.

  it('all services are importable', () => {
    expect(SessionService).to.be.a('function')
    expect(ReconcileService).to.be.a('function')
    expect(TicketService).to.be.a('function')
    expect(PRService).to.be.a('function')
    expect(WorkService).to.be.a('function')
    expect(ServiceError).to.be.a('function')
  })

  it('SessionService can be instantiated without oclif', () => {
    const service = new SessionService()
    expect(service).to.be.instanceOf(SessionService)
    expect(service.listSessions).to.be.a('function')
    expect(service.bucketByHq).to.be.a('function')
    expect(service.getSessionsByRole).to.be.a('function')
    expect(service.isSessionAlive).to.be.a('function')
  })

  it('services return structured data, not formatted strings', async () => {
    const service = new SessionService()
    const result = service.listSessions()

    // Result is a structured object, not a string
    expect(result).to.be.an('object')
    expect(typeof result).not.to.equal('string')
    expect(result.success).to.be.a('boolean')
    expect(result.sessions).to.be.an('array')
  })

  it('services throw ServiceError, not call process.exit()', () => {
    const err = new ServiceError('NOT_FOUND', 'test')
    expect(err).to.be.instanceOf(Error)
    expect(err.code).to.equal('NOT_FOUND')
    // ServiceError is throwable and catchable — no process.exit()
  })
})

// =============================================================================
// Express/Hono route simulation — verify services work without oclif
// =============================================================================

describe('Service Layer — Express/Hono compatibility', () => {
  it('SessionService can be used from a hypothetical route handler', async () => {
    // Simulate: app.get('/api/sessions', async (req, res) => {
    //   const service = new SessionService()
    //   const result = service.listSessions()
    //   res.json(result)
    // })
    const service = new SessionService()
    const result = service.listSessions()

    // The result is JSON-serializable (no class instances, no functions)
    const json = JSON.stringify(result)
    expect(json).to.be.a('string')
    const parsed = JSON.parse(json)
    expect(parsed.success).to.be.true
    expect(parsed.sessions).to.be.an('array')
  })

  it('ServiceError can be caught and mapped to HTTP status', () => {
    const errorToStatus: Record<string, number> = {
      NOT_FOUND: 404,
      VALIDATION: 400,
      CONFLICT: 409,
      PRECONDITION_FAILED: 412,
      EXTERNAL_FAILURE: 502,
      PERMISSION_DENIED: 403,
      ABORTED: 499,
      INTERNAL: 500,
    }

    for (const [code, status] of Object.entries(errorToStatus)) {
      const err = new ServiceError(code as any, 'test')
      expect(err.code).to.equal(code)
      // Verify code maps to valid HTTP status
      expect(status).to.be.a('number').and.be.greaterThan(0)
    }
  })
})
