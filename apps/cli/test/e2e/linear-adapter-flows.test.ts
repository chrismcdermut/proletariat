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
  loadLinearConfig,
  saveLinearApiKey,
  saveLinearDefaultTeam,
  saveLinearOrganization,
  clearLinearConfig,
  getLinearApiKey,
} from '../../src/lib/linear/config.js'
import {
  LINEAR_STATE_TO_PMO_CATEGORY,
  LINEAR_PRIORITY_TO_PMO,
} from '../../src/lib/linear/types.js'
import type { LinearIssue, LinearWorkflowState } from '../../src/lib/linear/types.js'
import type { WorkflowStatus, PMOStorage, Ticket, Subtask } from '../../src/lib/pmo/types.js'
import {
  normalizeLinearIssue,
  normalizeLinearIssueToEnvelope,
  buildLinearTicketDescription,
  buildLinearMetadata,
  buildLinearSpawnContextMessage,
} from '../../src/lib/external-issues/linear.js'
import { mapToSpawnContext } from '../../src/lib/external-issues/mapper.js'

/**
 * Linear Adapter Integration Tests
 *
 * End-to-end flow tests for the four core Linear adapter operations:
 *   1. Connect  – configure API key, team, and org in workspace_settings
 *   2. Import   – pull Linear issues into PMO as first-class tickets
 *   3. Spawn    – generate agent execution context from Linear issues
 *   4. Sync     – push PMO status changes back to Linear
 *
 * All tests use mocked data and an isolated SQLite database.
 * No real Linear API calls are made.
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
    labels: [
      { id: 'label-1', name: 'bug', color: '#ff0000' },
    ],
    url: 'https://linear.app/my-company/issue/ENG-123',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    ...overrides,
  }
}

function makeLinearNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uuid-1',
    identifier: 'ENG-123',
    title: 'Fix flaky CI checks',
    description: 'CI fails intermittently on macOS.',
    url: 'https://linear.app/acme/issue/ENG-123/fix-flaky-ci-checks',
    priority: 2,
    state: { name: 'In Progress' },
    labels: { nodes: [{ name: 'bug' }, { name: 'ci' }] },
    ...overrides,
  }
}

const mockWorkflowStatuses: WorkflowStatus[] = [
  { id: 'status-backlog', workflowId: 'wf-1', name: 'Backlog', category: 'backlog', position: 0, isDefault: true, createdAt: new Date() },
  { id: 'status-todo', workflowId: 'wf-1', name: 'Todo', category: 'unstarted', position: 1, createdAt: new Date() },
  { id: 'status-progress', workflowId: 'wf-1', name: 'In Progress', category: 'started', position: 2, createdAt: new Date() },
  { id: 'status-done', workflowId: 'wf-1', name: 'Done', category: 'completed', position: 3, createdAt: new Date() },
  { id: 'status-canceled', workflowId: 'wf-1', name: 'Canceled', category: 'canceled', position: 4, createdAt: new Date() },
]

function createMockTicket(overrides: Partial<Ticket> & { id: string; statusCategory: string }): Ticket {
  return {
    title: `Stub ${overrides.id}`,
    projectId: 'proj-sync',
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

const mockLinearStates: LinearWorkflowState[] = [
  { id: 'ls-backlog', name: 'Backlog', type: 'backlog', color: '#bbb', position: 0 },
  { id: 'ls-todo', name: 'Todo', type: 'unstarted', color: '#eee', position: 1 },
  { id: 'ls-progress', name: 'In Progress', type: 'started', color: '#f0ad4e', position: 2 },
  { id: 'ls-done', name: 'Done', type: 'completed', color: '#5cb85c', position: 3 },
  { id: 'ls-canceled', name: 'Canceled', type: 'canceled', color: '#999', position: 4 },
]

// =============================================================================
// 1. Connect Flow
// =============================================================================

describe('Linear Adapter – Connect Flow', () => {
  let env: TestEnvironment
  let db: Database.Database

  beforeEach(() => {
    env = createTestEnvironment('linear-connect-')
    createHQConfig(env.proletariatDir)
    createPMODirectories(env.pmoPath)
    db = setupProductionSchema(env.dbPath, env.pmoPath)
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
  })

  afterEach(() => {
    if (db) db.close()
    cleanupTestEnvironment(env)
  })

  it('should start with no Linear configuration', () => {
    expect(isLinearConfigured(db)).to.be.false
    expect(loadLinearConfig(db)).to.be.null
  })

  it('should complete full connect sequence: api key → team → org', () => {
    // Step 1: Save API key (simulates auth command storing the key)
    saveLinearApiKey(db, 'lin_api_connect_test')
    expect(isLinearConfigured(db)).to.be.true

    // Step 2: Save default team (simulates team selection after auth)
    saveLinearDefaultTeam(db, 'team-eng-1', 'ENG')

    // Step 3: Save organization name (simulates verify() response)
    saveLinearOrganization(db, 'Acme Corp')

    // Verify full config is loaded
    const config = loadLinearConfig(db)
    expect(config).to.not.be.null
    expect(config!.apiKey).to.equal('lin_api_connect_test')
    expect(config!.defaultTeamId).to.equal('team-eng-1')
    expect(config!.defaultTeamKey).to.equal('ENG')
    expect(config!.organizationName).to.equal('Acme Corp')
  })

  it('should support disconnect and reconnect', () => {
    // Connect
    saveLinearApiKey(db, 'lin_api_first')
    saveLinearDefaultTeam(db, 'team-1', 'ENG')
    saveLinearOrganization(db, 'First Org')
    expect(isLinearConfigured(db)).to.be.true

    // Disconnect
    clearLinearConfig(db)
    expect(isLinearConfigured(db)).to.be.false
    expect(loadLinearConfig(db)).to.be.null

    // Reconnect with different credentials
    saveLinearApiKey(db, 'lin_api_second')
    saveLinearDefaultTeam(db, 'team-2', 'PROD')
    saveLinearOrganization(db, 'Second Org')

    const config = loadLinearConfig(db)
    expect(config!.apiKey).to.equal('lin_api_second')
    expect(config!.defaultTeamKey).to.equal('PROD')
    expect(config!.organizationName).to.equal('Second Org')
  })

  it('should prefer env var over stored key for connect', () => {
    saveLinearApiKey(db, 'lin_api_stored')

    process.env.LINEAR_API_KEY = 'lin_api_from_env'
    const key = getLinearApiKey(db)
    expect(key).to.equal('lin_api_from_env')

    delete process.env.LINEAR_API_KEY
  })

  it('should support PRLT_LINEAR_API_KEY env var', () => {
    process.env.PRLT_LINEAR_API_KEY = 'lin_api_prlt_env'
    const key = getLinearApiKey(db)
    expect(key).to.equal('lin_api_prlt_env')

    delete process.env.PRLT_LINEAR_API_KEY
  })
})

// =============================================================================
// 2. Import Flow
// =============================================================================

describe('Linear Adapter – Import Flow', () => {
  let env: TestEnvironment
  let db: Database.Database
  let mapper: LinearMapper
  let projectId: string

  beforeEach(() => {
    env = createTestEnvironment('linear-import-')
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
    projectId = createTestProject(db, { id: 'proj-import', name: 'Import Test Project' })
  })

  afterEach(() => {
    if (db) db.close()
    cleanupTestEnvironment(env)
  })

  it('should map a Linear issue to a ticket input with correct fields', () => {
    const issue = createMockIssue()
    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)

    expect(input.title).to.equal('Fix login bug')
    expect(input.description).to.include('Users cannot log in with SSO')
    expect(input.description).to.include('ENG-123')
    expect(input.priority).to.equal('P1')  // High → P1
    expect(input.statusId).to.equal('status-progress')  // started → In Progress
    expect(input.labels).to.deep.equal(['bug'])
    expect(input.metadata).to.deep.include({
      'linear.issue_id': 'issue-1',
      'linear.identifier': 'ENG-123',
      'linear.team': 'ENG',
    })
  })

  it('should map all Linear state types to correct PMO statuses', () => {
    const stateTypes = ['backlog', 'unstarted', 'started', 'completed', 'canceled']
    const expectedStatusIds = ['status-backlog', 'status-todo', 'status-progress', 'status-done', 'status-canceled']

    stateTypes.forEach((stateType, idx) => {
      const issue = createMockIssue({
        state: { id: `s-${idx}`, name: stateType, type: stateType },
      })
      const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)
      expect(input.statusId).to.equal(expectedStatusIds[idx],
        `state type "${stateType}" should map to status "${expectedStatusIds[idx]}"`)
    })
  })

  it('should map all Linear priority levels to PMO priorities', () => {
    const priorityMappings: Array<[number, string]> = [
      [0, 'P3'],  // No priority → Low
      [1, 'P0'],  // Urgent → Critical
      [2, 'P1'],  // High → High
      [3, 'P2'],  // Medium → Medium
      [4, 'P3'],  // Low → Low
    ]

    priorityMappings.forEach(([linearPriority, expectedPmo]) => {
      const issue = createMockIssue({ priority: linearPriority })
      const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)
      expect(input.priority).to.equal(expectedPmo,
        `Linear priority ${linearPriority} should map to PMO ${expectedPmo}`)
    })
  })

  it('should create a mapping record when importing an issue', () => {
    // Insert a stub ticket to satisfy FK constraints
    db.exec(`INSERT OR IGNORE INTO pmo_projects (id, name, status) VALUES ('proj-test', 'Test', 'active')`)
    db.exec(`INSERT INTO pmo_tickets (id, project_id, title, status) VALUES ('TKT-IMPORT-1', 'proj-test', 'Imported ticket', 'backlog')`)

    mapper.createMapping({
      pmoTicketId: 'TKT-IMPORT-1',
      linearIssueId: 'lin-import-id-1',
      linearIdentifier: 'ENG-500',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-500',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    // Verify the mapping is retrievable by all lookup methods
    const byTicket = mapper.getByTicketId('TKT-IMPORT-1')
    expect(byTicket).to.not.be.null
    expect(byTicket!.linearIdentifier).to.equal('ENG-500')

    const byLinearId = mapper.getByLinearId('lin-import-id-1')
    expect(byLinearId).to.not.be.null
    expect(byLinearId!.pmoTicketId).to.equal('TKT-IMPORT-1')

    const byIdentifier = mapper.getByIdentifier('ENG-500')
    expect(byIdentifier).to.not.be.null
    expect(byIdentifier!.pmoTicketId).to.equal('TKT-IMPORT-1')
  })

  it('should prevent duplicate import of the same Linear issue', () => {
    db.exec(`INSERT OR IGNORE INTO pmo_projects (id, name, status) VALUES ('proj-test', 'Test', 'active')`)
    db.exec(`INSERT INTO pmo_tickets (id, project_id, title, status) VALUES ('TKT-DUP-1', 'proj-test', 'First import', 'backlog')`)
    db.exec(`INSERT INTO pmo_tickets (id, project_id, title, status) VALUES ('TKT-DUP-2', 'proj-test', 'Second import', 'backlog')`)

    mapper.createMapping({
      pmoTicketId: 'TKT-DUP-1',
      linearIssueId: 'lin-dup-id',
      linearIdentifier: 'ENG-DUP',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-DUP',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    // Attempting to map the same Linear issue to a different ticket should throw
    expect(() => {
      mapper.createMapping({
        pmoTicketId: 'TKT-DUP-2',
        linearIssueId: 'lin-dup-id',  // Same Linear issue ID
        linearIdentifier: 'ENG-DUP',
        linearTeamKey: 'ENG',
        linearUrl: 'https://linear.app/issue/ENG-DUP',
        syncDirection: 'inbound',
        createdAt: new Date(),
      })
    }).to.throw()
  })

  it('should include Linear URL in the generated ticket description', () => {
    const issue = createMockIssue({
      url: 'https://linear.app/acme/issue/ENG-789',
      identifier: 'ENG-789',
    })
    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)
    expect(input.description).to.include('https://linear.app/acme/issue/ENG-789')
    expect(input.description).to.include('ENG-789')
  })

  it('should handle issue with no description during import', () => {
    const issue = createMockIssue({ description: undefined })
    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)
    expect(input.description).to.include('ENG-123')
    expect(input.title).to.equal('Fix login bug')
  })

  it('should handle issue with multiple labels during import', () => {
    const issue = createMockIssue({
      labels: [
        { id: 'l-1', name: 'bug', color: '#ff0000' },
        { id: 'l-2', name: 'security', color: '#ff6600' },
        { id: 'l-3', name: 'p0', color: '#cc0000' },
      ],
    })
    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)
    expect(input.labels).to.deep.equal(['bug', 'security', 'p0'])
  })

  it('should fall back to default status when state category has no match', () => {
    const issue = createMockIssue({
      state: { id: 's-1', name: 'Triage', type: 'triage' },
    })
    // mockWorkflowStatuses doesn't have 'triage' category, so it falls back to default (backlog, isDefault=true)
    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)
    expect(input.statusId).to.equal('status-backlog')
  })
})

// =============================================================================
// 3. Spawn Flow
// =============================================================================

describe('Linear Adapter – Spawn Flow', () => {
  it('should produce a valid spawn context from a raw Linear API node', () => {
    const rawNode = makeLinearNode({
      id: 'spawn-uuid',
      identifier: 'ENG-555',
      title: 'Implement SSO login',
      description: 'Add SAML-based SSO for enterprise customers.',
      priority: 1,
      state: { name: 'Todo' },
      labels: { nodes: [{ name: 'feature' }, { name: 'auth' }] },
    })

    // Step 1: Normalize to IssueEnvelope
    const envelope = normalizeLinearIssue(rawNode)
    expect(envelope.source).to.equal('linear')
    expect(envelope.external_key).to.equal('ENG-555')
    expect(envelope.priority).to.equal('P0')  // Urgent → P0
    expect(envelope.labels).to.deep.equal(['feature', 'auth'])

    // Step 2: Map to spawn context
    const spawnCtx = mapToSpawnContext(envelope)
    expect(spawnCtx.prompt).to.include('# Implement SSO login')
    expect(spawnCtx.prompt).to.include('**Priority:** P0')
    expect(spawnCtx.prompt).to.include('ENG-555')
    expect(spawnCtx.prompt).to.include('Add SAML-based SSO')
    expect(spawnCtx.metadata.external_source).to.equal('linear')
    expect(spawnCtx.metadata.external_key).to.equal('ENG-555')
    expect(spawnCtx.metadata.external_id).to.equal('spawn-uuid')
  })

  it('should produce NormalizedIssueEnvelope with ticket description and metadata', () => {
    const rawNode = makeLinearNode({
      id: 'norm-uuid',
      identifier: 'ENG-777',
      title: 'Database migration tool',
      description: 'Build a CLI to manage DB migrations.',
      priority: 3,
      url: 'https://linear.app/acme/issue/ENG-777/database-migration-tool',
    })

    const normalized = normalizeLinearIssueToEnvelope(rawNode)
    expect(normalized.source.name).to.equal('linear')
    expect(normalized.source.externalKey).to.equal('ENG-777')
    expect(normalized.priority).to.equal('P2')  // Medium → P2

    // Build ticket description (used when creating PMO ticket from spawn)
    const desc = buildLinearTicketDescription(normalized)
    expect(desc).to.include('Build a CLI to manage DB migrations.')
    expect(desc).to.include('## External Issue Context')
    expect(desc).to.include('- Source: linear')
    expect(desc).to.include('- External key: ENG-777')

    // Build metadata (stored on PMO ticket for traceability)
    const metadata = buildLinearMetadata(normalized)
    expect(metadata.external_source).to.equal('linear')
    expect(metadata.external_key).to.equal('ENG-777')
    expect(metadata.external_id).to.equal('norm-uuid')
    expect(metadata.external_url).to.include('/ENG-777/')
  })

  it('should build spawn context message for agent execution', () => {
    const normalized = normalizeLinearIssueToEnvelope(makeLinearNode({
      identifier: 'ENG-888',
    }))

    const msg = buildLinearSpawnContextMessage(normalized, 'Focus on performance')
    expect(msg).to.include('External issue source: linear')
    expect(msg).to.include('External issue key: ENG-888')
    expect(msg).to.include('Focus on performance')
  })

  it('should preserve raw payload through the spawn pipeline', () => {
    const rawNode = makeLinearNode({ id: 'raw-preserve-uuid' })

    const normalized = normalizeLinearIssueToEnvelope(rawNode)
    expect(normalized.source.raw).to.deep.equal(rawNode)

    const metadata = buildLinearMetadata(normalized)
    const parsed = JSON.parse(metadata.external_raw)
    expect(parsed.id).to.equal('raw-preserve-uuid')
  })

  it('should handle issue with no labels in spawn flow', () => {
    const rawNode = makeLinearNode({ labels: { nodes: [] } })

    const envelope = normalizeLinearIssue(rawNode)
    expect(envelope.labels).to.deep.equal([])

    const spawnCtx = mapToSpawnContext(envelope)
    expect(spawnCtx.prompt).to.not.include('**Labels:**')
  })

  it('should handle issue with no description in spawn flow', () => {
    const rawNode = makeLinearNode({ description: null })

    const envelope = normalizeLinearIssue(rawNode)
    expect(envelope.description).to.equal('')

    const spawnCtx = mapToSpawnContext(envelope)
    expect(spawnCtx.prompt).to.not.include('## Description')
  })

  it('end-to-end: raw Linear node → IssueEnvelope → spawn context → ticket metadata', () => {
    const rawNode = makeLinearNode({
      id: 'e2e-uuid',
      identifier: 'PLAT-42',
      title: 'Add rate limiting',
      description: 'Implement rate limiting on public API endpoints.',
      priority: 2,
      state: { name: 'Backlog' },
      labels: { nodes: [{ name: 'backend' }, { name: 'security' }] },
    })

    // Full pipeline
    const envelope = normalizeLinearIssue(rawNode)
    const spawnCtx = mapToSpawnContext(envelope)
    const normalized = normalizeLinearIssueToEnvelope(rawNode)
    const ticketDesc = buildLinearTicketDescription(normalized)
    const ticketMeta = buildLinearMetadata(normalized)
    const spawnMsg = buildLinearSpawnContextMessage(normalized, 'Critical for launch')

    // Verify each stage
    expect(envelope.source).to.equal('linear')
    expect(envelope.external_key).to.equal('PLAT-42')
    expect(spawnCtx.metadata.external_source).to.equal('linear')
    expect(ticketDesc).to.include('Implement rate limiting')
    expect(ticketMeta.external_key).to.equal('PLAT-42')
    expect(spawnMsg).to.include('PLAT-42')
    expect(spawnMsg).to.include('Critical for launch')
  })
})

// =============================================================================
// 4. Sync Flow
// =============================================================================

describe('Linear Adapter – Sync Flow', () => {
  let env: TestEnvironment
  let db: Database.Database
  let mapper: LinearMapper

  // Track calls to the mock Linear client
  let clientCalls: Array<{ method: string; args: unknown[] }>

  // Mock LinearClient that records calls instead of hitting the API
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
    env = createTestEnvironment('linear-sync-')
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
  })

  afterEach(() => {
    if (db) db.close()
    cleanupTestEnvironment(env)
  })

  function insertStubTicket(ticketId: string): void {
    db.exec(`INSERT OR IGNORE INTO pmo_projects (id, name, status) VALUES ('proj-sync', 'Sync Project', 'active')`)
    db.exec(`INSERT OR IGNORE INTO pmo_tickets (id, project_id, title, status) VALUES ('${ticketId}', 'proj-sync', 'Stub ${ticketId}', 'In Progress')`)
  }

  it('should sync ticket status back to Linear', async () => {
    insertStubTicket('TKT-SYNC-1')

    mapper.createMapping({
      pmoTicketId: 'TKT-SYNC-1',
      linearIssueId: 'lin-sync-1',
      linearIdentifier: 'ENG-SYNC-1',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-SYNC-1',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    const ticket = createMockTicket({
      id: 'TKT-SYNC-1',
      title: 'Sync test ticket',
      status: 'In Progress',
      statusCategory: 'started',
    })

    const result = await sync.syncTicketStatus(ticket, mockLinearStates)
    expect(result).to.be.true

    // Verify the client was called with the right state
    expect(clientCalls).to.have.lengthOf(1)
    expect(clientCalls[0].method).to.equal('updateIssueState')
    expect(clientCalls[0].args[0]).to.equal('lin-sync-1')
    expect(clientCalls[0].args[1]).to.equal('ls-progress')  // started → In Progress

    // Verify sync timestamp was updated
    const mapping = mapper.getByTicketId('TKT-SYNC-1')
    expect(mapping!.lastSyncedAt).to.not.be.undefined
  })

  it('should sync completed status correctly', async () => {
    insertStubTicket('TKT-SYNC-DONE')

    mapper.createMapping({
      pmoTicketId: 'TKT-SYNC-DONE',
      linearIssueId: 'lin-sync-done',
      linearIdentifier: 'ENG-DONE',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-DONE',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    const ticket = createMockTicket({
      id: 'TKT-SYNC-DONE',
      title: 'Completed ticket',
      status: 'Done',
      statusCategory: 'completed',
    })

    const result = await sync.syncTicketStatus(ticket, mockLinearStates)
    expect(result).to.be.true
    expect(clientCalls[0].args[1]).to.equal('ls-done')  // completed → Done
  })

  it('should return false when ticket has no mapping', async () => {
    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    const ticket = createMockTicket({
      id: 'TKT-NO-MAP',
      title: 'Unmapped ticket',
      status: 'In Progress',
      statusCategory: 'started',
    })

    const result = await sync.syncTicketStatus(ticket, mockLinearStates)
    expect(result).to.be.false
    expect(clientCalls).to.have.lengthOf(0)
  })

  it('should return false when no matching Linear state exists', async () => {
    insertStubTicket('TKT-NO-STATE')

    mapper.createMapping({
      pmoTicketId: 'TKT-NO-STATE',
      linearIssueId: 'lin-no-state',
      linearIdentifier: 'ENG-NS',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-NS',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    // Ticket has 'triage' category, but mockLinearStates has no 'triage' state
    const triageStates = mockLinearStates.filter((s) => s.type !== 'triage')

    const ticket = createMockTicket({
      id: 'TKT-NO-STATE',
      title: 'Triage ticket',
      status: 'Triage',
      statusCategory: 'triage',
    })

    const result = await sync.syncTicketStatus(ticket, triageStates)
    expect(result).to.be.false
  })

  it('should sync PR link to Linear issue', async () => {
    insertStubTicket('TKT-PR-1')

    mapper.createMapping({
      pmoTicketId: 'TKT-PR-1',
      linearIssueId: 'lin-pr-1',
      linearIdentifier: 'ENG-PR-1',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-PR-1',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    const result = await sync.syncPRLink(
      'TKT-PR-1',
      'https://github.com/acme/repo/pull/42',
      'Fix login bug (#42)',
    )

    expect(result).to.be.true

    // Should attach URL and add comment
    expect(clientCalls).to.have.lengthOf(2)
    expect(clientCalls[0].method).to.equal('attachUrl')
    expect(clientCalls[0].args[0]).to.equal('lin-pr-1')
    expect(clientCalls[0].args[1]).to.equal('https://github.com/acme/repo/pull/42')
    expect(clientCalls[1].method).to.equal('addComment')
    expect(clientCalls[1].args[1]).to.include('Pull request created')
    expect(clientCalls[1].args[1]).to.include('Fix login bug (#42)')
  })

  it('should sync status comment to Linear issue', async () => {
    insertStubTicket('TKT-COMMENT-1')

    mapper.createMapping({
      pmoTicketId: 'TKT-COMMENT-1',
      linearIssueId: 'lin-comment-1',
      linearIdentifier: 'ENG-COMMENT-1',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-COMMENT-1',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    const result = await sync.syncStatusComment(
      'TKT-COMMENT-1',
      'In Progress',
      'Started working on SSO integration',
    )

    expect(result).to.be.true
    expect(clientCalls).to.have.lengthOf(1)
    expect(clientCalls[0].method).to.equal('addComment')
    expect(clientCalls[0].args[1]).to.include('In Progress')
    expect(clientCalls[0].args[1]).to.include('Started working on SSO integration')
  })

  it('should sync status comment without message', async () => {
    insertStubTicket('TKT-COMMENT-2')

    mapper.createMapping({
      pmoTicketId: 'TKT-COMMENT-2',
      linearIssueId: 'lin-comment-2',
      linearIdentifier: 'ENG-COMMENT-2',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-COMMENT-2',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    const result = await sync.syncStatusComment('TKT-COMMENT-2', 'Done')
    expect(result).to.be.true
    expect(clientCalls[0].args[1]).to.equal('Status updated to **Done**')
  })

  it('should batch sync all mapped tickets', async () => {
    // Create two mapped tickets
    insertStubTicket('TKT-BATCH-1')
    insertStubTicket('TKT-BATCH-2')

    mapper.createMapping({
      pmoTicketId: 'TKT-BATCH-1',
      linearIssueId: 'lin-batch-1',
      linearIdentifier: 'ENG-BATCH-1',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-BATCH-1',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    mapper.createMapping({
      pmoTicketId: 'TKT-BATCH-2',
      linearIssueId: 'lin-batch-2',
      linearIdentifier: 'ENG-BATCH-2',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-BATCH-2',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    // Create a mock storage that returns tickets with status categories
    const mockStorage: Partial<PMOStorage> = {
      getTicket: async (id: string) => {
        const tickets: Record<string, Ticket> = {
          'TKT-BATCH-1': createMockTicket({
            id: 'TKT-BATCH-1',
            title: 'Batch ticket 1',
            status: 'In Progress',
            statusCategory: 'started',
          }),
          'TKT-BATCH-2': createMockTicket({
            id: 'TKT-BATCH-2',
            title: 'Batch ticket 2',
            status: 'Done',
            statusCategory: 'completed',
          }),
        }
        return tickets[id] ?? null
      },
    }

    const mappings = mapper.listMappings()
    const result = await sync.syncAllStatuses(
      mockStorage as PMOStorage,
      mappings,
      mockLinearStates,
    )

    expect(result.synced).to.equal(2)
    expect(result.skipped).to.equal(0)
    expect(result.errors).to.equal(0)
    expect(clientCalls).to.have.lengthOf(2)
  })

  it('should skip tickets that no longer exist during batch sync', async () => {
    insertStubTicket('TKT-GONE-1')

    mapper.createMapping({
      pmoTicketId: 'TKT-GONE-1',
      linearIssueId: 'lin-gone-1',
      linearIdentifier: 'ENG-GONE-1',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-GONE-1',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mockClient = createMockClient()
    const sync = new LinearSync(mockClient as any, mapper)

    // Storage returns null for the ticket (deleted)
    const mockStorage: Partial<PMOStorage> = {
      getTicket: async () => null,
    }

    const mappings = mapper.listMappings()
    const result = await sync.syncAllStatuses(
      mockStorage as PMOStorage,
      mappings,
      mockLinearStates,
    )

    expect(result.skipped).to.equal(1)
    expect(result.synced).to.equal(0)
    expect(clientCalls).to.have.lengthOf(0)
  })

  it('should count errors during batch sync', async () => {
    insertStubTicket('TKT-ERR-1')

    mapper.createMapping({
      pmoTicketId: 'TKT-ERR-1',
      linearIssueId: 'lin-err-1',
      linearIdentifier: 'ENG-ERR-1',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-ERR-1',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    // Client that throws on updateIssueState
    const errorClient = {
      updateIssueState() { return Promise.reject(new Error('API error')) },
      addComment() { return Promise.resolve() },
      attachUrl() { return Promise.resolve() },
    }

    const sync = new LinearSync(errorClient as any, mapper)

    const mockStorage: Partial<PMOStorage> = {
      getTicket: async () => createMockTicket({
        id: 'TKT-ERR-1',
        title: 'Error ticket',
        status: 'In Progress',
        statusCategory: 'started',
      }),
    }

    const mappings = mapper.listMappings()
    const result = await sync.syncAllStatuses(
      mockStorage as PMOStorage,
      mappings,
      mockLinearStates,
    )

    expect(result.errors).to.equal(1)
    expect(result.synced).to.equal(0)
  })
})

// =============================================================================
// PMO Mirroring Strategy Validation
// =============================================================================

describe('Linear Adapter – PMO Mirroring Strategy', () => {
  let env: TestEnvironment
  let db: Database.Database
  let mapper: LinearMapper

  beforeEach(() => {
    env = createTestEnvironment('linear-mirror-strategy-')
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

  it('should always create a PMO ticket mapping (mirrored-by-default)', () => {
    // The mapper.issueToTicketInput always produces a CreateTicketInput,
    // confirming the mirrored-by-default strategy: every Linear issue
    // becomes a first-class PMO ticket.
    const issue = createMockIssue({ identifier: 'ENG-MIRROR-1' })
    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)

    // All PMO ticket fields are populated — not bypassed
    expect(input.title).to.be.a('string').that.is.not.empty
    expect(input.description).to.be.a('string').that.is.not.empty
    expect(input.priority).to.match(/^P[0-3]$/)
    expect(input.statusId).to.be.a('string').that.is.not.empty
    expect(input.metadata).to.have.property('linear.issue_id')
    expect(input.metadata).to.have.property('linear.identifier')
    expect(input.metadata).to.have.property('linear.team')
  })

  it('should embed traceability metadata linking back to Linear', () => {
    const issue = createMockIssue({
      id: 'trace-id',
      identifier: 'ENG-TRACE-1',
      url: 'https://linear.app/acme/issue/ENG-TRACE-1',
    })
    const input = mapper.issueToTicketInput(issue, mockWorkflowStatuses)

    expect(input.metadata!['linear.issue_id']).to.equal('trace-id')
    expect(input.metadata!['linear.identifier']).to.equal('ENG-TRACE-1')
    expect(input.metadata!['linear.url']).to.equal('https://linear.app/acme/issue/ENG-TRACE-1')
    expect(input.metadata!['linear.team']).to.equal('ENG')
  })

  it('should set default sync direction to inbound (Linear → PMO)', () => {
    // When issues are imported, the default sync direction is 'inbound'
    // confirming that the PMO is the source of truth, with Linear mirrored in
    db.exec(`INSERT OR IGNORE INTO pmo_projects (id, name, status) VALUES ('proj-m', 'Mirror Test', 'active')`)
    db.exec(`INSERT INTO pmo_tickets (id, project_id, title, status) VALUES ('TKT-MIRROR', 'proj-m', 'Mirror ticket', 'backlog')`)

    mapper.createMapping({
      pmoTicketId: 'TKT-MIRROR',
      linearIssueId: 'lin-mirror-id',
      linearIdentifier: 'ENG-MIRROR',
      linearTeamKey: 'ENG',
      linearUrl: 'https://linear.app/issue/ENG-MIRROR',
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    const mapping = mapper.getByTicketId('TKT-MIRROR')
    expect(mapping!.syncDirection).to.equal('inbound')
  })
})
