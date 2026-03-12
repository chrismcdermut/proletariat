import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  createHQConfig,
  createPMODirectories,
  createTestProject,
  type TestEnvironment,
} from './test-helpers.js'
import { LinearMapper } from '../../src/lib/linear/mapper.js'
import type { LinearIssue } from '../../src/lib/linear/types.js'
import type { WorkflowStatus, PMOStorage, Ticket, Subtask, StateCategory } from '../../src/lib/pmo/types.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'

/**
 * Linear Ingest Pipeline Tests
 *
 * Tests the idempotent ingest pipeline that creates/updates PMO tickets
 * from Linear issues. Verifies:
 *   - Field mapping (title, description, priority, labels, assignee, estimate, dueDate)
 *   - Idempotent create (first import creates ticket + mapping)
 *   - Idempotent update (re-import updates ticket fields, no duplicate)
 *   - External reference persistence in metadata
 *   - Batch import with mixed create/update results
 */

// =============================================================================
// Helpers
// =============================================================================

function createMockIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: 'issue-1',
    identifier: 'ENG-123',
    title: 'Fix login bug',
    description: 'Users cannot log in with SSO',
    priority: 2,  // High
    state: {
      id: 'state-1',
      name: 'In Progress',
      type: 'started',
    },
    team: {
      id: 'team-1',
      key: 'ENG',
      name: 'Engineering',
    },
    assignee: {
      id: 'user-1',
      name: 'Alice Smith',
      email: 'alice@example.com',
    },
    labels: [
      { id: 'label-1', name: 'bug', color: '#ff0000' },
    ],
    estimate: 3,
    dueDate: '2025-06-15',
    url: 'https://linear.app/my-company/issue/ENG-123',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    ...overrides,
  }
}

/** In-memory mock statuses for pure field-mapping tests (no DB FK involved) */
const mockWorkflowStatuses: WorkflowStatus[] = [
  { id: 'status-backlog', workflowId: 'wf-1', name: 'Backlog', category: 'backlog', position: 0, isDefault: true, createdAt: new Date() },
  { id: 'status-todo', workflowId: 'wf-1', name: 'Todo', category: 'unstarted', position: 1, createdAt: new Date() },
  { id: 'status-progress', workflowId: 'wf-1', name: 'In Progress', category: 'started', position: 2, createdAt: new Date() },
  { id: 'status-done', workflowId: 'wf-1', name: 'Done', category: 'completed', position: 3, createdAt: new Date() },
  { id: 'status-canceled', workflowId: 'wf-1', name: 'Canceled', category: 'canceled', position: 4, createdAt: new Date() },
]

/** Load real workflow statuses from the production-seeded database */
function loadDbStatuses(db: Database.Database): WorkflowStatus[] {
  const rows = db.prepare(`
    SELECT id, workflow_id, name, category, position, is_default, created_at
    FROM ${PMO_TABLES.workflow_statuses}
    WHERE workflow_id = 'default'
    ORDER BY position ASC
  `).all() as Array<{ id: string; workflow_id: string; name: string; category: string; position: number; is_default: number; created_at: string }>

  return rows.map((r) => ({
    id: r.id,
    workflowId: r.workflow_id,
    name: r.name,
    category: r.category as StateCategory,
    position: r.position,
    isDefault: r.is_default === 1,
    createdAt: new Date(r.created_at),
  }))
}

// =============================================================================
// Field Mapping: Estimate, DueDate, Assignee
// =============================================================================

describe('Linear Ingest – Field Mapping', () => {
  let env: TestEnvironment
  let db: Database.Database
  let mapper: LinearMapper

  beforeEach(() => {
    env = createTestEnvironment('linear-ingest-mapping-')
    createHQConfig(env.proletariatDir)
    createPMODirectories(env.pmoPath)
    db = setupProductionSchema(env.dbPath, env.pmoPath)
    db.exec(`CREATE TABLE IF NOT EXISTS workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    mapper = new LinearMapper(db)
  })

  afterEach(() => {
    if (db) db.close()
    cleanupTestEnvironment(env)
  })

  it('should map assignee to ticket input', () => {
    const issue = createMockIssue({
      assignee: { id: 'u-1', name: 'Bob Jones', email: 'bob@example.com' },
    })
    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)

    expect(input.assignee).to.equal('Bob Jones')
    expect(input.metadata!['linear.assignee']).to.equal('Bob Jones')
    expect(input.metadata!['linear.assignee_email']).to.equal('bob@example.com')
  })

  it('should handle missing assignee gracefully', () => {
    const issue = createMockIssue({ assignee: undefined })
    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)

    expect(input.assignee).to.be.undefined
    expect(input.metadata!['linear.assignee']).to.be.undefined
    expect(input.metadata!['linear.assignee_email']).to.be.undefined
  })

  it('should persist estimate in metadata', () => {
    const issue = createMockIssue({ estimate: 5 })
    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)

    expect(input.metadata!['linear.estimate']).to.equal('5')
  })

  it('should handle missing estimate gracefully', () => {
    const issue = createMockIssue({ estimate: undefined })
    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)

    expect(input.metadata!['linear.estimate']).to.be.undefined
  })

  it('should persist due date in metadata', () => {
    const issue = createMockIssue({ dueDate: '2025-12-31' })
    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)

    expect(input.metadata!['linear.due_date']).to.equal('2025-12-31')
  })

  it('should handle missing due date gracefully', () => {
    const issue = createMockIssue({ dueDate: undefined })
    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)

    expect(input.metadata!['linear.due_date']).to.be.undefined
  })

  it('should map all fields together correctly', () => {
    const issue = createMockIssue({
      title: 'Full mapping test',
      description: 'Complete description',
      priority: 1,
      estimate: 8,
      dueDate: '2025-03-15',
      assignee: { id: 'u-2', name: 'Carol Danvers', email: 'carol@example.com' },
      labels: [
        { id: 'l-1', name: 'feature', color: '#00ff00' },
        { id: 'l-2', name: 'frontend', color: '#0000ff' },
      ],
      state: { id: 's-1', name: 'Todo', type: 'unstarted' },
      team: { id: 't-1', key: 'PLAT', name: 'Platform' },
    })

    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)

    expect(input.title).to.equal('Full mapping test')
    expect(input.description).to.include('Complete description')
    expect(input.priority).to.equal('P0')
    expect(input.assignee).to.equal('Carol Danvers')
    expect(input.labels).to.deep.equal(['feature', 'frontend'])
    expect(input.statusId).to.equal('status-todo')
    expect(input.metadata!['linear.issue_id']).to.equal(issue.id)
    expect(input.metadata!['linear.identifier']).to.equal(issue.identifier)
    expect(input.metadata!['linear.team']).to.equal('PLAT')
    expect(input.metadata!['linear.estimate']).to.equal('8')
    expect(input.metadata!['linear.due_date']).to.equal('2025-03-15')
    expect(input.metadata!['linear.assignee']).to.equal('Carol Danvers')
    expect(input.metadata!['linear.assignee_email']).to.equal('carol@example.com')
  })

  it('should persist external references in metadata (issue ID, key, URL, team)', () => {
    const issue = createMockIssue({
      id: 'ext-ref-id',
      identifier: 'ENG-789',
      url: 'https://linear.app/acme/issue/ENG-789',
      state: { id: 's-1', name: 'Started', type: 'started' },
      team: { id: 't-1', key: 'ENG', name: 'Engineering' },
    })
    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)

    expect(input.metadata!['linear.issue_id']).to.equal('ext-ref-id')
    expect(input.metadata!['linear.identifier']).to.equal('ENG-789')
    expect(input.metadata!['linear.url']).to.equal('https://linear.app/acme/issue/ENG-789')
    expect(input.metadata!['linear.team']).to.equal('ENG')
    expect(input.metadata!['linear.state']).to.equal('Started')
  })
})

// =============================================================================
// Idempotent Import (Create + Update)
// =============================================================================

describe('Linear Ingest – Idempotent Import', () => {
  let env: TestEnvironment
  let db: Database.Database
  let mapper: LinearMapper
  let projectId: string
  let dbStatuses: WorkflowStatus[]

  // Track storage calls
  let storageCreateCalls: Array<{ projectId: string; input: any }>
  let storageUpdateCalls: Array<{ id: string; changes: any }>
  let ticketCounter: number
  let createdTickets: Map<string, any>

  function createMockStorage(): PMOStorage {
    storageCreateCalls = []
    storageUpdateCalls = []
    ticketCounter = 0
    createdTickets = new Map()

    return {
      createTicket: async (projId: string, input: any) => {
        storageCreateCalls.push({ projectId: projId, input })
        ticketCounter++
        const ticketId = `TKT-${ticketCounter}`

        // Insert a real row into the tickets table so FK constraints pass
        db.prepare(`
          INSERT INTO ${PMO_TABLES.tickets} (id, project_id, title, description, status, status_id, priority, category)
          VALUES (?, ?, ?, ?, 'Backlog', ?, ?, NULL)
        `).run(ticketId, projId, input.title, input.description ?? null, input.statusId ?? 'default-backlog', input.priority ?? null)

        const ticket: Ticket = {
          id: ticketId,
          title: input.title,
          description: input.description,
          priority: input.priority,
          assignee: input.assignee,
          statusId: input.statusId ?? 'default-backlog',
          subtasks: [] as Subtask[],
          labels: input.labels ?? [],
          metadata: input.metadata ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        createdTickets.set(ticket.id, ticket)
        return ticket
      },
      updateTicket: async (id: string, changes: any) => {
        storageUpdateCalls.push({ id, changes })
        const existing = createdTickets.get(id) ?? {
          id,
          title: 'original',
          statusId: 'default-backlog',
          subtasks: [],
          labels: [],
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        const updated = { ...existing, ...changes, updatedAt: new Date() }
        createdTickets.set(id, updated)
        return updated as Ticket
      },
    } as any
  }

  beforeEach(() => {
    env = createTestEnvironment('linear-ingest-idempotent-')
    createHQConfig(env.proletariatDir)
    createPMODirectories(env.pmoPath)
    db = setupProductionSchema(env.dbPath, env.pmoPath)
    db.exec(`CREATE TABLE IF NOT EXISTS workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    mapper = new LinearMapper(db)
    projectId = createTestProject(db, { id: 'proj-ingest', name: 'Ingest Test' })
    dbStatuses = loadDbStatuses(db)
  })

  afterEach(() => {
    if (db) db.close()
    cleanupTestEnvironment(env)
  })

  it('should create a new ticket on first import', async () => {
    const mockStorage = createMockStorage()
    const issue = createMockIssue()

    const result = await mapper.importIssue(issue, projectId, mockStorage, dbStatuses)

    expect(result.created).to.be.true
    expect(result.updated).to.be.false
    expect(result.ticketId).to.equal('TKT-1')
    expect(storageCreateCalls).to.have.lengthOf(1)
    expect(storageUpdateCalls).to.have.lengthOf(0)
  })

  it('should create a mapping record on first import', async () => {
    const mockStorage = createMockStorage()
    const issue = createMockIssue({ id: 'lin-new-1', identifier: 'ENG-NEW-1' })

    await mapper.importIssue(issue, projectId, mockStorage, dbStatuses)

    const mapping = mapper.getByLinearId('lin-new-1')
    expect(mapping).to.not.be.null
    expect(mapping!.linearIdentifier).to.equal('ENG-NEW-1')
    expect(mapping!.syncDirection).to.equal('inbound')
  })

  it('should update the existing ticket on re-import (idempotent)', async () => {
    const mockStorage = createMockStorage()
    const issue = createMockIssue({ id: 'lin-idem-1', identifier: 'ENG-IDEM-1' })

    // First import: creates
    const firstResult = await mapper.importIssue(issue, projectId, mockStorage, dbStatuses)
    expect(firstResult.created).to.be.true
    expect(firstResult.updated).to.be.false

    // Second import with updated data: updates
    const updatedIssue = createMockIssue({
      id: 'lin-idem-1',
      identifier: 'ENG-IDEM-1',
      title: 'Updated title from Linear',
      description: 'New description',
      priority: 1,  // Urgent → P0
    })

    const secondResult = await mapper.importIssue(updatedIssue, projectId, mockStorage, dbStatuses)

    expect(secondResult.created).to.be.false
    expect(secondResult.updated).to.be.true
    expect(secondResult.ticketId).to.equal(firstResult.ticketId)  // Same ticket

    // Verify update was called with new data
    expect(storageUpdateCalls).to.have.lengthOf(1)
    expect(storageUpdateCalls[0].id).to.equal(firstResult.ticketId)
    expect(storageUpdateCalls[0].changes.title).to.equal('Updated title from Linear')
    expect(storageUpdateCalls[0].changes.priority).to.equal('P0')
  })

  it('should never create a duplicate ticket for the same Linear issue ID', async () => {
    const mockStorage = createMockStorage()
    const issue = createMockIssue({ id: 'lin-nodup-1' })

    // Import three times
    const r1 = await mapper.importIssue(issue, projectId, mockStorage, dbStatuses)
    const r2 = await mapper.importIssue(issue, projectId, mockStorage, dbStatuses)
    const r3 = await mapper.importIssue(issue, projectId, mockStorage, dbStatuses)

    // All point to the same ticket
    expect(r1.ticketId).to.equal(r2.ticketId)
    expect(r2.ticketId).to.equal(r3.ticketId)

    // Only one create, two updates
    expect(storageCreateCalls).to.have.lengthOf(1)
    expect(storageUpdateCalls).to.have.lengthOf(2)
  })

  it('should update assignee on re-import when assignee changes', async () => {
    const mockStorage = createMockStorage()
    const issue = createMockIssue({
      id: 'lin-assign-1',
      assignee: { id: 'u-1', name: 'Alice', email: 'alice@example.com' },
    })

    await mapper.importIssue(issue, projectId, mockStorage, dbStatuses)

    const updatedIssue = createMockIssue({
      id: 'lin-assign-1',
      assignee: { id: 'u-2', name: 'Bob', email: 'bob@example.com' },
    })

    await mapper.importIssue(updatedIssue, projectId, mockStorage, dbStatuses)

    expect(storageUpdateCalls[0].changes.assignee).to.equal('Bob')
    expect(storageUpdateCalls[0].changes.metadata['linear.assignee']).to.equal('Bob')
    expect(storageUpdateCalls[0].changes.metadata['linear.assignee_email']).to.equal('bob@example.com')
  })

  it('should update estimate and due date on re-import', async () => {
    const mockStorage = createMockStorage()
    const issue = createMockIssue({
      id: 'lin-est-1',
      estimate: 3,
      dueDate: '2025-03-01',
    })

    await mapper.importIssue(issue, projectId, mockStorage, dbStatuses)

    const updatedIssue = createMockIssue({
      id: 'lin-est-1',
      estimate: 8,
      dueDate: '2025-06-01',
    })

    await mapper.importIssue(updatedIssue, projectId, mockStorage, dbStatuses)

    expect(storageUpdateCalls[0].changes.metadata['linear.estimate']).to.equal('8')
    expect(storageUpdateCalls[0].changes.metadata['linear.due_date']).to.equal('2025-06-01')
  })

  it('should update sync timestamp on re-import', async () => {
    const mockStorage = createMockStorage()
    const issue = createMockIssue({ id: 'lin-sync-ts-1', identifier: 'ENG-SYNC-TS' })

    await mapper.importIssue(issue, projectId, mockStorage, dbStatuses)
    const beforeUpdate = mapper.getByLinearId('lin-sync-ts-1')

    // Small delay so timestamp differs
    await new Promise(resolve => setTimeout(resolve, 50))

    await mapper.importIssue(issue, projectId, mockStorage, dbStatuses)
    const afterUpdate = mapper.getByLinearId('lin-sync-ts-1')

    expect(afterUpdate!.lastSyncedAt).to.not.be.undefined
  })
})

// =============================================================================
// Batch Import
// =============================================================================

describe('Linear Ingest – Batch Import', () => {
  let env: TestEnvironment
  let db: Database.Database
  let mapper: LinearMapper
  let projectId: string
  let dbStatuses: WorkflowStatus[]

  let ticketCounter: number
  let createdTickets: Map<string, any>

  function createMockStorage(): PMOStorage {
    ticketCounter = 0
    createdTickets = new Map()

    return {
      createTicket: async (projId: string, input: any) => {
        ticketCounter++
        const ticketId = `TKT-BATCH-${ticketCounter}`

        // Insert a real row into the tickets table so FK constraints pass
        db.prepare(`
          INSERT INTO ${PMO_TABLES.tickets} (id, project_id, title, description, status, status_id, priority, category)
          VALUES (?, ?, ?, ?, 'Backlog', ?, ?, NULL)
        `).run(ticketId, projId, input.title, input.description ?? null, input.statusId ?? 'default-backlog', input.priority ?? null)

        const ticket: Ticket = {
          id: ticketId,
          title: input.title,
          description: input.description,
          priority: input.priority,
          assignee: input.assignee,
          statusId: input.statusId ?? 'default-backlog',
          subtasks: [] as Subtask[],
          labels: input.labels ?? [],
          metadata: input.metadata ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        createdTickets.set(ticket.id, ticket)
        return ticket
      },
      updateTicket: async (id: string, changes: any) => {
        const existing = createdTickets.get(id) ?? {
          id,
          title: 'original',
          statusId: 'default-backlog',
          subtasks: [],
          labels: [],
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        const updated = { ...existing, ...changes, updatedAt: new Date() }
        createdTickets.set(id, updated)
        return updated as Ticket
      },
    } as any
  }

  beforeEach(() => {
    env = createTestEnvironment('linear-ingest-batch-')
    createHQConfig(env.proletariatDir)
    createPMODirectories(env.pmoPath)
    db = setupProductionSchema(env.dbPath, env.pmoPath)
    db.exec(`CREATE TABLE IF NOT EXISTS workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    mapper = new LinearMapper(db)
    projectId = createTestProject(db, { id: 'proj-batch', name: 'Batch Test' })
    dbStatuses = loadDbStatuses(db)
  })

  afterEach(() => {
    if (db) db.close()
    cleanupTestEnvironment(env)
  })

  it('should import multiple new issues and count correctly', async () => {
    const mockStorage = createMockStorage()
    const issues = [
      createMockIssue({ id: 'b-1', identifier: 'ENG-B1', title: 'Issue 1' }),
      createMockIssue({ id: 'b-2', identifier: 'ENG-B2', title: 'Issue 2' }),
      createMockIssue({ id: 'b-3', identifier: 'ENG-B3', title: 'Issue 3' }),
    ]

    const result = await mapper.importIssues(issues, projectId, mockStorage, dbStatuses)

    expect(result.imported).to.equal(3)
    expect(result.updated).to.equal(0)
    expect(result.skipped).to.equal(0)
    expect(result.errors).to.have.lengthOf(0)
  })

  it('should count updates on re-import of existing issues', async () => {
    const mockStorage = createMockStorage()
    const issues = [
      createMockIssue({ id: 'bu-1', identifier: 'ENG-BU1', title: 'Issue 1' }),
      createMockIssue({ id: 'bu-2', identifier: 'ENG-BU2', title: 'Issue 2' }),
    ]

    // First import: 2 created
    await mapper.importIssues(issues, projectId, mockStorage, dbStatuses)

    // Second import with one new, one existing
    const secondBatch = [
      createMockIssue({ id: 'bu-1', identifier: 'ENG-BU1', title: 'Updated Issue 1' }),
      createMockIssue({ id: 'bu-3', identifier: 'ENG-BU3', title: 'New Issue 3' }),
    ]

    const result = await mapper.importIssues(secondBatch, projectId, mockStorage, dbStatuses)

    expect(result.imported).to.equal(1)  // bu-3 is new
    expect(result.updated).to.equal(1)   // bu-1 is updated
    expect(result.skipped).to.equal(0)
    expect(result.errors).to.have.lengthOf(0)
  })

  it('should handle errors gracefully without stopping batch', async () => {
    // Storage that fails on the second ticket
    let callCount = 0
    const failingStorage = {
      createTicket: async (projId: string, input: any) => {
        callCount++
        if (callCount === 2) {
          throw new Error('Database write failed')
        }
        const ticketId = `TKT-FAIL-${callCount}`

        // Insert a real row into the tickets table so FK constraints pass
        db.prepare(`
          INSERT INTO ${PMO_TABLES.tickets} (id, project_id, title, description, status, status_id, priority, category)
          VALUES (?, ?, ?, ?, 'Backlog', 'default-backlog', NULL, NULL)
        `).run(ticketId, projId, input.title, input.description ?? null)

        const ticket: Ticket = {
          id: ticketId,
          title: input.title,
          statusId: 'default-backlog',
          subtasks: [] as Subtask[],
          labels: [],
          metadata: input.metadata ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        return ticket
      },
      updateTicket: async (id: string, _changes: any) => {
        return { id } as Ticket
      },
    } as any

    const issues = [
      createMockIssue({ id: 'err-1', identifier: 'ENG-ERR1' }),
      createMockIssue({ id: 'err-2', identifier: 'ENG-ERR2' }),
      createMockIssue({ id: 'err-3', identifier: 'ENG-ERR3' }),
    ]

    const result = await mapper.importIssues(issues, projectId, failingStorage, dbStatuses)

    expect(result.imported).to.equal(2)  // err-1 and err-3 succeed
    expect(result.errors).to.have.lengthOf(1)
    expect(result.errors[0].identifier).to.equal('ENG-ERR2')
    expect(result.errors[0].error).to.include('Database write failed')
  })

  it('should be fully idempotent: same batch twice produces same result', async () => {
    const mockStorage = createMockStorage()
    const issues = [
      createMockIssue({ id: 'idem-1', identifier: 'ENG-IDEM1' }),
      createMockIssue({ id: 'idem-2', identifier: 'ENG-IDEM2' }),
    ]

    const first = await mapper.importIssues(issues, projectId, mockStorage, dbStatuses)
    expect(first.imported).to.equal(2)
    expect(first.updated).to.equal(0)

    const second = await mapper.importIssues(issues, projectId, mockStorage, dbStatuses)
    expect(second.imported).to.equal(0)
    expect(second.updated).to.equal(2)

    // Only 2 tickets were ever created
    expect(ticketCounter).to.equal(2)
  })
})
