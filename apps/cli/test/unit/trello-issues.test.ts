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
    name: 'Fix login button',
    desc: 'The login button is broken on mobile.',
    url: 'https://trello.com/c/abc123/1-fix-login-button',
    shortUrl: 'https://trello.com/c/abc123',
    idBoard: 'board-001',
    idList: 'list-todo',
    idMembers: ['member-1'],
    labels: [
      { id: 'lbl-1', name: 'bug', color: 'red' },
      { id: 'lbl-2', name: 'P1', color: 'yellow' },
    ],
    closed: false,
    due: null,
    dueComplete: false,
    members: [
      { fullName: 'Jane Doe', username: 'janedoe' },
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
    const issue = normalizeTrelloCard(makeTrelloCard())
    expect(issue.source).to.equal('trello')
    expect(issue.external_id).to.equal('abc123def456')
    expect(issue.external_key).to.equal('abc123def456')
    expect(issue.title).to.equal('Fix login button')
    expect(issue.description).to.equal('The login button is broken on mobile.')
    expect(issue.labels).to.include('bug')
    expect(issue.labels).to.include('P1')
    expect(issue.priority).to.equal('P1')
    expect(issue.status).to.equal('Open')
    expect(issue.item_type).to.equal('card')
    expect(issue.project_key).to.equal('board-001')
    expect(issue.assignee).to.equal('Jane Doe')
  })

  it('normalizes card to envelope with category', () => {
    const envelope = normalizeTrelloCardToEnvelope(makeTrelloCard())
    expect(envelope.source.name).to.equal('trello')
    expect(envelope.source.externalKey).to.equal('abc123def456')
    expect(envelope.category).to.equal('bug')
  })

  it('derives feature category when no bug/chore labels', () => {
    const envelope = normalizeTrelloCardToEnvelope(makeTrelloCard({
      labels: [{ id: 'lbl-1', name: 'frontend', color: 'blue' }],
    }))
    expect(envelope.category).to.equal('feature')
  })

  it('derives chore category from chore label', () => {
    const envelope = normalizeTrelloCardToEnvelope(makeTrelloCard({
      labels: [{ id: 'lbl-1', name: 'chore', color: 'green' }],
    }))
    expect(envelope.category).to.equal('chore')
  })

  it('sets status to Closed for closed cards', () => {
    const issue = normalizeTrelloCard(makeTrelloCard({ closed: true }))
    expect(issue.status).to.equal('Closed')
  })

  it('handles cards without members', () => {
    const issue = normalizeTrelloCard(makeTrelloCard({ members: [] }))
    expect(issue.assignee).to.equal(null)
  })

  it('handles cards without labels', () => {
    const issue = normalizeTrelloCard(makeTrelloCard({ labels: [] }))
    expect(issue.labels).to.deep.equal([])
    expect(issue.priority).to.equal(null)
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

  it('throws MISSING_CONFIG when board ID is missing for listing', async () => {
    try {
      await listTrelloCards({ apiKey: 'key', apiToken: 'tok' })
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
        { apiKey: 'key', apiToken: 'bad-token', boardId: 'board-1' },
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
        { apiKey: 'key', apiToken: 'tok', boardId: 'board-1' },
        { fetchImpl },
      )
      expect.fail('expected to throw')
    } catch (error) {
      expect((error as ExternalIssueAdapterError).code).to.equal('RATE_LIMITED')
    }
  })

  it('returns null when card is not found by ID', async () => {
    const fetchImpl = async () => new Response('{}', { status: 404 })

    const issue = await getTrelloCardById(
      { apiKey: 'key', apiToken: 'tok' },
      'nonexistent-id',
      { fetchImpl },
    )
    expect(issue).to.equal(null)
  })

  it('throws AUTH_FAILED for 401 when fetching card by ID', async () => {
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

  it('fetches and normalizes card by ID', async () => {
    let callCount = 0
    const fetchImpl = async (url: string | URL | Request) => {
      callCount++
      const urlStr = typeof url === 'string' ? url : url.toString()
      // Board lists endpoint
      if (urlStr.includes('/boards/') && urlStr.includes('/lists')) {
        return new Response(JSON.stringify([
          { id: 'list-todo', name: 'To Do' },
          { id: 'list-doing', name: 'In Progress' },
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
    expect(issue?.source.externalKey).to.equal('abc123def456')
    expect(issue?.status).to.equal('To Do')
    expect(issue?.category).to.equal('bug')
  })

  it('lists cards from board', async () => {
    let callCount = 0
    const fetchImpl = async (url: string | URL | Request) => {
      callCount++
      const urlStr = typeof url === 'string' ? url : url.toString()
      // Board lists endpoint
      if (urlStr.includes('/lists')) {
        return new Response(JSON.stringify([
          { id: 'list-todo', name: 'To Do' },
        ]), { status: 200 })
      }
      // Cards endpoint
      return new Response(JSON.stringify([
        makeTrelloCard(),
        makeTrelloCard({ id: 'card-2', name: 'Add dark mode' }),
      ]), { status: 200 })
    }

    const issues = await listTrelloCards(
      { apiKey: 'key', apiToken: 'tok', boardId: 'board-001' },
      { fetchImpl },
    )

    expect(issues).to.have.length(2)
    expect(issues[0].source.name).to.equal('trello')
    expect(issues[0].status).to.equal('To Do')
  })

  it('builds card choice command', () => {
    expect(buildTrelloCardChoiceCommand('abc123', 'PROJ-001')).to.equal(
      'prlt work trello --card abc123 --json -P PROJ-001',
    )
    expect(buildTrelloCardChoiceCommand('abc123')).to.equal(
      'prlt work trello --card abc123 --json',
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
