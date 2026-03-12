import { expect } from 'chai'
import {
  normalizeTrelloCard,
  normalizeTrelloCardToEnvelope,
  getTrelloCardById,
  listTrelloCards,
  buildTrelloCardChoiceCommand,
  buildTrelloMetadata,
  buildTrelloTicketDescription,
  buildTrelloSpawnContextMessage,
  importTrelloCardToPmo,
} from '../../src/lib/external-issues/trello.js'
import { ExternalIssueAdapterError } from '../../src/lib/external-issues/types.js'

function makeTrelloCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'abc123def456',
    name: 'Fix login button',
    desc: 'The login button does not work on mobile.',
    url: 'https://trello.com/c/abc123def456',
    shortUrl: 'https://trello.com/c/abc123',
    idBoard: 'board-xyz',
    idList: 'list-todo',
    idMembers: ['member-1'],
    labels: [
      { id: 'lbl1', name: 'bug' },
      { id: 'lbl2', name: 'P1' },
    ],
    closed: false,
    due: null,
    dueComplete: false,
    members: [
      { id: 'member-1', fullName: 'Jane Doe', username: 'janedoe' },
    ],
    ...overrides,
  }
}

describe('trello external issues', () => {
  const savedEnv: Record<string, string | undefined> = {}

  before(() => {
    savedEnv.PRLT_TRELLO_API_KEY = process.env.PRLT_TRELLO_API_KEY
    savedEnv.TRELLO_API_KEY = process.env.TRELLO_API_KEY
    savedEnv.PRLT_TRELLO_API_TOKEN = process.env.PRLT_TRELLO_API_TOKEN
    savedEnv.TRELLO_API_TOKEN = process.env.TRELLO_API_TOKEN
    savedEnv.PRLT_TRELLO_BOARD_ID = process.env.PRLT_TRELLO_BOARD_ID
  })

  beforeEach(() => {
    delete process.env.PRLT_TRELLO_API_KEY
    delete process.env.TRELLO_API_KEY
    delete process.env.PRLT_TRELLO_API_TOKEN
    delete process.env.TRELLO_API_TOKEN
    delete process.env.PRLT_TRELLO_BOARD_ID
  })

  after(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[key] = value
      else delete process.env[key]
    }
  })

  it('normalizes Trello card payload', () => {
    const issue = normalizeTrelloCard(makeTrelloCard())
    expect(issue.source).to.equal('trello')
    expect(issue.external_id).to.equal('abc123def456')
    expect(issue.external_key).to.equal('abc123def456')
    expect(issue.title).to.equal('Fix login button')
    expect(issue.description).to.equal('The login button does not work on mobile.')
    expect(issue.labels).to.include('bug')
    expect(issue.labels).to.include('P1')
    expect(issue.priority).to.equal('P1')
    expect(issue.status).to.equal('Open')
    expect(issue.url).to.equal('https://trello.com/c/abc123def456')
    expect(issue.project_key).to.equal('board-xyz')
    expect(issue.assignee).to.equal('Jane Doe')
    expect(issue.item_type).to.equal('card')
  })

  it('normalizes closed card status', () => {
    const issue = normalizeTrelloCard(makeTrelloCard({ closed: true }))
    expect(issue.status).to.equal('Closed')
  })

  it('uses list name as status when provided', () => {
    const issue = normalizeTrelloCard(makeTrelloCard(), 'In Progress')
    expect(issue.status).to.equal('In Progress')
  })

  it('normalizes card to envelope with category', () => {
    const envelope = normalizeTrelloCardToEnvelope(makeTrelloCard())
    expect(envelope.source.name).to.equal('trello')
    expect(envelope.source.externalKey).to.equal('abc123def456')
    expect(envelope.category).to.equal('feature')
  })

  it('builds PMO metadata and context from normalized envelope', () => {
    const envelope = normalizeTrelloCardToEnvelope(makeTrelloCard())
    const description = buildTrelloTicketDescription(envelope)
    const metadata = buildTrelloMetadata(envelope)
    const context = buildTrelloSpawnContextMessage(envelope, 'Focus on mobile')

    expect(description).to.include('## External Issue Context')
    expect(description).to.include('- Source: trello')
    expect(metadata.external_source).to.equal('trello')
    expect(metadata.external_key).to.equal('abc123def456')
    expect(context).to.include('External issue key: abc123def456')
    expect(context).to.include('Focus on mobile')
  })

  it('throws BAD_PAYLOAD for malformed payloads', () => {
    expect(() => normalizeTrelloCard({ id: 'x' })).to.throw(ExternalIssueAdapterError)
  })

  it('throws BAD_PAYLOAD for null input', () => {
    expect(() => normalizeTrelloCard(null)).to.throw(ExternalIssueAdapterError)
  })

  it('throws MISSING_CONFIG when api key is missing', async () => {
    try {
      await listTrelloCards({}, { query: 'test' })
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
    }
  })

  it('throws MISSING_CONFIG when api token is missing', async () => {
    try {
      await listTrelloCards({ apiKey: 'key' }, { query: 'test' })
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
    }
  })

  it('throws AUTH_FAILED for 401 responses when fetching card', async () => {
    const fetchImpl = async () => new Response('{}', { status: 401 })
    try {
      await getTrelloCardById(
        { apiKey: 'key', apiToken: 'bad-token' },
        'abc123',
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('throws RATE_LIMITED for 429 responses', async () => {
    const fetchImpl = async () => new Response('{}', { status: 429 })
    try {
      await getTrelloCardById(
        { apiKey: 'key', apiToken: 'tok' },
        'abc123',
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('RATE_LIMITED')
    }
  })

  it('returns null when card is not found', async () => {
    const fetchImpl = async () => new Response('{}', { status: 404 })
    const result = await getTrelloCardById(
      { apiKey: 'key', apiToken: 'tok' },
      'nonexistent',
      { fetchImpl },
    )
    expect(result).to.equal(null)
  })

  it('fetches and normalizes card by ID', async () => {
    const card = makeTrelloCard()
    let callCount = 0
    const fetchImpl = async (url: string | URL | Request) => {
      callCount++
      const urlStr = typeof url === 'string' ? url : url.toString()
      // First call: card endpoint. Second call: list endpoint for status
      if (urlStr.includes('/lists/')) {
        return new Response(JSON.stringify({ id: 'list-todo', name: 'To Do' }), { status: 200 })
      }
      return new Response(JSON.stringify(card), { status: 200 })
    }

    const result = await getTrelloCardById(
      { apiKey: 'key', apiToken: 'tok' },
      'abc123def456',
      { fetchImpl },
    )

    expect(result).to.not.equal(null)
    expect(result?.source.name).to.equal('trello')
    expect(result?.source.externalKey).to.equal('abc123def456')
    expect(result?.title).to.equal('Fix login button')
    expect(result?.status).to.equal('To Do')
  })

  it('builds card choice command', () => {
    expect(buildTrelloCardChoiceCommand('abc123', 'PROJ-001')).to.equal(
      'prlt work start --from trello:abc123 --json -P PROJ-001',
    )
    expect(buildTrelloCardChoiceCommand('abc123')).to.equal(
      'prlt work start --from trello:abc123 --json',
    )
  })

  it('handles card with no members', () => {
    const card = makeTrelloCard({ members: [], idMembers: [] })
    const issue = normalizeTrelloCard(card)
    expect(issue.assignee).to.equal(null)
  })

  it('handles card with no labels', () => {
    const card = makeTrelloCard({ labels: [] })
    const issue = normalizeTrelloCard(card)
    expect(issue.labels).to.deep.equal([])
    expect(issue.priority).to.equal(null)
  })

  describe('importTrelloCardToPmo', () => {
    function makeEnvelope() {
      return normalizeTrelloCardToEnvelope(makeTrelloCard())
    }

    it('creates a new PMO ticket when none exists', async () => {
      const createdTicket = { id: 'TKT-001' }
      const storage = {
        listTickets: async () => [],
        createTicket: async (_projectId: string, input: Record<string, unknown>) => {
          expect(input.title).to.equal('Fix login button')
          expect((input.metadata as Record<string, string>).external_source).to.equal('trello')
          expect((input.metadata as Record<string, string>).external_key).to.equal('abc123def456')
          return createdTicket
        },
        updateTicket: async () => { throw new Error('should not be called') },
      }

      const result = await importTrelloCardToPmo(storage, 'PROJ-001', makeEnvelope())
      expect(result.ticketId).to.equal('TKT-001')
      expect(result.created).to.equal(true)
    })

    it('updates existing PMO ticket matched by external_key', async () => {
      const existingTicket = {
        id: 'TKT-002',
        metadata: { external_source: 'trello', external_key: 'abc123def456', external_id: 'abc123def456' },
      }
      const storage = {
        listTickets: async () => [existingTicket],
        createTicket: async () => { throw new Error('should not be called') },
        updateTicket: async (ticketId: string) => {
          expect(ticketId).to.equal('TKT-002')
          return { id: ticketId }
        },
      }

      const result = await importTrelloCardToPmo(storage, 'PROJ-001', makeEnvelope())
      expect(result.ticketId).to.equal('TKT-002')
      expect(result.created).to.equal(false)
    })

    it('does not match tickets from different sources', async () => {
      const linearTicket = {
        id: 'TKT-004',
        metadata: { external_source: 'linear', external_key: 'abc123def456' },
      }
      const createdTicket = { id: 'TKT-005' }
      const storage = {
        listTickets: async () => [linearTicket],
        createTicket: async () => createdTicket,
        updateTicket: async () => { throw new Error('should not be called') },
      }

      const result = await importTrelloCardToPmo(storage, 'PROJ-001', makeEnvelope())
      expect(result.ticketId).to.equal('TKT-005')
      expect(result.created).to.equal(true)
    })
  })
})
