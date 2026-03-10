import { expect } from 'chai'
import {
  normalizeTrelloCard,
  normalizeTrelloCardToEnvelope,
  listTrelloCards,
  getTrelloCardByKey,
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
    idShort: 42,
    name: 'Implement dark mode',
    desc: 'Add dark mode toggle to settings.',
    url: 'https://trello.com/c/abc123/42-implement-dark-mode',
    shortUrl: 'https://trello.com/c/abc123',
    idBoard: 'board-xyz',
    idList: 'list-todo',
    idMembers: ['member-1'],
    labels: [
      { id: 'label-1', name: 'frontend', color: 'green' },
      { id: 'label-2', name: 'P1', color: 'red' },
    ],
    closed: false,
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
    savedEnv.TRELLO_BOARD_ID = process.env.TRELLO_BOARD_ID
  })

  beforeEach(() => {
    delete process.env.PRLT_TRELLO_API_KEY
    delete process.env.TRELLO_API_KEY
    delete process.env.PRLT_TRELLO_API_TOKEN
    delete process.env.TRELLO_API_TOKEN
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
    const issue = normalizeTrelloCard(makeTrelloCard(), 'To Do')
    expect(issue.source).to.equal('trello')
    expect(issue.external_id).to.equal('abc123def456')
    expect(issue.external_key).to.equal('trello-42')
    expect(issue.title).to.equal('Implement dark mode')
    expect(issue.labels).to.include('frontend')
    expect(issue.labels).to.include('P1')
    expect(issue.priority).to.equal('P1')
    expect(issue.status).to.equal('To Do')
    expect(issue.item_type).to.equal('card')
    expect(issue.project_key).to.equal('board-xyz')
    expect(issue.url).to.equal('https://trello.com/c/abc123/42-implement-dark-mode')
  })

  it('normalizes card to envelope with category', () => {
    const envelope = normalizeTrelloCardToEnvelope(makeTrelloCard(), 'To Do')
    expect(envelope.source.name).to.equal('trello')
    expect(envelope.source.externalKey).to.equal('trello-42')
    expect(envelope.category).to.equal('feature')
  })

  it('derives bug category from labels', () => {
    const envelope = normalizeTrelloCardToEnvelope(
      makeTrelloCard({ labels: [{ name: 'bug' }] }),
      'To Do',
    )
    expect(envelope.category).to.equal('bug')
  })

  it('derives chore category from labels', () => {
    const envelope = normalizeTrelloCardToEnvelope(
      makeTrelloCard({ labels: [{ name: 'chore' }] }),
      'To Do',
    )
    expect(envelope.category).to.equal('chore')
  })

  it('uses idShort for external key when available', () => {
    const issue = normalizeTrelloCard(makeTrelloCard({ idShort: 99 }))
    expect(issue.external_key).to.equal('trello-99')
  })

  it('falls back to id for external key when idShort is absent', () => {
    const card = makeTrelloCard()
    delete (card as Record<string, unknown>).idShort
    const issue = normalizeTrelloCard(card)
    expect(issue.external_key).to.equal('trello-abc123def456')
  })

  it('builds PMO metadata and context from normalized envelope', () => {
    const envelope = normalizeTrelloCardToEnvelope(makeTrelloCard(), 'To Do')
    const description = buildTrelloTicketDescription(envelope)
    const metadata = buildTrelloMetadata(envelope)
    const context = buildTrelloSpawnContextMessage(envelope, 'Focus on accessibility')

    expect(description).to.include('## External Issue Context')
    expect(description).to.include('- Source: trello')
    expect(metadata.external_source).to.equal('trello')
    expect(metadata.external_key).to.equal('trello-42')
    expect(context).to.include('External issue key: trello-42')
    expect(context).to.include('Focus on accessibility')
  })

  it('throws BAD_PAYLOAD for malformed payloads', () => {
    expect(() => normalizeTrelloCard({ id: 'x' })).to.throw(ExternalIssueAdapterError)
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

  it('throws AUTH_FAILED for 401 responses when listing cards', async () => {
    const fetchImpl = async () => new Response('{}', { status: 401 })
    try {
      await listTrelloCards(
        { apiKey: 'key', apiToken: 'bad-token' },
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('throws RATE_LIMITED for 429 responses when listing cards', async () => {
    const fetchImpl = async () => new Response('{}', { status: 429 })
    try {
      await listTrelloCards(
        { apiKey: 'key', apiToken: 'tok' },
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('RATE_LIMITED')
    }
  })

  it('returns null when card is not found by key', async () => {
    const fetchImpl = async () => new Response('{}', { status: 404 })

    const issue = await getTrelloCardByKey(
      { apiKey: 'key', apiToken: 'tok' },
      'nonexistent-id',
      { fetchImpl },
    )
    expect(issue).to.equal(null)
  })

  it('throws AUTH_FAILED for 401 when fetching card by key', async () => {
    const fetchImpl = async () => new Response('{}', { status: 401 })

    try {
      await getTrelloCardByKey(
        { apiKey: 'key', apiToken: 'bad-token' },
        'abc123',
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
    }
  })

  it('fetches and normalizes card by key', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      // Card fetch
      if (urlStr.includes('/1/cards/')) {
        return new Response(JSON.stringify(makeTrelloCard()), { status: 200 })
      }
      // List fetch for list name
      if (urlStr.includes('/1/lists/')) {
        return new Response(JSON.stringify({ id: 'list-todo', name: 'To Do' }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }

    const issue = await getTrelloCardByKey(
      { apiKey: 'key', apiToken: 'tok' },
      'abc123def456',
      { fetchImpl },
    )

    expect(issue).to.not.equal(null)
    expect(issue?.source.name).to.equal('trello')
    expect(issue?.source.externalKey).to.equal('trello-42')
    expect(issue?.status).to.equal('To Do')
    expect(issue?.category).to.equal('feature')
  })

  it('lists cards from board', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      // Board lists endpoint
      if (urlStr.includes('/1/boards/') && urlStr.includes('/lists')) {
        return new Response(JSON.stringify([
          { id: 'list-todo', name: 'To Do' },
          { id: 'list-doing', name: 'Doing' },
        ]), { status: 200 })
      }
      // Board cards endpoint
      if (urlStr.includes('/1/boards/') && urlStr.includes('/cards')) {
        return new Response(JSON.stringify([
          makeTrelloCard(),
          makeTrelloCard({ id: 'def456', idShort: 43, name: 'Fix bug', idList: 'list-doing', labels: [{ name: 'bug' }] }),
        ]), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }

    const cards = await listTrelloCards(
      { apiKey: 'key', apiToken: 'tok', boardId: 'board-xyz' },
      { fetchImpl },
    )

    expect(cards).to.have.length(2)
    expect(cards[0].source.name).to.equal('trello')
    expect(cards[0].status).to.equal('To Do')
    expect(cards[1].status).to.equal('Doing')
    expect(cards[1].category).to.equal('bug')
  })

  it('lists cards via search when no board ID', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/1/search')) {
        return new Response(JSON.stringify({
          cards: [makeTrelloCard()],
        }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }

    const cards = await listTrelloCards(
      { apiKey: 'key', apiToken: 'tok' },
      { fetchImpl },
    )

    expect(cards).to.have.length(1)
    expect(cards[0].source.name).to.equal('trello')
  })

  it('builds card choice command', () => {
    expect(buildTrelloCardChoiceCommand('abc123', 'PROJ-001')).to.equal(
      'prlt work trello --issue abc123 --json -P PROJ-001',
    )
    expect(buildTrelloCardChoiceCommand('abc123')).to.equal(
      'prlt work trello --issue abc123 --json',
    )
  })

  describe('importTrelloCardToPmo', () => {
    function makeEnvelope() {
      return normalizeTrelloCardToEnvelope(makeTrelloCard(), 'To Do')
    }

    it('creates a new PMO ticket when none exists', async () => {
      const createdTicket = { id: 'TKT-001' }
      const storage = {
        listTickets: async () => [],
        createTicket: async (_projectId: string, input: Record<string, unknown>) => {
          expect(input.title).to.equal('Implement dark mode')
          expect((input.metadata as Record<string, string>).external_source).to.equal('trello')
          expect((input.metadata as Record<string, string>).external_key).to.equal('trello-42')
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
        metadata: { external_source: 'trello', external_key: 'trello-42', external_id: 'abc123def456' },
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
        metadata: { external_source: 'linear', external_key: 'trello-42' },
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
