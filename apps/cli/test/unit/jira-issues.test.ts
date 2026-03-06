import { expect } from 'chai'
import {
  normalizeJiraIssue,
  normalizeJiraIssueToEnvelope,
  listJiraIssues,
  getJiraIssueByKey,
  buildJiraIssueChoiceCommand,
  buildJiraMetadata,
  buildJiraTicketDescription,
  buildJiraSpawnContextMessage,
  isJiraConfigured,
  getJiraProjectKey,
  importJiraIssueToPmo,
} from '../../src/lib/external-issues/jira.js'
import { ExternalIssueAdapterError } from '../../src/lib/external-issues/types.js'

function makeJiraIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: '10001',
    key: 'PROJ-123',
    self: 'https://acme.atlassian.net/rest/api/3/issue/10001',
    fields: {
      summary: 'Fix webhook retries',
      description: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Retry transient failures with backoff.' }],
          },
        ],
      },
      labels: ['backend', 'reliability'],
      priority: { name: 'High' },
      status: { name: 'In Progress' },
      project: { key: 'PROJ' },
      issuetype: { name: 'Bug' },
      assignee: { displayName: 'Alex' },
    },
    ...overrides,
  }
}

describe('jira external issues', () => {
  const savedEnv: Record<string, string | undefined> = {}

  before(() => {
    savedEnv.PRLT_JIRA_BASE_URL = process.env.PRLT_JIRA_BASE_URL
    savedEnv.PRLT_JIRA_HOST = process.env.PRLT_JIRA_HOST
    savedEnv.PRLT_JIRA_EMAIL = process.env.PRLT_JIRA_EMAIL
    savedEnv.PRLT_JIRA_API_TOKEN = process.env.PRLT_JIRA_API_TOKEN
    savedEnv.PRLT_JIRA_PROJECT = process.env.PRLT_JIRA_PROJECT
    savedEnv.PRLT_JIRA_JQL = process.env.PRLT_JIRA_JQL
  })

  beforeEach(() => {
    delete process.env.PRLT_JIRA_BASE_URL
    delete process.env.PRLT_JIRA_HOST
    delete process.env.PRLT_JIRA_EMAIL
    delete process.env.PRLT_JIRA_API_TOKEN
    delete process.env.PRLT_JIRA_PROJECT
    delete process.env.PRLT_JIRA_JQL
  })

  after(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[key] = value
      else delete process.env[key]
    }
  })

  it('normalizes Jira issue payload', () => {
    const issue = normalizeJiraIssue(makeJiraIssue())
    expect(issue.source).to.equal('jira')
    expect(issue.external_key).to.equal('PROJ-123')
    expect(issue.priority).to.equal('P1')
    expect(issue.status).to.equal('In Progress')
    expect(issue.item_type).to.equal('Bug')
  })

  it('builds PMO metadata and context from normalized envelope', () => {
    const envelope = normalizeJiraIssueToEnvelope(makeJiraIssue())
    const description = buildJiraTicketDescription(envelope)
    const metadata = buildJiraMetadata(envelope)
    const context = buildJiraSpawnContextMessage(envelope, 'Focus on test coverage')

    expect(description).to.include('## External Issue Context')
    expect(description).to.include('- Source: jira')
    expect(metadata.external_source).to.equal('jira')
    expect(metadata.external_key).to.equal('PROJ-123')
    expect(context).to.include('External issue key: PROJ-123')
    expect(context).to.include('Focus on test coverage')
  })

  it('throws BAD_PAYLOAD for malformed payloads', () => {
    expect(() => normalizeJiraIssue({ key: 'PROJ-1' })).to.throw(ExternalIssueAdapterError)
  })

  it('throws MISSING_CONFIG when base URL is missing', async () => {
    try {
      await listJiraIssues({ email: 'test@example.com', apiToken: 'token', projectKey: 'PROJ' })
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
    }
  })

  it('throws AUTH_FAILED for 401 responses', async () => {
    const fetchImpl = async () => new Response('{}', { status: 401 })
    try {
      await listJiraIssues(
        { host: 'https://acme.atlassian.net', email: 'test@example.com', apiToken: 'token', projectKey: 'PROJ' },
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('throws BAD_PAYLOAD when issues array is missing', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ startAt: 0 }), { status: 200 })
    try {
      await listJiraIssues(
        { host: 'https://acme.atlassian.net', email: 'test@example.com', apiToken: 'token', projectKey: 'PROJ' },
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('BAD_PAYLOAD')
    }
  })

  it('returns normalized envelopes from Jira search results', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ issues: [makeJiraIssue()] }), { status: 200 })

    const issues = await listJiraIssues(
      { host: 'https://acme.atlassian.net', email: 'test@example.com', apiToken: 'token', projectKey: 'PROJ' },
      { fetchImpl },
    )

    expect(issues).to.have.length(1)
    expect(issues[0].source.name).to.equal('jira')
    expect(issues[0].source.externalKey).to.equal('PROJ-123')
    expect(issues[0].priority).to.equal('P1')
    expect(issues[0].status).to.equal('In Progress')
    expect(issues[0].category).to.equal('bug')
  })

  it('returns null when issue key does not exist', async () => {
    const fetchImpl = async () => new Response('{}', { status: 404 })
    const issue = await getJiraIssueByKey(
      { baseUrl: 'https://acme.atlassian.net', email: 'test@example.com', apiToken: 'token' },
      'PROJ-999',
      { fetchImpl },
    )
    expect(issue).to.equal(null)
  })

  it('fetches and normalizes issue by key', async () => {
    const fetchImpl = async () => new Response(JSON.stringify(makeJiraIssue({ key: 'PROJ-456' })), { status: 200 })
    const issue = await getJiraIssueByKey(
      { baseUrl: 'https://acme.atlassian.net', email: 'test@example.com', apiToken: 'token' },
      'PROJ-456',
      { fetchImpl },
    )

    expect(issue).to.not.equal(null)
    expect(issue?.source.name).to.equal('jira')
    expect(issue?.source.externalKey).to.equal('PROJ-456')
    expect(issue?.category).to.equal('bug')
  })

  it('builds issue choice command', () => {
    expect(buildJiraIssueChoiceCommand('PROJ-123', 'PROJ-001')).to.equal(
      'prlt work jira --issue PROJ-123 --json -P PROJ-001',
    )
    expect(buildJiraIssueChoiceCommand('PROJ-123')).to.equal(
      'prlt work jira --issue PROJ-123 --json',
    )
  })

  describe('isJiraConfigured', () => {
    it('returns true when host and token are set via env', () => {
      process.env.PRLT_JIRA_HOST = 'https://acme.atlassian.net'
      process.env.PRLT_JIRA_API_TOKEN = 'tok_123'
      expect(isJiraConfigured()).to.equal(true)
    })

    it('returns true when config has host and token', () => {
      expect(isJiraConfigured({
        host: 'https://acme.atlassian.net',
        apiToken: 'tok_123',
      })).to.equal(true)
    })

    it('returns false when host is missing', () => {
      process.env.PRLT_JIRA_API_TOKEN = 'tok_123'
      expect(isJiraConfigured()).to.equal(false)
    })

    it('returns false when token is missing', () => {
      process.env.PRLT_JIRA_HOST = 'https://acme.atlassian.net'
      expect(isJiraConfigured()).to.equal(false)
    })

    it('returns false when both are missing', () => {
      expect(isJiraConfigured()).to.equal(false)
    })

    it('detects JIRA_BASE_URL env var', () => {
      process.env.JIRA_BASE_URL = 'https://acme.atlassian.net'
      process.env.JIRA_API_TOKEN = 'tok_123'
      expect(isJiraConfigured()).to.equal(true)
      delete process.env.JIRA_BASE_URL
      delete process.env.JIRA_API_TOKEN
    })
  })

  describe('getJiraProjectKey', () => {
    it('returns project key from config', () => {
      expect(getJiraProjectKey({ projectKey: 'PROJ' })).to.equal('PROJ')
    })

    it('returns project key from env', () => {
      process.env.PRLT_JIRA_PROJECT = 'MYPROJ'
      expect(getJiraProjectKey()).to.equal('MYPROJ')
    })

    it('returns undefined when not set', () => {
      expect(getJiraProjectKey()).to.equal(undefined)
    })
  })

  describe('importJiraIssueToPmo', () => {
    function makeEnvelope() {
      return normalizeJiraIssueToEnvelope(makeJiraIssue())
    }

    it('creates a new PMO ticket when none exists', async () => {
      const createdTicket = { id: 'TKT-001' }
      const storage = {
        listTickets: async () => [],
        createTicket: async (_projectId: string, input: Record<string, unknown>) => {
          expect(input.title).to.equal('Fix webhook retries')
          expect((input.metadata as Record<string, string>).external_source).to.equal('jira')
          expect((input.metadata as Record<string, string>).external_key).to.equal('PROJ-123')
          return createdTicket
        },
        updateTicket: async () => { throw new Error('should not be called') },
      }

      const result = await importJiraIssueToPmo(storage, 'PROJ-001', makeEnvelope())
      expect(result.ticketId).to.equal('TKT-001')
      expect(result.created).to.equal(true)
    })

    it('updates existing PMO ticket matched by external_key', async () => {
      const existingTicket = {
        id: 'TKT-002',
        metadata: { external_source: 'jira', external_key: 'PROJ-123', external_id: '10001' },
      }
      const storage = {
        listTickets: async () => [existingTicket],
        createTicket: async () => { throw new Error('should not be called') },
        updateTicket: async (ticketId: string) => {
          expect(ticketId).to.equal('TKT-002')
          return { id: ticketId }
        },
      }

      const result = await importJiraIssueToPmo(storage, 'PROJ-001', makeEnvelope())
      expect(result.ticketId).to.equal('TKT-002')
      expect(result.created).to.equal(false)
    })

    it('updates existing PMO ticket matched by external_id', async () => {
      const existingTicket = {
        id: 'TKT-003',
        metadata: { external_source: 'jira', external_key: 'OLD-KEY', external_id: '10001' },
      }
      const storage = {
        listTickets: async () => [existingTicket],
        createTicket: async () => { throw new Error('should not be called') },
        updateTicket: async (ticketId: string) => {
          expect(ticketId).to.equal('TKT-003')
          return { id: ticketId }
        },
      }

      const result = await importJiraIssueToPmo(storage, 'PROJ-001', makeEnvelope())
      expect(result.ticketId).to.equal('TKT-003')
      expect(result.created).to.equal(false)
    })

    it('does not match tickets from different sources', async () => {
      const linearTicket = {
        id: 'TKT-004',
        metadata: { external_source: 'linear', external_key: 'PROJ-123' },
      }
      const createdTicket = { id: 'TKT-005' }
      const storage = {
        listTickets: async () => [linearTicket],
        createTicket: async () => createdTicket,
        updateTicket: async () => { throw new Error('should not be called') },
      }

      const result = await importJiraIssueToPmo(storage, 'PROJ-001', makeEnvelope())
      expect(result.ticketId).to.equal('TKT-005')
      expect(result.created).to.equal(true)
    })
  })

  describe('getJiraIssueByKey auth', () => {
    it('throws AUTH_FAILED for 403 responses', async () => {
      const fetchImpl = async () => new Response('{}', { status: 403 })
      try {
        await getJiraIssueByKey(
          { baseUrl: 'https://acme.atlassian.net', email: 'test@example.com', apiToken: 'bad-token' },
          'PROJ-123',
          { fetchImpl },
        )
        expect.fail('expected to throw')
      } catch (error) {
        expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
      }
    })

    it('throws REQUEST_FAILED for 500 responses', async () => {
      const fetchImpl = async () => new Response(JSON.stringify({ errorMessages: ['Internal error'] }), { status: 500 })
      try {
        await getJiraIssueByKey(
          { baseUrl: 'https://acme.atlassian.net', email: 'test@example.com', apiToken: 'tok' },
          'PROJ-123',
          { fetchImpl },
        )
        expect.fail('expected to throw')
      } catch (error) {
        expect((error as ExternalIssueAdapterError).code).to.equal('REQUEST_FAILED')
        expect((error as ExternalIssueAdapterError).message).to.equal('Internal error')
      }
    })
  })

  describe('listJiraIssues auth', () => {
    it('throws AUTH_FAILED for 403 responses', async () => {
      const fetchImpl = async () => new Response('{}', { status: 403 })
      try {
        await listJiraIssues(
          { host: 'https://acme.atlassian.net', email: 'test@example.com', apiToken: 'bad-token', projectKey: 'PROJ' },
          { fetchImpl },
        )
        expect.fail('expected to throw')
      } catch (error) {
        expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
      }
    })

    it('throws MISSING_CONFIG when token is missing', async () => {
      try {
        await listJiraIssues({ host: 'https://acme.atlassian.net', projectKey: 'PROJ' })
        expect.fail('expected to throw')
      } catch (error) {
        expect(error).to.be.instanceOf(ExternalIssueAdapterError)
        expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
      }
    })
  })
})
