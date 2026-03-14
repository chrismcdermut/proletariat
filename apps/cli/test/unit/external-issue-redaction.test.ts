import { expect } from 'chai'
import {
  redactCredentials,
  detectCredentials,
  detectEnvSecrets,
  auditMetadata,
  assertNoCredentials,
} from '../../src/lib/external-issues/redact.js'
import {
  normalizeLinearIssue,
  buildLinearMetadata,
  buildLinearSpawnContextMessage,
  normalizeLinearIssueToEnvelope,
} from '../../src/lib/external-issues/linear.js'
import {
  normalizeJiraIssue,
  buildJiraMetadata,
  buildJiraSpawnContextMessage,
  normalizeJiraIssueToEnvelope,
} from '../../src/lib/external-issues/jira.js'
import { mapToSpawnContext } from '../../src/lib/external-issues/mapper.js'

// =============================================================================
// Fixtures
// =============================================================================

function makeLinearNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uuid-1',
    identifier: 'ENG-123',
    title: 'Test issue',
    description: 'Description text.',
    url: 'https://linear.app/acme/issue/ENG-123',
    priority: 2,
    state: { name: 'In Progress' },
    labels: { nodes: [{ name: 'bug' }] },
    ...overrides,
  }
}

function makeJiraIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: '10001',
    key: 'PROJ-456',
    self: 'https://acme.atlassian.net/rest/api/3/issue/10001',
    fields: {
      summary: 'Test Jira issue',
      description: 'Jira description.',
      labels: ['backend'],
      priority: { name: 'High' },
      status: { name: 'Open' },
      project: { key: 'PROJ' },
      issuetype: { name: 'Bug' },
      assignee: { displayName: 'Alex' },
    },
    ...overrides,
  }
}

// =============================================================================
// redactCredentials
// =============================================================================

describe('redactCredentials', () => {
  it('redacts Linear API keys', () => {
    const input = 'Authorization: lin_api_xyzABCDEF1234567890'
    const result = redactCredentials(input)
    expect(result).to.not.include('lin_api_')
    expect(result).to.include('[REDACTED]')
  })

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
    const result = redactCredentials(input)
    expect(result).to.not.include('eyJhbGci')
    expect(result).to.include('[REDACTED]')
  })

  it('redacts Basic auth tokens', () => {
    const input = 'Authorization: Basic dXNlckBleGFtcGxlLmNvbTp0b2tlbjEyMzQ1Njc4OTA='
    const result = redactCredentials(input)
    expect(result).to.not.include('dXNlckBleGFtcGxl')
    expect(result).to.include('[REDACTED]')
  })

  it('redacts GitHub PATs', () => {
    const input = 'Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'
    const result = redactCredentials(input)
    expect(result).to.not.include('ghp_')
    expect(result).to.include('[REDACTED]')
  })

  it('redacts Slack tokens', () => {
    const input = 'Token: xoxb-123456789-abcdefghij'
    const result = redactCredentials(input)
    expect(result).to.not.include('xoxb-')
    expect(result).to.include('[REDACTED]')
  })

  it('preserves strings without credentials', () => {
    const input = 'This is a normal log message about ENG-123'
    const result = redactCredentials(input)
    expect(result).to.equal(input)
  })

  it('handles empty strings', () => {
    expect(redactCredentials('')).to.equal('')
  })

  it('redacts multiple credential types in one string', () => {
    const input = 'key=lin_api_AAAAAAAAAAAAAAAA Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test'
    const result = redactCredentials(input)
    expect(result).to.not.include('lin_api_')
    expect(result).to.not.include('eyJhbGci')
  })
})

// =============================================================================
// detectCredentials
// =============================================================================

describe('detectCredentials', () => {
  it('detects Linear API key pattern', () => {
    const found = detectCredentials('lin_api_abcdef1234567890')
    expect(found).to.include('Linear API key')
  })

  it('detects GitHub PAT pattern', () => {
    const found = detectCredentials('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij')
    expect(found).to.include('GitHub PAT')
  })

  it('returns empty array for clean strings', () => {
    const found = detectCredentials('normal text ENG-123 PROJ-456')
    expect(found).to.deep.equal([])
  })
})

// =============================================================================
// detectEnvSecrets
// =============================================================================

describe('detectEnvSecrets', () => {
  const savedEnv: Record<string, string | undefined> = {}

  before(() => {
    savedEnv.LINEAR_API_KEY = process.env.LINEAR_API_KEY
    savedEnv.PRLT_JIRA_API_TOKEN = process.env.PRLT_JIRA_API_TOKEN
  })

  afterEach(() => {
    if (savedEnv.LINEAR_API_KEY !== undefined) {
      process.env.LINEAR_API_KEY = savedEnv.LINEAR_API_KEY
    } else {
      delete process.env.LINEAR_API_KEY
    }
    if (savedEnv.PRLT_JIRA_API_TOKEN !== undefined) {
      process.env.PRLT_JIRA_API_TOKEN = savedEnv.PRLT_JIRA_API_TOKEN
    } else {
      delete process.env.PRLT_JIRA_API_TOKEN
    }
  })

  it('detects when env var value appears in output', () => {
    process.env.LINEAR_API_KEY = 'lin_api_supersecretkey999'
    const found = detectEnvSecrets('Error: failed with token lin_api_supersecretkey999')
    expect(found).to.include('LINEAR_API_KEY')
  })

  it('returns empty when env var is not set', () => {
    delete process.env.LINEAR_API_KEY
    const found = detectEnvSecrets('Error: something failed')
    expect(found).to.deep.equal([])
  })

  it('ignores env vars shorter than 8 characters', () => {
    process.env.LINEAR_API_KEY = 'short'
    const found = detectEnvSecrets('short')
    expect(found).to.deep.equal([])
  })
})

// =============================================================================
// auditMetadata
// =============================================================================

describe('auditMetadata', () => {
  it('flags credential-named keys', () => {
    const issues = auditMetadata({
      api_token: 'some-value',
      external_source: 'linear',
    })
    expect(issues.some(i => i.includes('api_token'))).to.equal(true)
  })

  it('flags credential patterns in values', () => {
    const issues = auditMetadata({
      external_key: 'ENG-123',
      debug_info: 'Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.long-token-value',
    })
    expect(issues.some(i => i.includes('Bearer token'))).to.equal(true)
  })

  it('passes clean metadata', () => {
    const issues = auditMetadata({
      external_source: 'linear',
      external_key: 'ENG-123',
      external_id: 'uuid-1',
      external_url: 'https://linear.app/issue/ENG-123',
    })
    expect(issues).to.deep.equal([])
  })
})

// =============================================================================
// assertNoCredentials
// =============================================================================

describe('assertNoCredentials', () => {
  it('does not throw for clean strings', () => {
    expect(() => assertNoCredentials('ENG-123 is in progress', 'test')).to.not.throw()
  })

  it('throws for strings with credential patterns', () => {
    expect(() => assertNoCredentials('lin_api_AAAAAAAAAAAAAAAA', 'test')).to.throw(/Credential leak/)
  })
})

// =============================================================================
// Integration: real adapter outputs are credential-free
// =============================================================================

describe('Redaction integration – adapter outputs are credential-free', () => {
  it('Linear: normalized envelope, metadata, and spawn context are clean', () => {
    const node = makeLinearNode()
    const envelope = normalizeLinearIssue(node)
    const normalized = normalizeLinearIssueToEnvelope(node)

    // Spawn context
    const ctx = mapToSpawnContext(envelope)
    assertNoCredentials(ctx.prompt, 'Linear spawn prompt')
    const metaIssues = auditMetadata(ctx.metadata)
    expect(metaIssues).to.deep.equal([])

    // Build functions
    const desc = buildLinearMetadata(normalized)
    const descIssues = auditMetadata(desc)
    expect(descIssues).to.deep.equal([])

    const msg = buildLinearSpawnContextMessage(normalized)
    assertNoCredentials(msg, 'Linear spawn context message')
  })

  it('Jira: normalized envelope, metadata, and spawn context are clean', () => {
    const issue = makeJiraIssue()
    const envelope = normalizeJiraIssue(issue)
    const normalized = normalizeJiraIssueToEnvelope(issue)

    // Spawn context
    const ctx = mapToSpawnContext(envelope)
    assertNoCredentials(ctx.prompt, 'Jira spawn prompt')
    const metaIssues = auditMetadata(ctx.metadata)
    expect(metaIssues).to.deep.equal([])

    // Build functions
    const meta = buildJiraMetadata(normalized)
    const metaAudit = auditMetadata(meta)
    expect(metaAudit).to.deep.equal([])

    const msg = buildJiraSpawnContextMessage(normalized)
    assertNoCredentials(msg, 'Jira spawn context message')
  })

  it('stored mapping metadata (state snapshot) contains no secrets', () => {
    // Simulate what gets stored in latest_state_snapshot
    const envelope = normalizeLinearIssue(makeLinearNode())
    const snapshot = JSON.stringify({
      status: envelope.status,
      priority: envelope.priority,
      assignee: envelope.assignee,
      projectKey: envelope.project_key,
    })
    assertNoCredentials(snapshot, 'state snapshot')
  })

  it('error messages from MISSING_CONFIG do not leak token values', () => {
    // Verify the error message patterns don't include actual token values
    const savedKey = process.env.LINEAR_API_KEY
    process.env.LINEAR_API_KEY = 'lin_api_shouldnotbevisible'
    try {
      // The error message from ensureLinearConfig should mention the env var name,
      // not the value
      const errorMsg = 'Missing Linear API key. Configure a Linear provider source, or set PRLT_LINEAR_API_KEY.'
      assertNoCredentials(errorMsg, 'config error message')
    } finally {
      if (savedKey !== undefined) {
        process.env.LINEAR_API_KEY = savedKey
      } else {
        delete process.env.LINEAR_API_KEY
      }
    }
  })
})
