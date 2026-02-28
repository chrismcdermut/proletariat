import { expect } from 'chai'
import {
  normalizeLinearIssue,
  listLinearIssues,
  buildLinearIssueChoiceCommand,
  buildLinearMetadata,
} from '../../src/lib/external-issues/linear.js'
import { ExternalIssueAdapterError } from '../../src/lib/external-issues/types.js'

describe('linear external issues', () => {
  it('normalizes a linear issue into a deterministic envelope', () => {
    const envelope = normalizeLinearIssue({
      id: 'uuid-1',
      identifier: 'ENG-123',
      title: 'Fix flaky CI checks',
      description: 'CI fails intermittently on macOS.',
      url: 'https://linear.app/acme/issue/ENG-123/fix-flaky-ci-checks',
      priority: 2,
      state: { name: 'In Progress' },
      labels: { nodes: [{ name: 'bug' }, { name: 'ci' }] },
    })

    expect(envelope.title).to.equal('Fix flaky CI checks')
    expect(envelope.priority).to.equal('P1')
    expect(envelope.category).to.equal('bug')
    expect(envelope.labels).to.deep.equal(['bug', 'ci'])
    expect(envelope.statusName).to.equal('In Progress')
    expect(envelope.source.source).to.equal('linear')
    expect(envelope.source.externalKey).to.equal('ENG-123')
    expect(envelope.source.externalId).to.equal('uuid-1')
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

  it('throws MISSING_CONFIG when api key is missing', async () => {
    try {
      await listLinearIssues({ team: 'ENG', apiKey: '' }, { fetchImpl: async () => new Response('{}') })
      expect.fail('expected listLinearIssues to throw')
    } catch (error) {
      const typed = error as ExternalIssueAdapterError
      expect(typed.code).to.equal('MISSING_CONFIG')
      expect(typed.message).to.match(/Missing Linear API key/)
    }
  })

  it('throws AUTH_FAILED for unauthorized responses', async () => {
    const fetchImpl = async () => new Response('{}', { status: 401 })

    try {
      await listLinearIssues({ team: 'ENG', apiKey: 'token' }, { fetchImpl })
      expect.fail('expected listLinearIssues to throw')
    } catch (error) {
      const typed = error as ExternalIssueAdapterError
      expect(typed.code).to.equal('AUTH_FAILED')
    }
  })

  it('throws BAD_PAYLOAD when issues.nodes is missing', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ data: {} }), { status: 200 })

    try {
      await listLinearIssues({ team: 'ENG', apiKey: 'token' }, { fetchImpl })
      expect.fail('expected listLinearIssues to throw')
    } catch (error) {
      const typed = error as ExternalIssueAdapterError
      expect(typed.code).to.equal('BAD_PAYLOAD')
    }
  })

  it('builds metadata with required traceability fields', () => {
    const metadata = buildLinearMetadata(normalizeLinearIssue({
      id: 'uuid-1',
      identifier: 'ENG-123',
      title: 'Fix flaky CI checks',
      url: 'https://linear.app/acme/issue/ENG-123/fix-flaky-ci-checks',
      description: 'desc',
      priority: 2,
      labels: { nodes: [{ name: 'bug' }] },
      state: { name: 'Todo' },
    }))

    expect(metadata.external_source).to.equal('linear')
    expect(metadata.external_key).to.equal('ENG-123')
    expect(metadata.external_id).to.equal('uuid-1')
    expect(metadata.external_url).to.include('/ENG-123/')
    expect(metadata.external_raw).to.be.a('string')
  })

  it('smoke: generates linear issue command path for selection', () => {
    const cmd = buildLinearIssueChoiceCommand('ENG-123', 'proj-1')
    expect(cmd).to.equal('prlt work linear --issue ENG-123 --json -P proj-1')
  })
})
