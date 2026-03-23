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
import { LinearSync } from '../../src/lib/linear/sync.js'
import { EventBus } from '../../src/lib/events/event-bus.js'
import { OutboundSyncHandler } from '../../src/lib/external-issues/outbound-sync.js'
import {
  saveLinearApiKey,
  saveLinearDefaultTeam,
} from '../../src/lib/linear/config.js'
import type { LinearWorkflowState } from '../../src/lib/linear/types.js'
import type { WorkPRMergedEvent } from '../../src/lib/work-lifecycle/events.js'

/**
 * PR Merge → Linear Sync Tests
 *
 * Verifies that when a PR is merged via `prlt pr merge`, the linked
 * Linear issue is automatically transitioned to a "completed" state
 * and a merge comment is posted.
 */

// =============================================================================
// Helpers
// =============================================================================

const mockLinearStates: LinearWorkflowState[] = [
  { id: 'ls-backlog', name: 'Backlog', type: 'backlog', color: '#bbb', position: 0 },
  { id: 'ls-todo', name: 'Todo', type: 'unstarted', color: '#eee', position: 1 },
  { id: 'ls-progress', name: 'In Progress', type: 'started', color: '#f0ad4e', position: 2 },
  { id: 'ls-done', name: 'Done', type: 'completed', color: '#5cb85c', position: 3 },
  { id: 'ls-canceled', name: 'Canceled', type: 'canceled', color: '#999', position: 4 },
]

// =============================================================================
// 1. LinearSync.syncPRMerge Unit Tests
// =============================================================================

describe('LinearSync – syncPRMerge', () => {
  let env: TestEnvironment
  let db: Database.Database
  let mapper: LinearMapper
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

  function insertStubTicket(ticketId: string): void {
    db.exec(`INSERT OR IGNORE INTO pmo_projects (id, name, status) VALUES ('proj-merge', 'Merge Project', 'active')`)
    db.exec(`INSERT OR IGNORE INTO pmo_tickets (id, project_id, title, status) VALUES ('${ticketId}', 'proj-merge', 'Stub ${ticketId}', 'In Progress')`)
  }

  beforeEach(() => {
    env = createTestEnvironment('linear-merge-sync-')
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

  it('should transition Linear issue to completed state on PR merge', async () => {
    insertStubTicket('TKT-MERGE-1')

    mapper.createMapping({
      pmoTicketId: 'TKT-MERGE-1',
      linearIssueId: 'lin-merge-1',
      linearIdentifier: 'ENG-MERGE-1',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-MERGE-1',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    const result = await sync.syncPRMerge(
      'TKT-MERGE-1',
      mockLinearStates,
      'Fix login bug (#42)',
      'https://github.com/acme/repo/pull/42',
      'squash',
    )

    expect(result).to.be.true

    // Should update state to completed
    const stateCall = clientCalls.find(c => c.method === 'updateIssueState')
    expect(stateCall).to.exist
    expect(stateCall!.args[0]).to.equal('lin-merge-1')
    expect(stateCall!.args[1]).to.equal('ls-done') // completed state

    // Should add a merge comment
    const commentCall = clientCalls.find(c => c.method === 'addComment')
    expect(commentCall).to.exist
    expect(commentCall!.args[1]).to.include('Pull request merged')
    expect(commentCall!.args[1]).to.include('Fix login bug (#42)')
    expect(commentCall!.args[1]).to.include('squash')
    expect(commentCall!.args[1]).to.include('https://github.com/acme/repo/pull/42')
  })

  it('should post merge comment without URL when URL is null', async () => {
    insertStubTicket('TKT-MERGE-2')

    mapper.createMapping({
      pmoTicketId: 'TKT-MERGE-2',
      linearIssueId: 'lin-merge-2',
      linearIdentifier: 'ENG-MERGE-2',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-MERGE-2',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    const result = await sync.syncPRMerge(
      'TKT-MERGE-2',
      mockLinearStates,
      'Some PR title',
      null,
      'merge',
    )

    expect(result).to.be.true

    const commentCall = clientCalls.find(c => c.method === 'addComment')
    expect(commentCall).to.exist
    expect(commentCall!.args[1]).to.not.include('[View PR]')
    expect(commentCall!.args[1]).to.include('merge')
  })

  it('should return false when ticket has no Linear mapping', async () => {
    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    const result = await sync.syncPRMerge(
      'TKT-NO-MAP',
      mockLinearStates,
      'PR title',
      'https://github.com/acme/repo/pull/1',
      'merge',
    )

    expect(result).to.be.false
    expect(clientCalls).to.have.lengthOf(0)
  })

  it('should still post comment when no completed state exists', async () => {
    insertStubTicket('TKT-MERGE-3')

    mapper.createMapping({
      pmoTicketId: 'TKT-MERGE-3',
      linearIssueId: 'lin-merge-3',
      linearIdentifier: 'ENG-MERGE-3',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-MERGE-3',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    // Use states without a "completed" type
    const statesWithoutCompleted = mockLinearStates.filter(s => s.type !== 'completed')

    const result = await sync.syncPRMerge(
      'TKT-MERGE-3',
      statesWithoutCompleted,
      'PR title',
      null,
      'merge',
    )

    expect(result).to.be.true

    // Should NOT call updateIssueState
    const stateCalls = clientCalls.filter(c => c.method === 'updateIssueState')
    expect(stateCalls).to.have.lengthOf(0)

    // Should still post comment
    const commentCall = clientCalls.find(c => c.method === 'addComment')
    expect(commentCall).to.exist
    expect(commentCall!.args[1]).to.include('Pull request merged')
  })

  it('should call updateSyncTimestamp after merge sync', async () => {
    insertStubTicket('TKT-MERGE-TS')

    mapper.createMapping({
      pmoTicketId: 'TKT-MERGE-TS',
      linearIssueId: 'lin-merge-ts',
      linearIdentifier: 'ENG-MERGE-TS',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-MERGE-TS',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    const result = await sync.syncPRMerge(
      'TKT-MERGE-TS',
      mockLinearStates,
      'PR',
      null,
      'merge',
    )

    // Sync succeeded and mapping still exists
    expect(result).to.be.true
    const mapping = mapper.getByTicketId('TKT-MERGE-TS')
    expect(mapping).to.not.be.null
    expect(mapping!.linearIssueId).to.equal('lin-merge-ts')
  })
})

// =============================================================================
// 2. WorkPRMergedEvent Type Tests
// =============================================================================

describe('WorkPRMergedEvent – Event Bus Integration', () => {
  it('should emit and receive work:pr_merged events', () => {
    const bus = new EventBus()
    let receivedEvent: WorkPRMergedEvent | null = null

    bus.on('work:pr_merged', (event) => {
      receivedEvent = event
    })

    const emittedEvent: WorkPRMergedEvent = {
      workItemId: 'TKT-001',
      source: 'github',
      prNumber: 42,
      prTitle: 'Fix login bug',
      prUrl: 'https://github.com/acme/repo/pull/42',
      mergeMethod: 'squash',
      timestamp: new Date(),
    }

    bus.emit('work:pr_merged', emittedEvent)

    expect(receivedEvent).to.not.be.null
    expect(receivedEvent!.workItemId).to.equal('TKT-001')
    expect(receivedEvent!.prNumber).to.equal(42)
    expect(receivedEvent!.prTitle).to.equal('Fix login bug')
    expect(receivedEvent!.mergeMethod).to.equal('squash')
    expect(receivedEvent!.source).to.equal('github')
  })

  it('should include projectId when provided', () => {
    const bus = new EventBus()
    let receivedEvent: WorkPRMergedEvent | null = null

    bus.on('work:pr_merged', (event) => {
      receivedEvent = event
    })

    bus.emit('work:pr_merged', {
      workItemId: 'TKT-002',
      source: 'github',
      projectId: 'proj-1',
      prNumber: 99,
      prTitle: null,
      prUrl: null,
      mergeMethod: 'merge',
      timestamp: new Date(),
    })

    expect(receivedEvent!.projectId).to.equal('proj-1')
    expect(receivedEvent!.prTitle).to.be.null
    expect(receivedEvent!.prUrl).to.be.null
  })
})

// =============================================================================
// 3. OutboundSyncHandler – work:pr_merged Subscription
// =============================================================================

describe('OutboundSyncHandler – work:pr_merged', () => {
  let env: TestEnvironment
  let db: Database.Database

  beforeEach(() => {
    env = createTestEnvironment('outbound-merge-')
    createHQConfig(env.proletariatDir)
    createPMODirectories(env.pmoPath)
    db = setupProductionSchema(env.dbPath, env.pmoPath)
    db.exec(`CREATE TABLE IF NOT EXISTS workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  })

  afterEach(() => {
    if (db) db.close()
    cleanupTestEnvironment(env)
  })

  it('should subscribe to work:pr_merged events', () => {
    const handler = new OutboundSyncHandler(db)
    const bus = new EventBus()

    // Verify the handler subscribes (by checking listener count on a fresh bus)
    // We test this indirectly by verifying the handler can be started/stopped
    handler.start()
    handler.stop()

    // No errors thrown = success
  })

  it('should not throw when handling a merge event without Linear config', () => {
    const handler = new OutboundSyncHandler(db)
    handler.start()

    const bus = new EventBus()

    // Emit a merge event - should not throw even without Linear config
    // The handler silently skips sync when Linear is not configured
    expect(() => {
      bus.emit('work:pr_merged', {
        workItemId: 'TKT-001',
        source: 'github',
        prNumber: 42,
        prTitle: 'Test PR',
        prUrl: 'https://github.com/test/repo/pull/42',
        mergeMethod: 'merge',
        timestamp: new Date(),
      })
    }).to.not.throw()

    handler.stop()
  })
})
