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
})
