import { expect } from 'chai'
import {
  normalizeShortcutStory,
  normalizeShortcutStoryToEnvelope,
  listShortcutStories,
  getShortcutStoryByKey,
  buildShortcutStoryChoiceCommand,
  buildShortcutMetadata,
  buildShortcutTicketDescription,
  buildShortcutSpawnContextMessage,
  importShortcutStoryToPmo,
} from '../../src/lib/external-issues/shortcut.js'
import { ExternalIssueAdapterError } from '../../src/lib/external-issues/types.js'

function makeShortcutStory(overrides: Record<string, unknown> = {}) {
  return {
    id: 12345,
    name: 'Implement dark mode',
    description: 'Add dark mode toggle to settings.',
    app_url: 'https://app.shortcut.com/my-workspace/story/12345',
    story_type: 'feature',
    labels: [
      { name: 'frontend' },
      { name: 'P1' },
    ],
    workflow_state_id: 500000001,
    estimate: 3,
    owner_ids: ['member-1'],
    group_id: 'group-abc',
    ...overrides,
  }
}

describe('shortcut external issues', () => {
  const savedEnv: Record<string, string | undefined> = {}

  before(() => {
    savedEnv.PRLT_SHORTCUT_API_TOKEN = process.env.PRLT_SHORTCUT_API_TOKEN
    savedEnv.SHORTCUT_API_TOKEN = process.env.SHORTCUT_API_TOKEN
    savedEnv.PRLT_SHORTCUT_WORKSPACE = process.env.PRLT_SHORTCUT_WORKSPACE
  })

  beforeEach(() => {
    delete process.env.PRLT_SHORTCUT_API_TOKEN
    delete process.env.SHORTCUT_API_TOKEN
    delete process.env.PRLT_SHORTCUT_WORKSPACE
  })

  after(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[key] = value
      else delete process.env[key]
    }
  })

  it('normalizes Shortcut story payload', () => {
    const issue = normalizeShortcutStory(makeShortcutStory())
    expect(issue.source).to.equal('shortcut')
    expect(issue.external_id).to.equal('12345')
    expect(issue.external_key).to.equal('sc-12345')
    expect(issue.title).to.equal('Implement dark mode')
    expect(issue.labels).to.include('frontend')
    expect(issue.labels).to.include('P1')
    expect(issue.priority).to.equal('P1')
    expect(issue.item_type).to.equal('feature')
    expect(issue.project_key).to.equal('group-abc')
  })

  it('normalizes story to envelope with category', () => {
    const envelope = normalizeShortcutStoryToEnvelope(makeShortcutStory())
    expect(envelope.source.name).to.equal('shortcut')
    expect(envelope.source.externalKey).to.equal('sc-12345')
    expect(envelope.category).to.equal('feature')
  })

  it('derives bug category from story type', () => {
    const envelope = normalizeShortcutStoryToEnvelope(makeShortcutStory({ story_type: 'bug' }))
    expect(envelope.category).to.equal('bug')
  })

  it('derives chore category from story type', () => {
    const envelope = normalizeShortcutStoryToEnvelope(makeShortcutStory({ story_type: 'chore' }))
    expect(envelope.category).to.equal('chore')
  })

  it('builds PMO metadata and context from normalized envelope', () => {
    const envelope = normalizeShortcutStoryToEnvelope(makeShortcutStory())
    const description = buildShortcutTicketDescription(envelope)
    const metadata = buildShortcutMetadata(envelope)
    const context = buildShortcutSpawnContextMessage(envelope, 'Focus on accessibility')

    expect(description).to.include('## External Issue Context')
    expect(description).to.include('- Source: shortcut')
    expect(metadata.external_source).to.equal('shortcut')
    expect(metadata.external_key).to.equal('sc-12345')
    expect(context).to.include('External issue key: sc-12345')
    expect(context).to.include('Focus on accessibility')
  })

  it('throws BAD_PAYLOAD for malformed payloads', () => {
    expect(() => normalizeShortcutStory({ id: 1 })).to.throw(ExternalIssueAdapterError)
  })

  it('throws BAD_PAYLOAD for null input', () => {
    expect(() => normalizeShortcutStory(null)).to.throw(ExternalIssueAdapterError)
  })

  it('throws MISSING_CONFIG when token is missing', async () => {
    try {
      await listShortcutStories({})
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
    }
  })

  it('passes search query and page_size in the URL when listing stories', async () => {
    let capturedUrl = ''
    const fetchImpl = async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/workflows')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      capturedUrl = urlStr
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }

    await listShortcutStories(
      { apiToken: 'tok' },
      { query: 'is:story owner:me', limit: 10, fetchImpl },
    )

    expect(capturedUrl).to.include('/search/stories?')
    expect(capturedUrl).to.include('query=')
    expect(capturedUrl).to.include(encodeURIComponent('is:story owner:me'))
    expect(capturedUrl).to.include('page_size=10')
  })

  it('throws AUTH_FAILED for 401 responses when listing stories', async () => {
    const fetchImpl = async () => new Response('{}', { status: 401 })
    try {
      await listShortcutStories(
        { apiToken: 'bad-token' },
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('throws RATE_LIMITED for 429 responses when listing stories', async () => {
    const fetchImpl = async () => new Response('{}', { status: 429 })
    try {
      await listShortcutStories(
        { apiToken: 'tok' },
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('RATE_LIMITED')
    }
  })

  it('returns null when story is not found by key', async () => {
    let callCount = 0
    const fetchImpl = async (url: string | URL | Request) => {
      callCount++
      const urlStr = typeof url === 'string' ? url : url.toString()
      // First call: workflows endpoint
      if (urlStr.includes('/workflows')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      // Second call: story endpoint
      return new Response('{}', { status: 404 })
    }

    const issue = await getShortcutStoryByKey(
      { apiToken: 'tok' },
      'sc-99999',
      { fetchImpl },
    )
    expect(issue).to.equal(null)
  })

  it('throws AUTH_FAILED for 401 when fetching story by key', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/workflows')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response('{}', { status: 401 })
    }

    try {
      await getShortcutStoryByKey(
        { apiToken: 'bad-token' },
        'sc-123',
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('throws BAD_PAYLOAD for invalid story key format', async () => {
    try {
      await getShortcutStoryByKey(
        { apiToken: 'tok' },
        'invalid-key',
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('BAD_PAYLOAD')
    }
  })

  it('fetches and normalizes story by key', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/workflows')) {
        return new Response(JSON.stringify([{
          states: [
            { id: 500000001, name: 'In Progress', type: 'started' },
          ],
        }]), { status: 200 })
      }
      return new Response(JSON.stringify(makeShortcutStory()), { status: 200 })
    }

    const issue = await getShortcutStoryByKey(
      { apiToken: 'tok' },
      'sc-12345',
      { fetchImpl },
    )

    expect(issue).to.not.equal(null)
    expect(issue?.source.name).to.equal('shortcut')
    expect(issue?.source.externalKey).to.equal('sc-12345')
    expect(issue?.status).to.equal('In Progress')
    expect(issue?.category).to.equal('feature')
  })

  it('accepts plain numeric ID', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/workflows')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response(JSON.stringify(makeShortcutStory()), { status: 200 })
    }

    const issue = await getShortcutStoryByKey(
      { apiToken: 'tok' },
      '12345',
      { fetchImpl },
    )

    expect(issue).to.not.equal(null)
    expect(issue?.source.externalKey).to.equal('sc-12345')
  })

  it('builds story choice command', () => {
    expect(buildShortcutStoryChoiceCommand('sc-123', 'PROJ-001')).to.equal(
      'prlt work shortcut --issue sc-123 --json -P PROJ-001',
    )
    expect(buildShortcutStoryChoiceCommand('sc-123')).to.equal(
      'prlt work shortcut --issue sc-123 --json',
    )
  })

  describe('importShortcutStoryToPmo', () => {
    function makeEnvelope() {
      return normalizeShortcutStoryToEnvelope(makeShortcutStory())
    }

    it('creates a new PMO ticket when none exists', async () => {
      const createdTicket = { id: 'TKT-001' }
      const storage = {
        listTickets: async () => [],
        createTicket: async (_projectId: string, input: Record<string, unknown>) => {
          expect(input.title).to.equal('Implement dark mode')
          expect((input.metadata as Record<string, string>).external_source).to.equal('shortcut')
          expect((input.metadata as Record<string, string>).external_key).to.equal('sc-12345')
          return createdTicket
        },
        updateTicket: async () => { throw new Error('should not be called') },
      }

      const result = await importShortcutStoryToPmo(storage, 'PROJ-001', makeEnvelope())
      expect(result.ticketId).to.equal('TKT-001')
      expect(result.created).to.equal(true)
    })

    it('updates existing PMO ticket matched by external_key', async () => {
      const existingTicket = {
        id: 'TKT-002',
        metadata: { external_source: 'shortcut', external_key: 'sc-12345', external_id: '12345' },
      }
      const storage = {
        listTickets: async () => [existingTicket],
        createTicket: async () => { throw new Error('should not be called') },
        updateTicket: async (ticketId: string) => {
          expect(ticketId).to.equal('TKT-002')
          return { id: ticketId }
        },
      }

      const result = await importShortcutStoryToPmo(storage, 'PROJ-001', makeEnvelope())
      expect(result.ticketId).to.equal('TKT-002')
      expect(result.created).to.equal(false)
    })

    it('does not match tickets from different sources', async () => {
      const linearTicket = {
        id: 'TKT-004',
        metadata: { external_source: 'linear', external_key: 'sc-12345' },
      }
      const createdTicket = { id: 'TKT-005' }
      const storage = {
        listTickets: async () => [linearTicket],
        createTicket: async () => createdTicket,
        updateTicket: async () => { throw new Error('should not be called') },
      }

      const result = await importShortcutStoryToPmo(storage, 'PROJ-001', makeEnvelope())
      expect(result.ticketId).to.equal('TKT-005')
      expect(result.created).to.equal(true)
    })
  })
})
