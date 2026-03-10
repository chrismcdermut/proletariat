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
    id: 'card123abc',
    name: 'Fix login button',
    desc: 'The login button is broken on mobile.',
    shortLink: 'abc123',
    url: 'https://trello.com/c/abc123',
    idBoard: 'board456',
    idList: 'list789',
    idMembers: ['member1'],
    labels: [
      { id: 'label1', name: 'bug', color: 'red' },
      { id: 'label2', name: 'P1', color: 'orange' },
    ],
    closed: false,
    ...overrides,
  }
}

function makeListNames(): Map<string, string> {
  const map = new Map<string, string>()
  map.set('list789', 'In Progress')
  map.set('list000', 'Done')
  return map
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
    const issue = normalizeTrelloCard(makeTrelloCard(), makeListNames())
    expect(issue.source).to.equal('trello')
    expect(issue.external_id).to.equal('card123abc')
    expect(issue.external_key).to.equal('abc123')
    expect(issue.title).to.equal('Fix login button')
    expect(issue.description).to.equal('The login button is broken on mobile.')
    expect(issue.labels).to.include('bug')
    expect(issue.labels).to.include('P1')
    expect(issue.priority).to.equal('P1')
    expect(issue.status).to.equal('In Progress')
    expect(issue.item_type).to.equal('card')
    expect(issue.project_key).to.equal('board456')
    expect(issue.url).to.equal('https://trello.com/c/abc123')
  })

  it('normalizes card to envelope with category', () => {
    const envelope = normalizeTrelloCardToEnvelope(makeTrelloCard(), makeListNames())
    expect(envelope.source.name).to.equal('trello')
    expect(envelope.source.externalKey).to.equal('abc123')
    expect(envelope.category).to.equal('bug')
  })

  it('derives feature category when no bug/chore labels', () => {
    const card = makeTrelloCard({
      labels: [{ id: 'l1', name: 'frontend', color: 'blue' }],
    })
    const envelope = normalizeTrelloCardToEnvelope(card, makeListNames())
    expect(envelope.category).to.equal('feature')
  })

  it('derives chore category from labels', () => {
    const card = makeTrelloCard({
      labels: [{ id: 'l1', name: 'chore', color: 'green' }],
    })
    const envelope = normalizeTrelloCardToEnvelope(card, makeListNames())
    expect(envelope.category).to.equal('chore')
  })

  it('handles card with no labels', () => {
    const card = makeTrelloCard({ labels: [] })
    const issue = normalizeTrelloCard(card, makeListNames())
    expect(issue.labels).to.deep.equal([])
    expect(issue.priority).to.equal(null)
  })

  it('uses card id as key when shortLink is missing', () => {
    const card = makeTrelloCard({ shortLink: undefined })
    const issue = normalizeTrelloCard(card, makeListNames())
    expect(issue.external_key).to.equal('card123abc')
  })

  it('uses Unknown status when list is not in map', () => {
    const card = makeTrelloCard({ idList: 'unknown-list' })
    const issue = normalizeTrelloCard(card, makeListNames())
    expect(issue.status).to.equal('Unknown')
  })

  it('builds PMO metadata and context from normalized envelope', () => {
    const envelope = normalizeTrelloCardToEnvelope(makeTrelloCard(), makeListNames())
    const description = buildTrelloTicketDescription(envelope)
    const metadata = buildTrelloMetadata(envelope)
    const context = buildTrelloSpawnContextMessage(envelope, 'Focus on mobile')

    expect(description).to.include('## External Issue Context')
    expect(description).to.include('- Source: trello')
    expect(metadata.external_source).to.equal('trello')
    expect(metadata.external_key).to.equal('abc123')
    expect(context).to.include('External issue key: abc123')
    expect(context).to.include('Focus on mobile')
  })

  it('builds spawn context without additional message', () => {
    const envelope = normalizeTrelloCardToEnvelope(makeTrelloCard(), makeListNames())
    const context = buildTrelloSpawnContextMessage(envelope)
    expect(context).to.include('External issue source: trello')
    expect(context).not.to.include('Focus')
  })

  it('throws BAD_PAYLOAD for malformed payloads', () => {
    expect(() => normalizeTrelloCard({ id: 'x' })).to.throw(ExternalIssueAdapterError)
  })

  it('throws BAD_PAYLOAD for null input', () => {
    expect(() => normalizeTrelloCard(null)).to.throw(ExternalIssueAdapterError)
  })

  it('throws MISSING_CONFIG when key is missing', async () => {
    try {
      await listTrelloCards({})
      expect.fail('expected to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ExternalIssueAdapterError)
      expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
    }
  })

  it('throws MISSING_CONFIG when token is missing', async () => {
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
      'nonexistent',
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
    const card = makeTrelloCard()
    const fetchImpl = async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      // Board lists endpoint
      if (urlStr.includes('/boards/') && urlStr.includes('/lists')) {
        return new Response(JSON.stringify([
          { id: 'list789', name: 'In Progress' },
        ]), { status: 200 })
      }
      // Card endpoint
      return new Response(JSON.stringify(card), { status: 200 })
    }

    const issue = await getTrelloCardByKey(
      { apiKey: 'key', apiToken: 'tok' },
      'abc123',
      { fetchImpl },
    )

    expect(issue).to.not.equal(null)
    expect(issue?.source.name).to.equal('trello')
    expect(issue?.source.externalKey).to.equal('abc123')
    expect(issue?.status).to.equal('In Progress')
    expect(issue?.category).to.equal('bug')
  })

  it('builds card choice command', () => {
    expect(buildTrelloCardChoiceCommand('abc123', 'PROJ-001')).to.equal(
      'prlt work trello --issue abc123 --json -P PROJ-001',
    )
    expect(buildTrelloCardChoiceCommand('abc123')).to.equal(
      'prlt work trello --issue abc123 --json',
    )
  })

  it('lists cards from board', async () => {
    const cards = [makeTrelloCard(), makeTrelloCard({ id: 'card2', name: 'Second card', shortLink: 'def456' })]
    const fetchImpl = async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/lists')) {
        return new Response(JSON.stringify([
          { id: 'list789', name: 'In Progress' },
        ]), { status: 200 })
      }
      if (urlStr.includes('/cards')) {
        return new Response(JSON.stringify(cards), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }

    const result = await listTrelloCards(
      { apiKey: 'key', apiToken: 'tok', boardId: 'board456' },
      { fetchImpl },
    )

    expect(result).to.have.length(2)
    expect(result[0].source.name).to.equal('trello')
    expect(result[0].source.externalKey).to.equal('abc123')
    expect(result[1].source.externalKey).to.equal('def456')
  })

  describe('importTrelloCardToPmo', () => {
    function makeEnvelope() {
      return normalizeTrelloCardToEnvelope(makeTrelloCard(), makeListNames())
    }

    it('creates a new PMO ticket when none exists', async () => {
      const createdTicket = { id: 'TKT-001' }
      const storage = {
        listTickets: async () => [],
        createTicket: async (_projectId: string, input: Record<string, unknown>) => {
          expect(input.title).to.equal('Fix login button')
          expect((input.metadata as Record<string, string>).external_source).to.equal('trello')
          expect((input.metadata as Record<string, string>).external_key).to.equal('abc123')
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
        metadata: { external_source: 'trello', external_key: 'abc123', external_id: 'card123abc' },
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
        metadata: { external_source: 'linear', external_key: 'abc123' },
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
