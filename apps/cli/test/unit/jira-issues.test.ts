import { expect } from 'chai'
import {
  normalizeJiraIssue,
  normalizeJiraIssueToEnvelope,
  buildJiraTicketDescription,
  buildJiraMetadata,
  buildJiraSpawnContextMessage,
  getJiraIssueByKey,
} from '../../src/lib/external-issues/jira.js'
import { ExternalIssueAdapterError } from '../../src/lib/external-issues/types.js'

function makeJiraIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'jira-1',
    key: 'PROJ-123',
    self: 'https://acme.atlassian.net/rest/api/3/issue/1001',
    fields: {
      summary: 'Fix deployment rollback handling',
      description: 'Handle rollback state correctly in deploy pipeline.',
      labels: ['deploy', 'bug'],
      priority: { name: 'High' },
      status: { name: 'In Progress' },
      project: { key: 'PROJ' },
      assignee: { displayName: 'Pat Dev' },
      issuetype: { name: 'Bug' },
    },
    ...overrides,
  }
}

describe('jira external issues', () => {
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

  it('returns null when Jira issue is not found', async () => {
    const fetchImpl = async () => new Response('{}', { status: 404 })
    const issue = await getJiraIssueByKey(
      { baseUrl: 'https://acme.atlassian.net', apiToken: 'token', email: 'dev@acme.com' },
      'PROJ-999',
      { fetchImpl }
    )
    expect(issue).to.equal(null)
  })

  it('throws AUTH_FAILED for 401 response', async () => {
    const fetchImpl = async () => new Response('{}', { status: 401 })
    try {
      await getJiraIssueByKey(
        { baseUrl: 'https://acme.atlassian.net', apiToken: 'token', email: 'dev@acme.com' },
        'PROJ-123',
        { fetchImpl }
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('fetches and normalizes Jira issue by key', async () => {
    const fetchImpl = async () => new Response(JSON.stringify(makeJiraIssue()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

    const issue = await getJiraIssueByKey(
      { baseUrl: 'https://acme.atlassian.net', apiToken: 'token', email: 'dev@acme.com' },
      'PROJ-123',
      { fetchImpl }
    )

    expect(issue).to.not.equal(null)
    expect(issue?.source.name).to.equal('jira')
    expect(issue?.source.externalKey).to.equal('PROJ-123')
    expect(issue?.category).to.equal('bug')
  })
})
