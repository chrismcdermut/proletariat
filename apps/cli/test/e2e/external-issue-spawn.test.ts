import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import {
  normalizeLinearIssue,
  normalizeLinearIssueToEnvelope,
  listLinearIssues,
  getLinearIssueByIdentifier,
  buildLinearTicketDescription,
  buildLinearMetadata,
  buildLinearSpawnContextMessage,
} from '../../src/lib/external-issues/linear.js'
import {
  normalizeJiraIssue,
  normalizeJiraIssueToEnvelope,
  listJiraIssues,
  getJiraIssueByKey,
  buildJiraTicketDescription,
  buildJiraMetadata,
  buildJiraSpawnContextMessage,
} from '../../src/lib/external-issues/jira.js'
import { mapToSpawnContext } from '../../src/lib/external-issues/mapper.js'
import { validateIssueEnvelope } from '../../src/lib/external-issues/validation.js'
import { LinearIssueAdapter, JiraIssueAdapter } from '../../src/lib/external-issues/adapters.js'
import { ExternalExecutionMappingStore } from '../../src/lib/external-issues/mapping-store.js'
import {
  ExternalIssueAdapterError,
  ExternalIssueError,
  toNormalizedEnvelope,
} from '../../src/lib/external-issues/types.js'

// =============================================================================
// Test Fixtures
// =============================================================================

function makeLinearNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uuid-lin-001',
    identifier: 'ENG-42',
    title: 'Implement caching layer',
    description: 'Add Redis-backed caching for hot paths.',
    url: 'https://linear.app/acme/issue/ENG-42/implement-caching-layer',
    priority: 1,
    state: { name: 'Todo' },
    labels: { nodes: [{ name: 'performance' }, { name: 'backend' }] },
    ...overrides,
  }
}

function makeJiraIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: '20001',
    key: 'INFRA-77',
    self: 'https://acme.atlassian.net/rest/api/3/issue/20001',
    fields: {
      summary: 'Upgrade Kubernetes to 1.29',
      description: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Rolling upgrade of k8s clusters.' }],
          },
        ],
      },
      labels: ['infra', 'k8s'],
      priority: { name: 'Critical' },
      status: { name: 'Open' },
      project: { key: 'INFRA' },
      issuetype: { name: 'Task' },
      assignee: { displayName: 'Jordan' },
    },
    ...overrides,
  }
}

// =============================================================================
// Linear Happy Path E2E
// =============================================================================

describe('External Issue Spawn E2E – Linear happy path', () => {
  let testDir: string
  let db: Database.Database
  let store: ExternalExecutionMappingStore

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-spawn-linear-'))
    db = new Database(path.join(testDir, 'test.db'))
    db.pragma('foreign_keys = ON')
    store = new ExternalExecutionMappingStore(db)
  })

  afterEach(() => {
    db.close()
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('end-to-end: raw Linear node → normalize → validate → spawn context → persist mapping', () => {
    const rawNode = makeLinearNode()

    // Step 1: Normalize to IssueEnvelope
    const envelope = normalizeLinearIssue(rawNode)
    expect(envelope.source).to.equal('linear')
    expect(envelope.external_id).to.equal('uuid-lin-001')
    expect(envelope.external_key).to.equal('ENG-42')
    expect(envelope.title).to.equal('Implement caching layer')
    expect(envelope.priority).to.equal('P0')
    expect(envelope.labels).to.deep.equal(['performance', 'backend'])

    // Step 2: Validate envelope
    const validation = validateIssueEnvelope(envelope)
    expect(validation.valid).to.equal(true)

    // Step 3: Map to spawn context
    const ctx = mapToSpawnContext(envelope)
    expect(ctx.prompt).to.include('# Implement caching layer')
    expect(ctx.prompt).to.include('**Priority:** P0')
    expect(ctx.prompt).to.include('ENG-42')
    expect(ctx.metadata.external_source).to.equal('linear')
    expect(ctx.metadata.external_key).to.equal('ENG-42')
    expect(ctx.metadata.external_id).to.equal('uuid-lin-001')

    // Step 4: Persist mapping via adapter
    const adapter = new LinearIssueAdapter()
    const mapping = adapter.persistMapping(store, envelope, {
      executionId: 'WORK-00001111',
      lastSpawnedAt: new Date(),
    })

    expect(mapping.provider).to.equal('linear')
    expect(mapping.externalId).to.equal('uuid-lin-001')
    expect(mapping.externalKey).to.equal('ENG-42')
    expect(mapping.executionIds).to.include('WORK-00001111')
    expect(mapping.lastSpawnedAt).to.not.equal(null)

    // Step 5: Retrieve mapping
    const retrieved = adapter.readMappingByExternalId(store, 'uuid-lin-001')
    expect(retrieved).to.not.equal(null)
    expect(retrieved!.externalKey).to.equal('ENG-42')
  })

  it('builds PMO artifacts from normalized envelope', () => {
    const normalized = normalizeLinearIssueToEnvelope(makeLinearNode())

    const desc = buildLinearTicketDescription(normalized)
    expect(desc).to.include('Add Redis-backed caching for hot paths.')
    expect(desc).to.include('## External Issue Context')
    expect(desc).to.include('- Source: linear')
    expect(desc).to.include('- External key: ENG-42')

    const metadata = buildLinearMetadata(normalized)
    expect(metadata.external_source).to.equal('linear')
    expect(metadata.external_key).to.equal('ENG-42')

    const msg = buildLinearSpawnContextMessage(normalized, 'Focus on perf')
    expect(msg).to.include('External issue source: linear')
    expect(msg).to.include('ENG-42')
    expect(msg).to.include('Focus on perf')
  })

  it('fetches Linear issues via mock API (list)', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          data: { issues: { nodes: [makeLinearNode()] } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    const results = await listLinearIssues(
      { apiKey: 'lin_api_test', team: 'ENG' },
      { fetchImpl },
    )
    expect(results).to.have.length(1)
    expect(results[0].source.name).to.equal('linear')
    expect(results[0].title).to.equal('Implement caching layer')
  })

  it('fetches Linear issue by identifier via mock API', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({ data: { issue: makeLinearNode() } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    const issue = await getLinearIssueByIdentifier(
      { apiKey: 'lin_api_test' },
      'ENG-42',
      { fetchImpl },
    )
    expect(issue).to.not.equal(null)
    expect(issue!.source.externalKey).to.equal('ENG-42')
  })
})

// =============================================================================
// Jira Happy Path E2E
// =============================================================================

describe('External Issue Spawn E2E – Jira happy path', () => {
  let testDir: string
  let db: Database.Database
  let store: ExternalExecutionMappingStore

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-spawn-jira-'))
    db = new Database(path.join(testDir, 'test.db'))
    db.pragma('foreign_keys = ON')
    store = new ExternalExecutionMappingStore(db)
  })

  afterEach(() => {
    db.close()
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('end-to-end: raw Jira payload → normalize → validate → spawn context → persist mapping', () => {
    const rawIssue = makeJiraIssue()

    // Step 1: Normalize to IssueEnvelope
    const envelope = normalizeJiraIssue(rawIssue)
    expect(envelope.source).to.equal('jira')
    expect(envelope.external_id).to.equal('20001')
    expect(envelope.external_key).to.equal('INFRA-77')
    expect(envelope.title).to.equal('Upgrade Kubernetes to 1.29')
    expect(envelope.priority).to.equal('P1')
    expect(envelope.item_type).to.equal('Task')
    expect(envelope.assignee).to.equal('Jordan')

    // Step 2: Validate
    const validation = validateIssueEnvelope(envelope)
    expect(validation.valid).to.equal(true)

    // Step 3: Spawn context
    const ctx = mapToSpawnContext(envelope)
    expect(ctx.prompt).to.include('# Upgrade Kubernetes to 1.29')
    expect(ctx.prompt).to.include('**Priority:** P1')
    expect(ctx.prompt).to.include('INFRA-77')
    expect(ctx.metadata.external_source).to.equal('jira')
    expect(ctx.metadata.external_key).to.equal('INFRA-77')

    // Step 4: Persist
    const adapter = new JiraIssueAdapter()
    const mapping = adapter.persistMapping(store, envelope, {
      executionId: 'WORK-JIRA-001',
      prUrl: 'https://github.com/acme/infra/pull/99',
      lastSpawnedAt: new Date(),
    })

    expect(mapping.provider).to.equal('jira')
    expect(mapping.externalId).to.equal('20001')
    expect(mapping.executionIds).to.include('WORK-JIRA-001')
    expect(mapping.prUrls).to.deep.equal(['https://github.com/acme/infra/pull/99'])

    // Step 5: Query by execution
    const found = adapter.readMappingsByExecutionId(store, 'WORK-JIRA-001')
    expect(found).to.have.length(1)
    expect(found[0].externalKey).to.equal('INFRA-77')
  })

  it('builds PMO artifacts from normalized Jira envelope', () => {
    const normalized = normalizeJiraIssueToEnvelope(makeJiraIssue())

    const desc = buildJiraTicketDescription(normalized)
    expect(desc).to.include('Rolling upgrade of k8s clusters.')
    expect(desc).to.include('## External Issue Context')
    expect(desc).to.include('- Source: jira')
    expect(desc).to.include('- External key: INFRA-77')

    const metadata = buildJiraMetadata(normalized)
    expect(metadata.external_source).to.equal('jira')
    expect(metadata.external_id).to.equal('20001')

    const msg = buildJiraSpawnContextMessage(normalized, 'Skip staging')
    expect(msg).to.include('External issue source: jira')
    expect(msg).to.include('INFRA-77')
    expect(msg).to.include('Skip staging')
  })

  it('fetches Jira issues via mock API (search)', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({ issues: [makeJiraIssue()] }),
        { status: 200 },
      )

    const results = await listJiraIssues(
      {
        host: 'https://acme.atlassian.net',
        email: 'bot@acme.com',
        apiToken: 'jira-tok',
        projectKey: 'INFRA',
      },
      { fetchImpl },
    )
    expect(results).to.have.length(1)
    expect(results[0].source.name).to.equal('jira')
    expect(results[0].title).to.equal('Upgrade Kubernetes to 1.29')
  })

  it('fetches single Jira issue by key via mock API', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify(makeJiraIssue()), { status: 200 })

    const issue = await getJiraIssueByKey(
      {
        baseUrl: 'https://acme.atlassian.net',
        email: 'bot@acme.com',
        apiToken: 'jira-tok',
      },
      'INFRA-77',
      { fetchImpl },
    )
    expect(issue).to.not.equal(null)
    expect(issue!.source.externalKey).to.equal('INFRA-77')
    expect(issue!.category).to.equal('feature')
  })
})

// =============================================================================
// Key Failure Modes
// =============================================================================

describe('External Issue Spawn E2E – failure modes', () => {
  const savedEnv: Record<string, string | undefined> = {}

  before(() => {
    for (const key of [
      'LINEAR_API_KEY', 'PRLT_LINEAR_API_KEY', 'PRLT_LINEAR_TEAM', 'LINEAR_TEAM_KEY',
      'PRLT_JIRA_BASE_URL', 'JIRA_BASE_URL', 'PRLT_JIRA_HOST', 'JIRA_HOST',
      'PRLT_JIRA_EMAIL', 'JIRA_EMAIL', 'PRLT_JIRA_API_TOKEN', 'JIRA_API_TOKEN',
      'PRLT_JIRA_PROJECT', 'JIRA_PROJECT_KEY', 'PRLT_JIRA_JQL',
    ]) {
      savedEnv[key] = process.env[key]
    }
  })

  beforeEach(() => {
    for (const key of Object.keys(savedEnv)) {
      delete process.env[key]
    }
  })

  after(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[key] = value
      else delete process.env[key]
    }
  })

  // -- Linear failures --------------------------------------------------------

  it('Linear: MISSING_CONFIG when API key is absent', async () => {
    try {
      await listLinearIssues({ team: 'ENG', apiKey: '' })
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
    }
  })

  it('Linear: AUTH_FAILED on 401', async () => {
    const fetchImpl = async () => new Response('{}', { status: 401 })
    try {
      await listLinearIssues({ team: 'ENG', apiKey: 'bad' }, { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('Linear: AUTH_FAILED on GraphQL auth error', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({ errors: [{ message: 'Authentication token is invalid' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    try {
      await listLinearIssues({ team: 'ENG', apiKey: 'bad' }, { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('Linear: REQUEST_FAILED on 500', async () => {
    const fetchImpl = async () => new Response('{}', { status: 500 })
    try {
      await listLinearIssues({ team: 'ENG', apiKey: 'tok' }, { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('REQUEST_FAILED')
    }
  })

  it('Linear: BAD_PAYLOAD when response is missing data', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ data: {} }), { status: 200 })
    try {
      await listLinearIssues({ team: 'ENG', apiKey: 'tok' }, { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('BAD_PAYLOAD')
    }
  })

  it('Linear: BAD_PAYLOAD for malformed issue node', () => {
    expect(() => normalizeLinearIssue({ id: 'only-id' })).to.throw(ExternalIssueAdapterError)
  })

  it('Linear: returns null for not-found identifier lookup', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({ data: { issue: null } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    const result = await getLinearIssueByIdentifier(
      { apiKey: 'tok' },
      'ENG-NONEXISTENT',
      { fetchImpl },
    )
    expect(result).to.equal(null)
  })

  // -- Jira failures ----------------------------------------------------------

  it('Jira: MISSING_CONFIG when base URL is absent', async () => {
    try {
      await listJiraIssues({ email: 'e@x.com', apiToken: 'tok', projectKey: 'P' })
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
    }
  })

  it('Jira: MISSING_CONFIG when API token is absent', async () => {
    try {
      await listJiraIssues({ host: 'https://x.atlassian.net', email: 'e@x.com', apiToken: '', projectKey: 'P' })
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
    }
  })

  it('Jira: AUTH_FAILED on 401', async () => {
    const fetchImpl = async () => new Response('{}', { status: 401 })
    try {
      await listJiraIssues(
        { host: 'https://x.atlassian.net', email: 'e@x.com', apiToken: 'tok', projectKey: 'P' },
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('Jira: AUTH_FAILED on 403', async () => {
    const fetchImpl = async () => new Response('{}', { status: 403 })
    try {
      await listJiraIssues(
        { host: 'https://x.atlassian.net', email: 'e@x.com', apiToken: 'tok', projectKey: 'P' },
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('Jira: REQUEST_FAILED on 500', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ errorMessages: ['Internal Server Error'] }), { status: 500 })
    try {
      await listJiraIssues(
        { host: 'https://x.atlassian.net', email: 'e@x.com', apiToken: 'tok', projectKey: 'P' },
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('REQUEST_FAILED')
    }
  })

  it('Jira: BAD_PAYLOAD when issues array is missing', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ total: 0 }), { status: 200 })
    try {
      await listJiraIssues(
        { host: 'https://x.atlassian.net', email: 'e@x.com', apiToken: 'tok', projectKey: 'P' },
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('BAD_PAYLOAD')
    }
  })

  it('Jira: BAD_PAYLOAD for malformed issue payload', () => {
    expect(() => normalizeJiraIssue({ key: 'X-1' })).to.throw(ExternalIssueAdapterError)
  })

  it('Jira: returns null for 404 on single issue fetch', async () => {
    const fetchImpl = async () => new Response('{}', { status: 404 })
    const result = await getJiraIssueByKey(
      { baseUrl: 'https://x.atlassian.net', email: 'e@x.com', apiToken: 'tok' },
      'PROJ-999',
      { fetchImpl },
    )
    expect(result).to.equal(null)
  })

  // -- Validation failures ----------------------------------------------------

  it('validates envelope: rejects null input', () => {
    const result = validateIssueEnvelope(null)
    expect(result.valid).to.equal(false)
  })

  it('validates envelope: rejects missing required fields', () => {
    const result = validateIssueEnvelope({ source: 'linear' })
    expect(result.valid).to.equal(false)
    if (!result.valid) {
      expect(result.errors.length).to.be.greaterThan(0)
      const fields = result.errors.map(e => e.field)
      expect(fields).to.include('external_id')
      expect(fields).to.include('title')
    }
  })

  it('validates envelope: rejects invalid source', () => {
    const result = validateIssueEnvelope({
      source: 'github',
      external_id: 'x',
      external_key: 'X-1',
      title: 'T',
      description: '',
      labels: [],
      priority: null,
      status: 'Open',
      url: 'https://example.com',
      project_key: 'X',
      assignee: null,
      raw: {},
    })
    expect(result.valid).to.equal(false)
    if (!result.valid) {
      expect(result.errors[0].code).to.equal('INVALID_SOURCE')
    }
  })

  it('mapToSpawnContext throws VALIDATION_FAILED for invalid input', () => {
    try {
      mapToSpawnContext({ bad: true })
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueError)
      expect((error as ExternalIssueError).code).to.equal('VALIDATION_FAILED')
    }
  })
})

// =============================================================================
// Machine Mode / Adapter Contract
// =============================================================================

describe('External Issue Spawn E2E – adapter contract & machine mode', () => {
  let testDir: string
  let db: Database.Database
  let store: ExternalExecutionMappingStore

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-spawn-adapter-'))
    db = new Database(path.join(testDir, 'test.db'))
    db.pragma('foreign_keys = ON')
    store = new ExternalExecutionMappingStore(db)
  })

  afterEach(() => {
    db.close()
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('LinearIssueAdapter conforms to ExternalIssueAdapter contract', () => {
    const adapter = new LinearIssueAdapter()
    expect(adapter.source).to.equal('linear')
    expect(adapter.normalize).to.be.a('function')
    expect(adapter.fetchByKey).to.be.a('function')
    expect(adapter.fetchByQuery).to.be.a('function')
  })

  it('JiraIssueAdapter conforms to ExternalIssueAdapter contract', () => {
    const adapter = new JiraIssueAdapter()
    expect(adapter.source).to.equal('jira')
    expect(adapter.normalize).to.be.a('function')
    expect(adapter.fetchByKey).to.be.a('function')
    expect(adapter.fetchByQuery).to.be.a('function')
  })

  it('LinearIssueAdapter.normalize produces valid envelope', () => {
    const adapter = new LinearIssueAdapter()
    const envelope = adapter.normalize(makeLinearNode())
    const result = validateIssueEnvelope(envelope)
    expect(result.valid).to.equal(true)
  })

  it('JiraIssueAdapter.normalize produces valid envelope', () => {
    const adapter = new JiraIssueAdapter()
    const envelope = adapter.normalize(makeJiraIssue())
    const result = validateIssueEnvelope(envelope)
    expect(result.valid).to.equal(true)
  })

  it('toNormalizedEnvelope is deterministic for both sources', () => {
    const linearEnvelope = normalizeLinearIssue(makeLinearNode())
    const a = toNormalizedEnvelope(linearEnvelope, 'feature')
    const b = toNormalizedEnvelope(linearEnvelope, 'feature')
    expect(a).to.deep.equal(b)

    const jiraEnvelope = normalizeJiraIssue(makeJiraIssue())
    const c = toNormalizedEnvelope(jiraEnvelope, 'bug')
    const d = toNormalizedEnvelope(jiraEnvelope, 'bug')
    expect(c).to.deep.equal(d)
  })

  it('mapping store supports both providers in the same database', () => {
    const linearAdapter = new LinearIssueAdapter()
    const jiraAdapter = new JiraIssueAdapter()

    const linearEnvelope = normalizeLinearIssue(makeLinearNode())
    const jiraEnvelope = normalizeJiraIssue(makeJiraIssue())

    linearAdapter.persistMapping(store, linearEnvelope, { executionId: 'EXEC-LIN' })
    jiraAdapter.persistMapping(store, jiraEnvelope, { executionId: 'EXEC-JIRA' })

    const linMapping = store.getByExternalId('linear', 'uuid-lin-001')
    const jiraMapping = store.getByExternalId('jira', '20001')

    expect(linMapping).to.not.equal(null)
    expect(jiraMapping).to.not.equal(null)
    expect(linMapping!.externalKey).to.equal('ENG-42')
    expect(jiraMapping!.externalKey).to.equal('INFRA-77')
  })

  it('multiple executions can be linked to the same external issue', () => {
    const adapter = new LinearIssueAdapter()
    const envelope = normalizeLinearIssue(makeLinearNode())

    adapter.persistMapping(store, envelope, { executionId: 'EXEC-1' })
    adapter.persistMapping(store, envelope, { executionId: 'EXEC-2' })
    adapter.persistMapping(store, envelope, { executionId: 'EXEC-3' })

    const mapping = store.getByExternalId('linear', 'uuid-lin-001')
    expect(mapping!.executionIds).to.include('EXEC-1')
    expect(mapping!.executionIds).to.include('EXEC-2')
    expect(mapping!.executionIds).to.include('EXEC-3')
  })

  it('spawn context metadata contains no raw credential values', () => {
    const linearEnv = normalizeLinearIssue(makeLinearNode())
    const jiraEnv = normalizeJiraIssue(makeJiraIssue())

    const linCtx = mapToSpawnContext(linearEnv)
    const jiraCtx = mapToSpawnContext(jiraEnv)

    // Metadata key names that are expected traceability fields (not secrets)
    const allowedKeyPatterns = [
      'external_source', 'external_id', 'external_key', 'external_url',
      'external_project', 'external_status', 'external_priority',
      'external_assignee', 'external_labels', 'external_item_type',
    ]

    for (const ctx of [linCtx, jiraCtx]) {
      for (const [key, value] of Object.entries(ctx.metadata)) {
        // Check that keys are known traceability fields, not credential fields
        if (!allowedKeyPatterns.includes(key)) {
          expect(key).to.not.match(/^(api[_-]?token|api[_-]?key|secret|password|credential|auth[_-]?token)$/i,
            `metadata key "${key}" looks like a credential field`)
        }
        // Check that values don't contain credential patterns
        expect(value).to.not.match(/^(lin_api_|xox[bprs]-|ghp_|gho_|sk-)/,
          `metadata value for "${key}" looks like a credential pattern`)
      }
      expect(ctx.prompt).to.not.match(/lin_api_|xox[bprs]-|ghp_|gho_|sk-/,
        'prompt should not contain credential patterns')
    }
  })
})
