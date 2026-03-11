import { expect } from 'chai'
import {
  normalizeTrelloCard,
  normalizeTrelloCardToEnvelope,
  listTrelloCards,
  getTrelloCardById,
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
    shortLink: 'xYz789',
    name: 'Implement dark mode',
    desc: 'Add dark mode toggle to settings.',
    url: 'https://trello.com/c/xYz789/1-implement-dark-mode',
    shortUrl: 'https://trello.com/c/xYz789',
    idBoard: 'board123',
    idList: 'list456',
    labels: [
      { id: 'label1', name: 'frontend', color: 'green' },
      { id: 'label2', name: 'P1', color: 'red' },
    ],
    closed: false,
    due: null,
    idMembers: ['member1'],
    ...overrides,
  }
}

describe('trello external issues', () => {
  const savedEnv: Record<string, string | undefined> = {}

  before(() => {
    savedEnv.PRLT_TRELLO_API_KEY = process.env.PRLT_TRELLO_API_KEY
    savedEnv.TRELLO_API_KEY = process.env.TRELLO_API_KEY
    savedEnv.PRLT_TRELLO_TOKEN = process.env.PRLT_TRELLO_TOKEN
    savedEnv.TRELLO_TOKEN = process.env.TRELLO_TOKEN
    savedEnv.PRLT_TRELLO_BOARD_ID = process.env.PRLT_TRELLO_BOARD_ID
    savedEnv.TRELLO_BOARD_ID = process.env.TRELLO_BOARD_ID
  })

  beforeEach(() => {
    delete process.env.PRLT_TRELLO_API_KEY
    delete process.env.TRELLO_API_KEY
    delete process.env.PRLT_TRELLO_TOKEN
    delete process.env.TRELLO_TOKEN
    delete process.env.PRLT_TRELLO_BOARD_ID
    delete process.env.TRELLO_BOARD_ID
  })

  after(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[key] = value
      else delete process.env[key]
    }
  })

  it('normalizes Trello card payload', () => {
    const issue = normalizeTrelloCard(makeTrelloCard(), 'In Progress')
    expect(issue.source).to.equal('trello')
    expect(issue.external_id).to.equal('abc123def456')
    expect(issue.external_key).to.equal('trello-xYz789')
    expect(issue.title).to.equal('Implement dark mode')
    expect(issue.labels).to.include('frontend')
    expect(issue.labels).to.include('P1')
    expect(issue.priority).to.equal('P1')
    expect(issue.item_type).to.equal('card')
    expect(issue.project_key).to.equal('board123')
    expect(issue.status).to.equal('In Progress')
  })

  it('uses Open status when no list name provided and card is open', () => {
    const issue = normalizeTrelloCard(makeTrelloCard())
    expect(issue.status).to.equal('Open')
  })

  it('uses Closed status when card is closed', () => {
    const issue = normalizeTrelloCard(makeTrelloCard({ closed: true }))
    expect(issue.status).to.equal('Closed')
  })

  it('falls back to trello-<id> when shortLink is missing', () => {
    const issue = normalizeTrelloCard(makeTrelloCard({ shortLink: undefined }))
    expect(issue.external_key).to.equal('trello-abc123def456')
  })

  it('normalizes card to envelope with category', () => {
    const envelope = normalizeTrelloCardToEnvelope(makeTrelloCard())
    expect(envelope.source.name).to.equal('trello')
    expect(envelope.source.externalKey).to.equal('trello-xYz789')
    expect(envelope.category).to.equal('feature')
  })

  it('derives bug category from labels', () => {
    const envelope = normalizeTrelloCardToEnvelope(
      makeTrelloCard({ labels: [{ name: 'Bug' }] })
    )
    expect(envelope.category).to.equal('bug')
  })

  it('derives chore category from labels', () => {
    const envelope = normalizeTrelloCardToEnvelope(
      makeTrelloCard({ labels: [{ name: 'chore' }] })
    )
    expect(envelope.category).to.equal('chore')
  })

  it('builds PMO metadata and context from normalized envelope', () => {
    const envelope = normalizeTrelloCardToEnvelope(makeTrelloCard())
    const description = buildTrelloTicketDescription(envelope)
    const metadata = buildTrelloMetadata(envelope)
    const context = buildTrelloSpawnContextMessage(envelope, 'Focus on accessibility')

    expect(description).to.include('## External Issue Context')
    expect(description).to.include('- Source: trello')
    expect(metadata.external_source).to.equal('trello')
    expect(metadata.external_key).to.equal('trello-xYz789')
    expect(context).to.include('External issue key: trello-xYz789')
    expect(context).to.include('Focus on accessibility')
  })

  it('throws BAD_PAYLOAD for malformed payloads', () => {
    expect(() => normalizeTrelloCard({ id: 'abc' })).to.throw(ExternalIssueAdapterError)
  })

  it('throws BAD_PAYLOAD for null input', () => {
    expect(() => normalizeTrelloCard(null)).to.throw(ExternalIssueAdapterError)
  })

  it('throws MISSING_CONFIG when api key is missing', async () => {
    try {
      await listTrelloCards({})
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
    }
  })

  it('throws MISSING_CONFIG when api token is missing', async () => {
    try {
      await listTrelloCards({ apiKey: 'key' })
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

  it('throws RATE_LIMITED for 429 responses when fetching card', async () => {
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
    const issue = await getTrelloCardById(
      { apiKey: 'key', apiToken: 'tok' },
      'nonexistent',
      { fetchImpl },
    )
    expect(issue).to.equal(null)
  })

  it('fetches and normalizes card by ID', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      // Board lists endpoint
      if (urlStr.includes('/boards/') && urlStr.includes('/lists')) {
        return new Response(JSON.stringify([
          { id: 'list456', name: 'In Progress' },
        ]), { status: 200 })
      }
      // Card endpoint
      return new Response(JSON.stringify(makeTrelloCard()), { status: 200 })
    }

    const issue = await getTrelloCardById(
      { apiKey: 'key', apiToken: 'tok' },
      'abc123def456',
      { fetchImpl },
    )

    expect(issue).to.not.equal(null)
    expect(issue?.source.name).to.equal('trello')
    expect(issue?.source.externalKey).to.equal('trello-xYz789')
    expect(issue?.status).to.equal('In Progress')
    expect(issue?.category).to.equal('feature')
  })

  it('lists cards from board', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/lists')) {
        return new Response(JSON.stringify([
          { id: 'list456', name: 'To Do' },
        ]), { status: 200 })
      }
      if (urlStr.includes('/cards')) {
        return new Response(JSON.stringify([
          makeTrelloCard(),
          makeTrelloCard({ id: 'def456', shortLink: 'aBc000', name: 'Second card', idList: 'list456' }),
        ]), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }

    const issues = await listTrelloCards(
      { apiKey: 'key', apiToken: 'tok', boardId: 'board123' },
      { limit: 10, fetchImpl },
    )

    expect(issues).to.have.length(2)
    expect(issues[0].source.externalKey).to.equal('trello-xYz789')
    expect(issues[1].source.externalKey).to.equal('trello-aBc000')
  })

  it('lists cards via search query', async () => {
    const fetchImpl = async () => {
      return new Response(JSON.stringify({
        cards: [makeTrelloCard()],
      }), { status: 200 })
    }

    const issues = await listTrelloCards(
      { apiKey: 'key', apiToken: 'tok' },
      { query: 'dark mode', fetchImpl },
    )

    expect(issues).to.have.length(1)
    expect(issues[0].title).to.equal('Implement dark mode')
  })

  it('throws AUTH_FAILED for 401 when listing cards via search', async () => {
    const fetchImpl = async () => new Response('{}', { status: 401 })
    try {
      await listTrelloCards(
        { apiKey: 'key', apiToken: 'bad-token' },
        { query: 'test', fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('throws MISSING_CONFIG when no boardId and no query', async () => {
    try {
      await listTrelloCards({ apiKey: 'key', apiToken: 'tok' })
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
    }
  })

  it('builds card choice command', () => {
    expect(buildTrelloCardChoiceCommand('trello-abc', 'PROJ-001')).to.equal(
      'prlt work trello --issue trello-abc --json -P PROJ-001',
    )
    expect(buildTrelloCardChoiceCommand('trello-abc')).to.equal(
      'prlt work trello --issue trello-abc --json',
    )
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
          expect(input.title).to.equal('Implement dark mode')
          expect((input.metadata as Record<string, string>).external_source).to.equal('trello')
          expect((input.metadata as Record<string, string>).external_key).to.equal('trello-xYz789')
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
        metadata: { external_source: 'trello', external_key: 'trello-xYz789', external_id: 'abc123def456' },
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
        metadata: { external_source: 'linear', external_key: 'trello-xYz789' },
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
