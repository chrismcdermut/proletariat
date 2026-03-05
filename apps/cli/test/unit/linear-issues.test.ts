import { expect } from 'chai'
import {
  normalizeLinearIssue,
  normalizeLinearIssueToEnvelope,
  listLinearIssues,
  getLinearIssueByIdentifier,
  buildLinearIssueChoiceCommand,
  buildLinearMetadata,
  buildLinearTicketDescription,
  buildLinearSpawnContextMessage,
} from '../../src/lib/external-issues/linear.js'
import {
  ExternalIssueAdapterError,
  toNormalizedEnvelope,
} from '../../src/lib/external-issues/types.js'
import { mapToSpawnContext } from '../../src/lib/external-issues/mapper.js'

// =============================================================================
// Helpers
// =============================================================================

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

// =============================================================================
// normalizeLinearIssue → IssueEnvelope
// =============================================================================

describe('normalizeLinearIssue (IssueEnvelope)', () => {
  it('normalizes a linear issue into a flat IssueEnvelope', () => {
    const envelope = normalizeLinearIssue(makeLinearNode())

    expect(envelope.source).to.equal('linear')
    expect(envelope.external_id).to.equal('uuid-1')
    expect(envelope.external_key).to.equal('ENG-123')
    expect(envelope.title).to.equal('Fix flaky CI checks')
    expect(envelope.priority).to.equal('P1')
    expect(envelope.status).to.equal('In Progress')
    expect(envelope.labels).to.deep.equal(['bug', 'ci'])
    expect(envelope.project_key).to.equal('ENG')
    expect(envelope.item_type).to.equal('issue')
    expect(envelope.assignee).to.equal(null)
  })

  it('maps all Linear priority levels', () => {
    expect(normalizeLinearIssue(makeLinearNode({ priority: 1 })).priority).to.equal('P0')
    expect(normalizeLinearIssue(makeLinearNode({ priority: 2 })).priority).to.equal('P1')
    expect(normalizeLinearIssue(makeLinearNode({ priority: 3 })).priority).to.equal('P2')
    expect(normalizeLinearIssue(makeLinearNode({ priority: 4 })).priority).to.equal('P3')
    expect(normalizeLinearIssue(makeLinearNode({ priority: 0 })).priority).to.equal(null)
    expect(normalizeLinearIssue(makeLinearNode({ priority: null })).priority).to.equal(null)
  })

  it('handles missing description', () => {
    expect(normalizeLinearIssue(makeLinearNode({ description: null })).description).to.equal('')
  })

  it('handles empty and missing labels', () => {
    expect(normalizeLinearIssue(makeLinearNode({ labels: { nodes: [] } })).labels).to.deep.equal([])
    expect(normalizeLinearIssue(makeLinearNode({ labels: undefined })).labels).to.deep.equal([])
  })

  it('handles missing state', () => {
    expect(normalizeLinearIssue(makeLinearNode({ state: undefined })).status).to.equal('Unknown')
  })

  it('throws BAD_PAYLOAD for malformed issue payloads', () => {
    expect(() => normalizeLinearIssue({ id: 'only-id' })).to.throw(ExternalIssueAdapterError)

    try {
      normalizeLinearIssue({ id: 'only-id' })
    } catch (error) {
      const typed = error as ExternalIssueAdapterError
      expect(typed.code).to.equal('BAD_PAYLOAD')
    }
  })

  it('throws BAD_PAYLOAD for null input', () => {
    expect(() => normalizeLinearIssue(null)).to.throw(ExternalIssueAdapterError)
  })

  it('throws BAD_PAYLOAD for non-object input', () => {
    expect(() => normalizeLinearIssue('string')).to.throw(ExternalIssueAdapterError)
  })
})

// =============================================================================
// normalizeLinearIssueToEnvelope → NormalizedIssueEnvelope
// =============================================================================

describe('normalizeLinearIssueToEnvelope (NormalizedIssueEnvelope)', () => {
  it('produces a NormalizedIssueEnvelope with nested source', () => {
    const normalized = normalizeLinearIssueToEnvelope(makeLinearNode())

    expect(normalized.source.name).to.equal('linear')
    expect(normalized.source.externalId).to.equal('uuid-1')
    expect(normalized.source.externalKey).to.equal('ENG-123')
    expect(normalized.source.url).to.include('/ENG-123/')
    expect(normalized.title).to.equal('Fix flaky CI checks')
    expect(normalized.priority).to.equal('P1')
    expect(normalized.status).to.equal('In Progress')
    expect(normalized.projectKey).to.equal('ENG')
    expect(normalized.category).to.equal('feature')
    expect(normalized.labels).to.deep.equal(['bug', 'ci'])
  })

  it('preserves the raw payload in source', () => {
    const node = makeLinearNode()
    const normalized = normalizeLinearIssueToEnvelope(node)
    expect(normalized.source.raw).to.deep.equal(node)
  })
})

// =============================================================================
// toNormalizedEnvelope
// =============================================================================

describe('toNormalizedEnvelope', () => {
  it('converts IssueEnvelope to NormalizedIssueEnvelope', () => {
    const envelope = normalizeLinearIssue(makeLinearNode())
    const normalized = toNormalizedEnvelope(envelope, 'bug')

    expect(normalized.source.name).to.equal('linear')
    expect(normalized.source.externalKey).to.equal('ENG-123')
    expect(normalized.category).to.equal('bug')
  })

  it('defaults category to null', () => {
    const envelope = normalizeLinearIssue(makeLinearNode())
    const normalized = toNormalizedEnvelope(envelope)
    expect(normalized.category).to.equal(null)
  })

  it('is deterministic', () => {
    const envelope = normalizeLinearIssue(makeLinearNode())
    const a = toNormalizedEnvelope(envelope, 'feature')
    const b = toNormalizedEnvelope(envelope, 'feature')
    expect(a).to.deep.equal(b)
  })
})

// =============================================================================
// buildLinearTicketDescription
// =============================================================================

describe('buildLinearTicketDescription', () => {
  it('includes body and external issue context', () => {
    const normalized = normalizeLinearIssueToEnvelope(makeLinearNode())
    const desc = buildLinearTicketDescription(normalized)

    expect(desc).to.include('CI fails intermittently on macOS.')
    expect(desc).to.include('## External Issue Context')
    expect(desc).to.include('- Source: linear')
    expect(desc).to.include('- External key: ENG-123')
    expect(desc).to.include('- External id: uuid-1')
    expect(desc).to.include('- Status: In Progress')
    expect(desc).to.include('- Priority: P1')
    expect(desc).to.include('- Labels: bug, ci')
  })
})

// =============================================================================
// buildLinearMetadata
// =============================================================================

describe('buildLinearMetadata', () => {
  it('returns traceability metadata', () => {
    const normalized = normalizeLinearIssueToEnvelope(makeLinearNode())
    const metadata = buildLinearMetadata(normalized)

    expect(metadata.external_source).to.equal('linear')
    expect(metadata.external_key).to.equal('ENG-123')
    expect(metadata.external_id).to.equal('uuid-1')
    expect(metadata.external_url).to.include('/ENG-123/')
    expect(metadata.external_raw).to.be.a('string')
    expect(JSON.parse(metadata.external_raw)).to.be.an('object')
  })
})

// =============================================================================
// buildLinearSpawnContextMessage
// =============================================================================

describe('buildLinearSpawnContextMessage', () => {
  it('includes source metadata lines', () => {
    const normalized = normalizeLinearIssueToEnvelope(makeLinearNode())
    const msg = buildLinearSpawnContextMessage(normalized)

    expect(msg).to.include('External issue source: linear')
    expect(msg).to.include('External issue key: ENG-123')
    expect(msg).to.include('External issue id: uuid-1')
    expect(msg).to.include('External issue URL:')
  })

  it('appends additional message when provided', () => {
    const normalized = normalizeLinearIssueToEnvelope(makeLinearNode())
    const msg = buildLinearSpawnContextMessage(normalized, 'Focus on macOS')
    expect(msg).to.include('Focus on macOS')
  })

  it('ignores whitespace-only additional message', () => {
    const normalized = normalizeLinearIssueToEnvelope(makeLinearNode())
    const msgWithout = buildLinearSpawnContextMessage(normalized)
    const msgWith = buildLinearSpawnContextMessage(normalized, '   ')
    expect(msgWith).to.equal(msgWithout)
  })
})

// =============================================================================
// buildLinearIssueChoiceCommand
// =============================================================================

describe('buildLinearIssueChoiceCommand', () => {
  it('generates command path for selection', () => {
    const cmd = buildLinearIssueChoiceCommand('ENG-123', 'proj-1')
    expect(cmd).to.equal('prlt work linear --issue ENG-123 --json -P proj-1')
  })

  it('omits project flag when not provided', () => {
    const cmd = buildLinearIssueChoiceCommand('ENG-123')
    expect(cmd).to.equal('prlt work linear --issue ENG-123 --json')
  })
})

// =============================================================================
// ExternalIssueAdapterError
// =============================================================================

describe('ExternalIssueAdapterError', () => {
  it('has correct name, code, and message', () => {
    const err = new ExternalIssueAdapterError('MISSING_CONFIG', 'Missing API key')
    expect(err.name).to.equal('ExternalIssueAdapterError')
    expect(err.code).to.equal('MISSING_CONFIG')
    expect(err.message).to.equal('Missing API key')
    expect(err).to.be.instanceOf(Error)
  })

  it('preserves causeDetail', () => {
    const detail = { response: 'bad' }
    const err = new ExternalIssueAdapterError('BAD_PAYLOAD', 'Invalid', detail)
    expect(err.causeDetail).to.deep.equal(detail)
  })
})

// =============================================================================
// listLinearIssues - config validation + error handling
// =============================================================================

describe('listLinearIssues', () => {
  const savedEnv: Record<string, string | undefined> = {}

  before(() => {
    savedEnv.LINEAR_API_KEY = process.env.LINEAR_API_KEY
    savedEnv.PRLT_LINEAR_API_KEY = process.env.PRLT_LINEAR_API_KEY
    savedEnv.PRLT_LINEAR_TEAM = process.env.PRLT_LINEAR_TEAM
    savedEnv.LINEAR_TEAM_KEY = process.env.LINEAR_TEAM_KEY
  })

  beforeEach(() => {
    delete process.env.LINEAR_API_KEY
    delete process.env.PRLT_LINEAR_API_KEY
    delete process.env.PRLT_LINEAR_TEAM
    delete process.env.LINEAR_TEAM_KEY
  })

  after(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[key] = value
      else delete process.env[key]
    }
  })

  it('throws MISSING_CONFIG when api key is missing', async () => {
    try {
      await listLinearIssues({ team: 'ENG', apiKey: '' })
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
      expect((error as ExternalIssueAdapterError).message).to.match(/API key/)
    }
  })

  it('throws MISSING_CONFIG when team key is missing', async () => {
    try {
      await listLinearIssues({ apiKey: 'lin_api_test' })
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
      expect((error as ExternalIssueAdapterError).message).to.include('team')
    }
  })

  it('throws AUTH_FAILED for 401 responses', async () => {
    const fetchImpl = async () => new Response('{}', { status: 401 })
    try {
      await listLinearIssues({ team: 'ENG', apiKey: 'token' }, { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('throws AUTH_FAILED for 403 responses', async () => {
    const fetchImpl = async () => new Response('{}', { status: 403 })
    try {
      await listLinearIssues({ team: 'ENG', apiKey: 'token' }, { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('throws REQUEST_FAILED for 500 responses', async () => {
    const fetchImpl = async () => new Response('{}', { status: 500 })
    try {
      await listLinearIssues({ team: 'ENG', apiKey: 'token' }, { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('REQUEST_FAILED')
    }
  })

  it('throws AUTH_FAILED on GraphQL auth errors', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      errors: [{ message: 'Authentication token is invalid' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    try {
      await listLinearIssues({ team: 'ENG', apiKey: 'token' }, { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('throws BAD_PAYLOAD when issues.nodes is missing', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ data: {} }), { status: 200 })
    try {
      await listLinearIssues({ team: 'ENG', apiKey: 'token' }, { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('BAD_PAYLOAD')
    }
  })

  it('throws RATE_LIMITED for 429 responses', async () => {
    const fetchImpl = async () => new Response('{}', { status: 429 })
    try {
      await listLinearIssues({ team: 'ENG', apiKey: 'token' }, { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('RATE_LIMITED')
      expect((error as ExternalIssueAdapterError).message).to.match(/rate limit/i)
    }
  })

  it('throws RATE_LIMITED on GraphQL rate-limit errors', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      errors: [{ message: 'Rate limit exceeded, retry after 1000ms' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    try {
      await listLinearIssues({ team: 'ENG', apiKey: 'token' }, { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('RATE_LIMITED')
    }
  })

  it('returns NormalizedIssueEnvelopes on success', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      data: { issues: { nodes: [makeLinearNode()] } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })

    const results = await listLinearIssues({ apiKey: 'key', team: 'ENG' }, { fetchImpl })
    expect(results).to.have.length(1)
    expect(results[0].source.name).to.equal('linear')
    expect(results[0].source.externalKey).to.equal('ENG-123')
    expect(results[0].title).to.equal('Fix flaky CI checks')
  })
})

describe('getLinearIssueByIdentifier', () => {
  const savedEnv: Record<string, string | undefined> = {}

  before(() => {
    savedEnv.LINEAR_API_KEY = process.env.LINEAR_API_KEY
    savedEnv.PRLT_LINEAR_API_KEY = process.env.PRLT_LINEAR_API_KEY
    savedEnv.PRLT_LINEAR_TEAM = process.env.PRLT_LINEAR_TEAM
    savedEnv.LINEAR_TEAM_KEY = process.env.LINEAR_TEAM_KEY
  })

  beforeEach(() => {
    delete process.env.LINEAR_API_KEY
    delete process.env.PRLT_LINEAR_API_KEY
    delete process.env.PRLT_LINEAR_TEAM
    delete process.env.LINEAR_TEAM_KEY
  })

  after(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[key] = value
      else delete process.env[key]
    }
  })

  it('does not require team key for direct identifier lookup', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      data: { issue: makeLinearNode() },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })

    const issue = await getLinearIssueByIdentifier(
      { apiKey: 'token-without-team' },
      'ENG-123',
      { fetchImpl }
    )

    expect(issue).to.not.equal(null)
    expect(issue?.source.name).to.equal('linear')
    expect(issue?.source.externalKey).to.equal('ENG-123')
  })

  it('returns null when issue is not found', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      data: { issue: null },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })

    const issue = await getLinearIssueByIdentifier(
      { apiKey: 'token' },
      'ENG-999',
      { fetchImpl }
    )

    expect(issue).to.equal(null)
  })

  it('returns null on GraphQL not-found error', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      errors: [{ message: 'Entity not found' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })

    const issue = await getLinearIssueByIdentifier(
      { apiKey: 'token' },
      'ENG-999',
      { fetchImpl }
    )

    expect(issue).to.equal(null)
  })

  it('throws AUTH_FAILED for 401 responses', async () => {
    const fetchImpl = async () => new Response('{}', { status: 401 })
    try {
      await getLinearIssueByIdentifier({ apiKey: 'bad-token' }, 'ENG-123', { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('throws RATE_LIMITED for 429 responses', async () => {
    const fetchImpl = async () => new Response('{}', { status: 429 })
    try {
      await getLinearIssueByIdentifier({ apiKey: 'token' }, 'ENG-123', { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('RATE_LIMITED')
      expect((error as ExternalIssueAdapterError).message).to.match(/rate limit/i)
    }
  })

  it('throws RATE_LIMITED on GraphQL rate-limit errors', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      errors: [{ message: 'Too many requests, please try again later' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    try {
      await getLinearIssueByIdentifier({ apiKey: 'token' }, 'ENG-123', { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('RATE_LIMITED')
    }
  })

  it('throws REQUEST_FAILED for 500 responses', async () => {
    const fetchImpl = async () => new Response('{}', { status: 500 })
    try {
      await getLinearIssueByIdentifier({ apiKey: 'token' }, 'ENG-123', { fetchImpl })
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('REQUEST_FAILED')
    }
  })
})

// =============================================================================
// Smoke test: Linear → spawn command generation path
// =============================================================================

describe('Linear → spawn command generation (smoke)', () => {
  it('validates end-to-end: raw Linear issue → IssueEnvelope → NormalizedEnvelope → spawn context → command args', () => {
    // Step 1: Raw Linear API response node
    const rawNode = makeLinearNode({
      id: 'smoke-uuid',
      identifier: 'ENG-999',
      title: 'Smoke test issue',
      description: 'End-to-end validation of the spawn pipeline.',
      priority: 1,
      state: { name: 'Todo' },
      labels: { nodes: [{ name: 'smoke' }] },
    })

    // Step 2: Normalize to IssueEnvelope
    const envelope = normalizeLinearIssue(rawNode)
    expect(envelope.source).to.equal('linear')
    expect(envelope.external_key).to.equal('ENG-999')
    expect(envelope.priority).to.equal('P0')

    // Step 3: Convert to NormalizedIssueEnvelope
    const normalized = normalizeLinearIssueToEnvelope(rawNode)
    expect(normalized.source.externalKey).to.equal('ENG-999')
    expect(normalized.category).to.equal('feature')

    // Step 4: Map to spawn context
    const spawnCtx = mapToSpawnContext(envelope)
    expect(spawnCtx.prompt).to.include('# Smoke test issue')
    expect(spawnCtx.prompt).to.include('**Priority:** P0')
    expect(spawnCtx.prompt).to.include('ENG-999')
    expect(spawnCtx.metadata.external_source).to.equal('linear')
    expect(spawnCtx.metadata.external_key).to.equal('ENG-999')
    expect(spawnCtx.metadata.external_id).to.equal('smoke-uuid')

    // Step 5: Build ticket description and metadata for PMO
    const ticketDesc = buildLinearTicketDescription(normalized)
    expect(ticketDesc).to.include('End-to-end validation')
    expect(ticketDesc).to.include('## External Issue Context')

    const ticketMeta = buildLinearMetadata(normalized)
    expect(ticketMeta.external_source).to.equal('linear')
    expect(ticketMeta.external_key).to.equal('ENG-999')

    // Step 6: Build spawn context message
    const spawnMsg = buildLinearSpawnContextMessage(normalized, 'Run full test suite')
    expect(spawnMsg).to.include('External issue source: linear')
    expect(spawnMsg).to.include('ENG-999')
    expect(spawnMsg).to.include('Run full test suite')

    // Step 7: Build CLI command for selection
    const cmd = buildLinearIssueChoiceCommand('ENG-999', 'PROJ-001')
    expect(cmd).to.equal('prlt work linear --issue ENG-999 --json -P PROJ-001')
  })
})
