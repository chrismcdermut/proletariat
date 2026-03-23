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
import { LinearSync } from '../../src/lib/linear/sync.js'
import {
  isLinearConfigured,
  saveLinearApiKey,
  saveLinearDefaultTeam,
  saveLinearOrganization,
} from '../../src/lib/linear/config.js'
import type { LinearIssue, LinearWorkflowState } from '../../src/lib/linear/types.js'
import type { WorkflowStatus, PMOStorage, Ticket, Subtask, StateCategory } from '../../src/lib/pmo/types.js'

/**
 * End-to-End Linear Sync Loop Tests
 *
 * Verifies the complete round-trip sync loop:
 *   Connect → Import → PMO ticket created → Status change → Sync back → Verify
 *
 * This test exercises the full integration path using mocked Linear API
 * calls and a real SQLite database, ensuring all components work together.
 */

// =============================================================================
// Helpers
// =============================================================================

function createMockIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: 'lin-loop-issue-1',
    identifier: 'ENG-101',
    title: 'Add user profile page',
    description: 'Implement the user profile settings page with avatar upload.',
    priority: 2, // High
    state: {
      id: 'state-todo',
      name: 'Todo',
      type: 'unstarted',
    },
    team: {
      id: 'team-eng',
      key: 'ENG',
      name: 'Engineering',
    },
    labels: [
      { id: 'label-feat', name: 'feature', color: '#0066ff' },
      { id: 'label-ui', name: 'ui', color: '#00cc00' },
    ],
    url: 'https://linear.app/acme/issue/ENG-101',
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-16T14:30:00Z',
    ...overrides,
  }
}

const mockWorkflowStatuses: WorkflowStatus[] = [
  { id: 'status-backlog', workflowId: 'wf-1', name: 'Backlog', category: 'backlog' as StateCategory, position: 0, isDefault: true, createdAt: new Date() },
  { id: 'status-todo', workflowId: 'wf-1', name: 'Todo', category: 'unstarted' as StateCategory, position: 1, createdAt: new Date() },
  { id: 'status-progress', workflowId: 'wf-1', name: 'In Progress', category: 'started' as StateCategory, position: 2, createdAt: new Date() },
  { id: 'status-review', workflowId: 'wf-1', name: 'Review', category: 'started' as StateCategory, position: 3, createdAt: new Date() },
  { id: 'status-done', workflowId: 'wf-1', name: 'Done', category: 'completed' as StateCategory, position: 4, createdAt: new Date() },
  { id: 'status-canceled', workflowId: 'wf-1', name: 'Canceled', category: 'canceled' as StateCategory, position: 5, createdAt: new Date() },
]

const mockLinearStates: LinearWorkflowState[] = [
  { id: 'ls-backlog', name: 'Backlog', type: 'backlog', color: '#bbb', position: 0 },
  { id: 'ls-todo', name: 'Todo', type: 'unstarted', color: '#eee', position: 1 },
  { id: 'ls-progress', name: 'In Progress', type: 'started', color: '#f0ad4e', position: 2 },
  { id: 'ls-done', name: 'Done', type: 'completed', color: '#5cb85c', position: 3 },
  { id: 'ls-canceled', name: 'Canceled', type: 'canceled', color: '#999', position: 4 },
]

function createMockTicket(overrides: Partial<Ticket> & { id: string; statusCategory: string }): Ticket {
  return {
    title: `Stub ${overrides.id}`,
    projectId: 'proj-loop',
    status: 'In Progress',
    statusId: 'status-progress',
    subtasks: [] as Subtask[],
    labels: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Ticket
}

// =============================================================================
// End-to-End Sync Loop
// =============================================================================

describe('Linear Sync Loop – End-to-End', () => {
  let env: TestEnvironment
  let db: Database.Database
  let mapper: LinearMapper
  let projectId: string
  let clientCalls: Array<{ method: string; args: unknown[] }>

  function createMockClient() {
    clientCalls = []
    return {
      updateIssueState(issueId: string, stateId: string) {
        clientCalls.push({ method: 'updateIssueState', args: [issueId, stateId] })
        return Promise.resolve()
      },
      addComment(issueId: string, body: string) {
        clientCalls.push({ method: 'addComment', args: [issueId, body] })
        return Promise.resolve()
      },
      attachUrl(issueId: string, url: string, title: string) {
        clientCalls.push({ method: 'attachUrl', args: [issueId, url, title] })
        return Promise.resolve()
      },
    }
  }

  beforeEach(() => {
    env = createTestEnvironment('linear-sync-loop-')
    createHQConfig(env.proletariatDir)
    createPMODirectories(env.pmoPath)
    db = setupProductionSchema(env.dbPath, env.pmoPath)
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
    mapper = new LinearMapper(db)
    projectId = createTestProject(db, { id: 'proj-loop', name: 'Sync Loop Test' })
  })

  afterEach(() => {
    if (db) db.close()
    cleanupTestEnvironment(env)
  })

  it('should complete the full sync loop: connect → import → modify → sync back', async () => {
    // =========================================================================
    // Phase 1: Connect – configure Linear credentials
    // =========================================================================
    saveLinearApiKey(db, 'lin_api_loop_test')
    saveLinearDefaultTeam(db, 'team-eng', 'ENG')
    saveLinearOrganization(db, 'Acme Corp')
    expect(isLinearConfigured(db)).to.be.true

    // =========================================================================
    // Phase 2: Import – pull a Linear issue into PMO
    // =========================================================================
    const issue = createMockIssue()
    const ticketInput = mapper.issueToTicketInput(issue, mockWorkflowStatuses)

    // Verify the import mapping is correct
    expect(ticketInput.title).to.equal('Add user profile page')
    expect(ticketInput.priority).to.equal('P1') // High → P1
    expect(ticketInput.statusId).to.equal('status-todo') // unstarted → Todo
    expect(ticketInput.labels).to.deep.equal(['feature', 'ui'])
    expect(ticketInput.description).to.include('Implement the user profile settings page')
    expect(ticketInput.description).to.include('ENG-101')

    // Insert the ticket into the database (simulating storage.createTicket)
    db.exec(`
      INSERT INTO pmo_tickets (id, project_id, title, description, priority, status)
      VALUES ('TKT-LOOP-1', '${projectId}', '${ticketInput.title}', 'imported', '${ticketInput.priority}', 'Todo')
    `)

    // Create the mapping record
    mapper.createMapping({
      pmoTicketId: 'TKT-LOOP-1',
      linearIssueId: issue.id,
      linearIdentifier: issue.identifier,
      linearTeamKey: issue.team.key,
      linearUrl: issue.url,
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    // Verify mapping was created
    const mapping = mapper.getByTicketId('TKT-LOOP-1')
    expect(mapping).to.not.be.null
    expect(mapping!.linearIdentifier).to.equal('ENG-101')
    expect(mapping!.linearIssueId).to.equal('lin-loop-issue-1')
    expect(mapping!.syncDirection).to.equal('inbound')

    // Verify reverse lookups work
    expect(mapper.getByLinearId('lin-loop-issue-1')!.pmoTicketId).to.equal('TKT-LOOP-1')
    expect(mapper.getByIdentifier('ENG-101')!.pmoTicketId).to.equal('TKT-LOOP-1')

    // =========================================================================
    // Phase 3: Modify PMO ticket status (simulating work being done)
    // =========================================================================
    // The ticket moves from Todo → In Progress (developer starts working)
    db.exec(`UPDATE pmo_tickets SET status = 'In Progress' WHERE id = 'TKT-LOOP-1'`)

    // =========================================================================
    // Phase 4: Sync status back to Linear
    // =========================================================================
    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    const ticket = createMockTicket({
      id: 'TKT-LOOP-1',
      title: 'Add user profile page',
      status: 'In Progress',
      statusId: 'status-progress',
      statusCategory: 'started',
    })

    const syncResult = await sync.syncTicketStatus(ticket, mockLinearStates)
    expect(syncResult).to.be.true

    // Verify the correct Linear API call was made
    expect(clientCalls).to.have.lengthOf(1)
    expect(clientCalls[0].method).to.equal('updateIssueState')
    expect(clientCalls[0].args[0]).to.equal('lin-loop-issue-1') // Linear issue ID
    expect(clientCalls[0].args[1]).to.equal('ls-progress') // started → In Progress state

    // Verify mapping still intact after sync
    const updatedMapping = mapper.getByTicketId('TKT-LOOP-1')
    expect(updatedMapping).to.not.be.null
    expect(updatedMapping!.linearIssueId).to.equal('lin-loop-issue-1')

    // =========================================================================
    // Phase 5: Continue the loop – mark as completed and sync again
    // =========================================================================
    clientCalls = [] // Reset calls

    const completedTicket = createMockTicket({
      id: 'TKT-LOOP-1',
      title: 'Add user profile page',
      status: 'Done',
      statusId: 'status-done',
      statusCategory: 'completed',
    })

    const completedSync = await sync.syncTicketStatus(completedTicket, mockLinearStates)
    expect(completedSync).to.be.true

    expect(clientCalls).to.have.lengthOf(1)
    expect(clientCalls[0].method).to.equal('updateIssueState')
    expect(clientCalls[0].args[0]).to.equal('lin-loop-issue-1')
    expect(clientCalls[0].args[1]).to.equal('ls-done') // completed → Done state
  })

  it('should handle the full import → sync → PR link → comment loop', async () => {
    // Connect
    saveLinearApiKey(db, 'lin_api_full_loop')
    saveLinearDefaultTeam(db, 'team-eng', 'ENG')

    // Import the issue
    const issue = createMockIssue({
      id: 'lin-full-loop',
      identifier: 'ENG-202',
      title: 'Fix authentication race condition',
      priority: 1, // Urgent
      state: { id: 's-backlog', name: 'Backlog', type: 'backlog' },
    })

    const ticketInput = mapper.issueToTicketInput(issue, mockWorkflowStatuses)
    expect(ticketInput.priority).to.equal('P0') // Urgent → P0
    expect(ticketInput.statusId).to.equal('status-backlog') // backlog → Backlog

    // Create the ticket and mapping
    db.exec(`
      INSERT INTO pmo_tickets (id, project_id, title, status)
      VALUES ('TKT-FULL-1', '${projectId}', 'Fix authentication race condition', 'Backlog')
    `)

    mapper.createMapping({
      pmoTicketId: 'TKT-FULL-1',
      linearIssueId: 'lin-full-loop',
      linearIdentifier: 'ENG-202',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/acme/issue/ENG-202',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    // Step 1: Sync status change (Backlog → In Progress)
    const ticket = createMockTicket({
      id: 'TKT-FULL-1',
      title: 'Fix authentication race condition',
      status: 'In Progress',
      statusCategory: 'started',
    })

    await sync.syncTicketStatus(ticket, mockLinearStates)
    expect(clientCalls).to.have.lengthOf(1)
    expect(clientCalls[0].args[1]).to.equal('ls-progress')

    // Step 2: Sync a PR link
    const prSynced = await sync.syncPRLink(
      'TKT-FULL-1',
      'https://github.com/acme/repo/pull/99',
      'Fix auth race condition (#99)',
    )
    expect(prSynced).to.be.true

    // PR link generates 2 API calls: attachUrl + addComment
    expect(clientCalls).to.have.lengthOf(3) // 1 status + 2 PR link
    expect(clientCalls[1].method).to.equal('attachUrl')
    expect(clientCalls[1].args[0]).to.equal('lin-full-loop')
    expect(clientCalls[1].args[1]).to.equal('https://github.com/acme/repo/pull/99')
    expect(clientCalls[2].method).to.equal('addComment')
    expect(clientCalls[2].args[1]).to.include('Pull request created')
    expect(clientCalls[2].args[1]).to.include('Fix auth race condition (#99)')

    // Step 3: Sync a status comment
    const commentSynced = await sync.syncStatusComment(
      'TKT-FULL-1',
      'In Progress',
      'Identified root cause in session middleware',
    )
    expect(commentSynced).to.be.true

    expect(clientCalls).to.have.lengthOf(4)
    expect(clientCalls[3].method).to.equal('addComment')
    expect(clientCalls[3].args[1]).to.include('In Progress')
    expect(clientCalls[3].args[1]).to.include('Identified root cause in session middleware')

    // Step 4: Complete and sync final status
    const completedTicket = createMockTicket({
      id: 'TKT-FULL-1',
      title: 'Fix authentication race condition',
      status: 'Done',
      statusCategory: 'completed',
    })

    await sync.syncTicketStatus(completedTicket, mockLinearStates)
    expect(clientCalls).to.have.lengthOf(5)
    expect(clientCalls[4].method).to.equal('updateIssueState')
    expect(clientCalls[4].args[1]).to.equal('ls-done')
  })

  it('should handle batch sync across multiple imported issues', async () => {
    // Connect
    saveLinearApiKey(db, 'lin_api_batch')
    saveLinearDefaultTeam(db, 'team-eng', 'ENG')

    // Import 3 issues at different stages
    const issues = [
      createMockIssue({
        id: 'lin-batch-1', identifier: 'ENG-301', title: 'Issue 1',
        state: { id: 's1', name: 'Todo', type: 'unstarted' },
      }),
      createMockIssue({
        id: 'lin-batch-2', identifier: 'ENG-302', title: 'Issue 2',
        state: { id: 's2', name: 'In Progress', type: 'started' },
      }),
      createMockIssue({
        id: 'lin-batch-3', identifier: 'ENG-303', title: 'Issue 3',
        state: { id: 's3', name: 'Backlog', type: 'backlog' },
      }),
    ]

    // Create tickets and mappings for each
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i]
      const ticketId = `TKT-BATCH-${i + 1}`
      const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)

      db.exec(`
        INSERT INTO pmo_tickets (id, project_id, title, status)
        VALUES ('${ticketId}', '${projectId}', '${issue.title}', 'backlog')
      `)

      mapper.createMapping({
        pmoTicketId: ticketId,
        linearIssueId: issue.id,
        linearIdentifier: issue.identifier,
        linearTeamKey: 'ENG',
        linearUrl: issue.url,
        syncDirection: 'inbound',
        createdAt: new Date(),
      })
    }

    // Verify all 3 mappings exist
    const mappings = mapper.listMappings()
    expect(mappings).to.have.lengthOf(3)

    // Now simulate all tickets moving to "started" and batch sync
    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    const mockStorage: Partial<PMOStorage> = {
      getTicket: async (id: string) => {
        const tickets: Record<string, Ticket> = {
          'TKT-BATCH-1': createMockTicket({
            id: 'TKT-BATCH-1', title: 'Issue 1',
            status: 'In Progress', statusCategory: 'started',
          }),
          'TKT-BATCH-2': createMockTicket({
            id: 'TKT-BATCH-2', title: 'Issue 2',
            status: 'Done', statusCategory: 'completed',
          }),
          'TKT-BATCH-3': createMockTicket({
            id: 'TKT-BATCH-3', title: 'Issue 3',
            status: 'In Progress', statusCategory: 'started',
          }),
        }
        return tickets[id] ?? null
      },
    }

    const result = await sync.syncAllStatuses(
      mockStorage as PMOStorage,
      mappings,
      mockLinearStates,
    )

    expect(result.synced).to.equal(3)
    expect(result.skipped).to.equal(0)
    expect(result.errors).to.equal(0)

    // Verify API calls were made for all 3
    expect(clientCalls).to.have.lengthOf(3)

    // All calls should be updateIssueState
    clientCalls.forEach((call) => {
      expect(call.method).to.equal('updateIssueState')
    })

    // Verify the correct state IDs were used
    const stateUpdates = clientCalls.map((c) => ({
      issueId: c.args[0],
      stateId: c.args[1],
    }))

    // TKT-BATCH-1 (started) → ls-progress
    expect(stateUpdates.find((u) => u.issueId === 'lin-batch-1')?.stateId).to.equal('ls-progress')
    // TKT-BATCH-2 (completed) → ls-done
    expect(stateUpdates.find((u) => u.issueId === 'lin-batch-2')?.stateId).to.equal('ls-done')
    // TKT-BATCH-3 (started) → ls-progress
    expect(stateUpdates.find((u) => u.issueId === 'lin-batch-3')?.stateId).to.equal('ls-progress')
  })

  it('should handle re-import of the same Linear issue (idempotent update)', async () => {
    // Connect
    saveLinearApiKey(db, 'lin_api_reimport')
    saveLinearDefaultTeam(db, 'team-eng', 'ENG')

    // First import
    const issue = createMockIssue({
      id: 'lin-reimport-1',
      identifier: 'ENG-401',
      title: 'Original title',
      priority: 3, // Medium
    })

    const firstInput = mapper.issueToTicketInput(issue, mockWorkflowStatuses)
    expect(firstInput.title).to.equal('Original title')
    expect(firstInput.priority).to.equal('P2')

    // Create ticket and mapping
    db.exec(`
      INSERT INTO pmo_tickets (id, project_id, title, status, priority)
      VALUES ('TKT-REIMP-1', '${projectId}', 'Original title', 'Todo', 'P2')
    `)

    mapper.createMapping({
      pmoTicketId: 'TKT-REIMP-1',
      linearIssueId: 'lin-reimport-1',
      linearIdentifier: 'ENG-401',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/acme/issue/ENG-401',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    // Verify initial state
    expect(mapper.listMappings()).to.have.lengthOf(1)

    // Second import of the same issue (with updated fields)
    const updatedIssue = createMockIssue({
      id: 'lin-reimport-1', // Same Linear ID
      identifier: 'ENG-401',
      title: 'Updated title with more detail',
      priority: 1, // Now Urgent
      state: { id: 's-prog', name: 'In Progress', type: 'started' },
    })

    // The mapper should detect the existing mapping
    const existingMapping = mapper.getByLinearId('lin-reimport-1')
    expect(existingMapping).to.not.be.null
    expect(existingMapping!.pmoTicketId).to.equal('TKT-REIMP-1')

    // Re-map produces updated input
    const secondInput = mapper.issueToTicketInput(updatedIssue, mockWorkflowStatuses)
    expect(secondInput.title).to.equal('Updated title with more detail')
    expect(secondInput.priority).to.equal('P0') // Urgent → P0
    expect(secondInput.statusId).to.equal('status-progress') // started → In Progress

    // No duplicate mapping created
    expect(mapper.listMappings()).to.have.lengthOf(1)

    // Attempting to create a duplicate mapping should throw
    expect(() => {
      mapper.createMapping({
        pmoTicketId: 'TKT-REIMP-2',
        linearIssueId: 'lin-reimport-1', // Same external ID
        linearIdentifier: 'ENG-401',
        linearTeamKey: 'ENG',
        linearUrl: 'https://linear.app/acme/issue/ENG-401',
        syncDirection: 'inbound',
        createdAt: new Date(),
      })
    }).to.throw()
  })

  it('should handle sync with mixed success/skip/error results', async () => {
    // Create 3 tickets: one normal, one deleted, one that causes an error
    db.exec(`INSERT OR IGNORE INTO pmo_projects (id, name, status) VALUES ('${projectId}', 'Mixed Test', 'active')`)

    // Ticket 1: normal sync
    db.exec(`
      INSERT INTO pmo_tickets (id, project_id, title, status)
      VALUES ('TKT-MIX-1', '${projectId}', 'Normal ticket', 'In Progress')
    `)
    mapper.createMapping({
      pmoTicketId: 'TKT-MIX-1',
      linearIssueId: 'lin-mix-1',
      linearIdentifier: 'ENG-MIX-1',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-MIX-1',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    // Ticket 2: will be "deleted" (storage returns null)
    db.exec(`
      INSERT INTO pmo_tickets (id, project_id, title, status)
      VALUES ('TKT-MIX-2', '${projectId}', 'Deleted ticket', 'Backlog')
    `)
    mapper.createMapping({
      pmoTicketId: 'TKT-MIX-2',
      linearIssueId: 'lin-mix-2',
      linearIdentifier: 'ENG-MIX-2',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-MIX-2',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    // Ticket 3: will cause an API error
    db.exec(`
      INSERT INTO pmo_tickets (id, project_id, title, status)
      VALUES ('TKT-MIX-3', '${projectId}', 'Error ticket', 'Done')
    `)
    mapper.createMapping({
      pmoTicketId: 'TKT-MIX-3',
      linearIssueId: 'lin-mix-3',
      linearIdentifier: 'ENG-MIX-3',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-MIX-3',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    // Client that fails on the third issue
    const errorClient = {
      updateIssueState(issueId: string, stateId: string) {
        if (issueId === 'lin-mix-3') {
          return Promise.reject(new Error('Linear API: rate limited'))
        }
        return Promise.resolve()
      },
      addComment() { return Promise.resolve() },
      attachUrl() { return Promise.resolve() },
    }

    const sync = new LinearSync(errorClient as any, mapper)

    const mockStorage: Partial<PMOStorage> = {
      getTicket: async (id: string) => {
        if (id === 'TKT-MIX-2') return null // "deleted"
        if (id === 'TKT-MIX-1') {
          return createMockTicket({
            id: 'TKT-MIX-1', title: 'Normal ticket',
            status: 'In Progress', statusCategory: 'started',
          })
        }
        if (id === 'TKT-MIX-3') {
          return createMockTicket({
            id: 'TKT-MIX-3', title: 'Error ticket',
            status: 'Done', statusCategory: 'completed',
          })
        }
        return null
      },
    }

    const mappings = mapper.listMappings()
    const result = await sync.syncAllStatuses(
      mockStorage as PMOStorage,
      mappings,
      mockLinearStates,
    )

    expect(result.synced).to.equal(1)
    expect(result.skipped).to.equal(1)
    expect(result.errors).to.equal(1)
  })

  it('should correctly sync across multiple sync cycles', async () => {
    // Setup
    db.exec(`
      INSERT INTO pmo_tickets (id, project_id, title, status)
      VALUES ('TKT-TS-1', '${projectId}', 'Multi-cycle test', 'In Progress')
    `)

    mapper.createMapping({
      pmoTicketId: 'TKT-TS-1',
      linearIssueId: 'lin-ts-1',
      linearIdentifier: 'ENG-TS-1',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-TS-1',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    // Sync cycle 1: started
    const ticket1 = createMockTicket({
      id: 'TKT-TS-1', title: 'Multi-cycle test',
      status: 'In Progress', statusCategory: 'started',
    })
    const result1 = await sync.syncTicketStatus(ticket1, mockLinearStates)
    expect(result1).to.be.true

    // Sync cycle 2: completed
    const ticket2 = createMockTicket({
      id: 'TKT-TS-1', title: 'Multi-cycle test',
      status: 'Done', statusCategory: 'completed',
    })
    const result2 = await sync.syncTicketStatus(ticket2, mockLinearStates)
    expect(result2).to.be.true

    // Sync cycle 3: reopened back to started
    const ticket3 = createMockTicket({
      id: 'TKT-TS-1', title: 'Multi-cycle test',
      status: 'In Progress', statusCategory: 'started',
    })
    const result3 = await sync.syncTicketStatus(ticket3, mockLinearStates)
    expect(result3).to.be.true

    // All 3 API calls should have been made in order
    expect(clientCalls).to.have.lengthOf(3)
    expect(clientCalls[0].args[1]).to.equal('ls-progress') // started
    expect(clientCalls[1].args[1]).to.equal('ls-done')     // completed
    expect(clientCalls[2].args[1]).to.equal('ls-progress') // reopened → started

    // Mapping should still be intact after multiple syncs
    const mapping = mapper.getByTicketId('TKT-TS-1')
    expect(mapping).to.not.be.null
    expect(mapping!.linearIssueId).to.equal('lin-ts-1')
  })

  it('should use importIssue for full import-and-map in one step', async () => {
    // Connect
    saveLinearApiKey(db, 'lin_api_import_method')
    saveLinearDefaultTeam(db, 'team-eng', 'ENG')

    const issue = createMockIssue({
      id: 'lin-import-method-1',
      identifier: 'ENG-501',
      title: 'Implement search feature',
      priority: 2,
      state: { id: 's-todo', name: 'Todo', type: 'unstarted' },
      labels: [{ id: 'l-1', name: 'search', color: '#00f' }],
    })

    // Create a mock PMOStorage for importIssue
    let createdTicketId: string | null = null
    const mockStorage: Partial<PMOStorage> = {
      createTicket: async (_projectId: string, input: any) => {
        // Simulate creating a ticket in DB
        createdTicketId = 'TKT-IMPORTED-501'
        db.exec(`
          INSERT INTO pmo_tickets (id, project_id, title, status, priority)
          VALUES ('${createdTicketId}', '${_projectId}', '${input.title}', 'Todo', '${input.priority}')
        `)
        return {
          id: createdTicketId,
          title: input.title,
          status: 'Todo',
          statusId: input.statusId,
          subtasks: [],
          labels: input.labels ?? [],
          metadata: input.metadata ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Ticket
      },
      updateTicket: async (id: string, changes: any) => {
        return { id, ...changes } as Ticket
      },
    }

    // Use importIssue to do the full import
    const result = await mapper.importIssue(
      issue,
      projectId,
      mockStorage as PMOStorage,
      mockWorkflowStatuses,
    )

    expect(result.created).to.be.true
    expect(result.updated).to.be.false
    expect(result.ticketId).to.equal('TKT-IMPORTED-501')

    // Verify mapping was created automatically
    const mapping = mapper.getByTicketId('TKT-IMPORTED-501')
    expect(mapping).to.not.be.null
    expect(mapping!.linearIdentifier).to.equal('ENG-501')
    expect(mapping!.linearIssueId).to.equal('lin-import-method-1')

    // Now sync the imported ticket back to Linear
    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    const ticket = createMockTicket({
      id: 'TKT-IMPORTED-501',
      title: 'Implement search feature',
      status: 'In Progress',
      statusCategory: 'started',
    })

    const synced = await sync.syncTicketStatus(ticket, mockLinearStates)
    expect(synced).to.be.true
    expect(clientCalls[0].args[0]).to.equal('lin-import-method-1')
    expect(clientCalls[0].args[1]).to.equal('ls-progress')

    // Re-import the same issue should update, not create
    const updatedIssue = createMockIssue({
      id: 'lin-import-method-1', // Same ID
      identifier: 'ENG-501',
      title: 'Implement search feature (v2)',
      priority: 1,
    })

    const reimportResult = await mapper.importIssue(
      updatedIssue,
      projectId,
      mockStorage as PMOStorage,
      mockWorkflowStatuses,
    )

    expect(reimportResult.created).to.be.false
    expect(reimportResult.updated).to.be.true
    expect(reimportResult.ticketId).to.equal('TKT-IMPORTED-501') // Same ticket

    // Still only one mapping
    expect(mapper.listMappings()).to.have.lengthOf(1)
  })

  it('should support the full lifecycle: backlog → started → completed → canceled', async () => {
    // Setup a ticket in backlog
    db.exec(`
      INSERT INTO pmo_tickets (id, project_id, title, status)
      VALUES ('TKT-LIFE-1', '${projectId}', 'Lifecycle test', 'Backlog')
    `)

    mapper.createMapping({
      pmoTicketId: 'TKT-LIFE-1',
      linearIssueId: 'lin-life-1',
      linearIdentifier: 'ENG-LIFE-1',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-LIFE-1',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    // Transition through all states
    const transitions: Array<{ status: string; category: StateCategory; expectedState: string }> = [
      { status: 'Backlog', category: 'backlog', expectedState: 'ls-backlog' },
      { status: 'Todo', category: 'unstarted', expectedState: 'ls-todo' },
      { status: 'In Progress', category: 'started', expectedState: 'ls-progress' },
      { status: 'Done', category: 'completed', expectedState: 'ls-done' },
      { status: 'Canceled', category: 'canceled', expectedState: 'ls-canceled' },
    ]

    for (const transition of transitions) {
      const ticket = createMockTicket({
        id: 'TKT-LIFE-1',
        title: 'Lifecycle test',
        status: transition.status,
        statusCategory: transition.category,
      })

      const result = await sync.syncTicketStatus(ticket, mockLinearStates)
      expect(result).to.be.true
    }

    // All 5 transitions should have produced API calls
    expect(clientCalls).to.have.lengthOf(5)

    // Verify each transition mapped to the correct Linear state
    transitions.forEach((transition, idx) => {
      expect(clientCalls[idx].method).to.equal('updateIssueState')
      expect(clientCalls[idx].args[1]).to.equal(transition.expectedState,
        `${transition.status} (${transition.category}) should map to ${transition.expectedState}`)
    })
  })
})
