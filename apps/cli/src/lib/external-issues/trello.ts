import {
  ExternalIssueAdapterError,
  toNormalizedEnvelope,
  type IssueEnvelope,
  type NormalizedIssueEnvelope,
} from './types.js'

const TRELLO_API_BASE = 'https://api.trello.com/1'

export interface TrelloAdapterConfig {
  apiKey?: string
  apiToken?: string
  boardId?: string
}

interface TrelloCardPayload {
  id?: string
  name?: string
  desc?: string
  url?: string
  shortUrl?: string
  idBoard?: string
  idList?: string
  idMembers?: string[]
  labels?: Array<{ id?: string; name?: string; color?: string }>
  closed?: boolean
  due?: string | null
  dueComplete?: boolean
  members?: Array<{ fullName?: string; username?: string }>
}

interface TrelloListPayload {
  id?: string
  name?: string
}

function ensureTrelloConfig(
  config: TrelloAdapterConfig,
): { apiKey: string; apiToken: string; boardId?: string } {
  const apiKey = config.apiKey || process.env.TRELLO_API_KEY || process.env.PRLT_TRELLO_API_KEY
  const apiToken = config.apiToken || process.env.TRELLO_API_TOKEN || process.env.PRLT_TRELLO_API_TOKEN
  const boardId = config.boardId || process.env.TRELLO_BOARD_ID || process.env.PRLT_TRELLO_BOARD_ID

  if (!apiKey) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Trello API key. Set TRELLO_API_KEY or PRLT_TRELLO_API_KEY.',
    )
  }

  if (!apiToken) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Trello API token. Set TRELLO_API_TOKEN or PRLT_TRELLO_API_TOKEN.',
    )
  }

  return { apiKey, apiToken, boardId: boardId || undefined }
}

function ensureCardShape(card: TrelloCardPayload): asserts card is Required<Pick<TrelloCardPayload, 'id' | 'name' | 'url'>> & TrelloCardPayload {
  if (!card.id || !card.name || !card.url) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'Trello card payload is missing required fields (id, name, url).',
      card,
    )
  }
}

function deriveCategory(labels: string[]): string {
  const lower = labels.map(l => l.toLowerCase())
  if (lower.includes('bug')) return 'bug'
  if (lower.includes('chore')) return 'chore'
  return 'feature'
}

function derivePriority(labels: string[]): string | null {
  const priorityLabel = labels.find(l => /^P[0-3]$/i.test(l))
  return priorityLabel ? priorityLabel.toUpperCase() : null
}

export function normalizeTrelloCard(rawCard: unknown): IssueEnvelope {
  if (!rawCard || typeof rawCard !== 'object') {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', 'Trello card payload is invalid.', rawCard)
  }

  const card = rawCard as TrelloCardPayload
  ensureCardShape(card)

  const labels = (card.labels || [])
    .map(label => label.name?.trim())
    .filter((name): name is string => Boolean(name))

  const members = card.members || []
  const firstMember = members[0]
  const assignee = firstMember?.fullName || firstMember?.username || null

  return {
    source: 'trello',
    external_id: card.id,
    external_key: card.id,
    title: card.name,
    description: card.desc || '',
    labels,
    priority: derivePriority(labels),
    status: card.closed ? 'Closed' : 'Open',
    url: card.url,
    project_key: card.idBoard || 'DEFAULT',
    assignee,
    item_type: 'card',
    raw: rawCard as Record<string, unknown>,
  }
}

export function normalizeTrelloCardToEnvelope(rawCard: unknown): NormalizedIssueEnvelope {
  const envelope = normalizeTrelloCard(rawCard)
  return toNormalizedEnvelope(envelope, deriveCategory(envelope.labels))
}

export function buildTrelloTicketDescription(envelope: NormalizedIssueEnvelope): string {
  const body = envelope.description.trim()
  const metadataLines = [
    `- Source: ${envelope.source.name}`,
    `- External key: ${envelope.source.externalKey}`,
    `- External id: ${envelope.source.externalId}`,
    `- URL: ${envelope.source.url}`,
    `- Status: ${envelope.status}`,
    `- Priority: ${envelope.priority || 'Unset'}`,
    `- Labels: ${envelope.labels.length > 0 ? envelope.labels.join(', ') : 'None'}`,
  ]

  const parts = [
    body,
    '## External Issue Context',
    metadataLines.join('\n'),
  ].filter(Boolean)

  return parts.join('\n\n')
}

export function buildTrelloMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
  return {
    external_source: envelope.source.name,
    external_key: envelope.source.externalKey,
    external_id: envelope.source.externalId,
    external_url: envelope.source.url,
    external_raw: JSON.stringify(envelope.source.raw),
  }
}

export function buildTrelloSpawnContextMessage(
  envelope: NormalizedIssueEnvelope,
  additionalMessage?: string,
): string {
  const lines = [
    `External issue source: ${envelope.source.name}`,
    `External issue key: ${envelope.source.externalKey}`,
    `External issue id: ${envelope.source.externalId}`,
    `External issue URL: ${envelope.source.url}`,
  ]

  if (additionalMessage?.trim()) {
    lines.push('', additionalMessage.trim())
  }

  return lines.join('\n')
}

export function buildTrelloCardChoiceCommand(cardId: string, projectId?: string): string {
  let command = `prlt work trello --card ${cardId} --json`
  if (projectId) {
    command += ` -P ${projectId}`
  }
  return command
}

async function fetchBoardLists(
  config: { apiKey: string; apiToken: string },
  boardId: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<Map<string, TrelloListPayload>> {
  const fetchImpl = options?.fetchImpl || fetch
  const url = new URL(`${TRELLO_API_BASE}/boards/${boardId}/lists`)
  url.searchParams.set('key', config.apiKey)
  url.searchParams.set('token', config.apiToken)
  url.searchParams.set('filter', 'open')

  const response = await fetchImpl(url)

  if (!response.ok) {
    return new Map()
  }

  const lists = await response.json() as TrelloListPayload[]
  const listMap = new Map<string, TrelloListPayload>()
  for (const list of lists) {
    if (list.id) {
      listMap.set(list.id, list)
    }
  }
  return listMap
}

export async function getTrelloCardById(
  configInput: TrelloAdapterConfig,
  cardId: string,
  options?: {
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope | null> {
  const config = ensureTrelloConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch

  const url = new URL(`${TRELLO_API_BASE}/cards/${cardId}`)
  url.searchParams.set('key', config.apiKey)
  url.searchParams.set('token', config.apiToken)
  url.searchParams.set('members', 'true')
  url.searchParams.set('member_fields', 'fullName,username')

  const response = await fetchImpl(url)

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'Trello authentication failed. Verify your API key and token.',
    )
  }

  if (response.status === 429) {
    throw new ExternalIssueAdapterError(
      'RATE_LIMITED',
      'Trello API rate limit exceeded. Wait a moment and try again.',
    )
  }

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new ExternalIssueAdapterError(
      'REQUEST_FAILED',
      `Trello request failed with status ${response.status}.`,
    )
  }

  const payload = await response.json()

  // Enrich with list name for status
  const card = payload as TrelloCardPayload
  if (card.idBoard && card.idList) {
    const lists = await fetchBoardLists(config, card.idBoard, { fetchImpl })
    const list = lists.get(card.idList)
    if (list?.name) {
      const envelope = normalizeTrelloCard(payload)
      envelope.status = card.closed ? 'Closed' : list.name
      return toNormalizedEnvelope(envelope, deriveCategory(envelope.labels))
    }
  }

  return normalizeTrelloCardToEnvelope(payload)
}

export function isTrelloConfiguredFromEnv(config?: TrelloAdapterConfig): boolean {
  const apiKey = config?.apiKey
    || process.env.PRLT_TRELLO_API_KEY
    || process.env.TRELLO_API_KEY

  const apiToken = config?.apiToken
    || process.env.PRLT_TRELLO_API_TOKEN
    || process.env.TRELLO_API_TOKEN

  return Boolean(apiKey && apiToken)
}

export async function listTrelloCards(
  configInput: TrelloAdapterConfig,
  options?: {
    limit?: number
    query?: string
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope[]> {
  const config = ensureTrelloConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100))

  let cards: TrelloCardPayload[]
  let boardLists = new Map<string, TrelloListPayload>()

  if (options?.query) {
    // Use search endpoint
    const url = new URL(`${TRELLO_API_BASE}/search`)
    url.searchParams.set('key', config.apiKey)
    url.searchParams.set('token', config.apiToken)
    url.searchParams.set('query', options.query)
    url.searchParams.set('cards_limit', String(limit))
    url.searchParams.set('modelTypes', 'cards')

    if (config.boardId) {
      url.searchParams.set('idBoards', config.boardId)
    }

    const response = await fetchImpl(url)
    handleTrelloErrors(response)

    const payload = await response.json() as { cards?: TrelloCardPayload[] }
    cards = payload.cards ?? []
  } else if (config.boardId) {
    // List cards from default board
    const url = new URL(`${TRELLO_API_BASE}/boards/${config.boardId}/cards`)
    url.searchParams.set('key', config.apiKey)
    url.searchParams.set('token', config.apiToken)
    url.searchParams.set('filter', 'open')
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('members', 'true')
    url.searchParams.set('member_fields', 'fullName,username')

    const response = await fetchImpl(url)
    handleTrelloErrors(response)

    cards = await response.json() as TrelloCardPayload[]

    // Fetch lists for board to resolve status names
    boardLists = await fetchBoardLists(config, config.boardId, { fetchImpl })
  } else {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Trello board ID is required. Set TRELLO_BOARD_ID, PRLT_TRELLO_BOARD_ID, or run "prlt trello configure".',
    )
  }

  if (!Array.isArray(cards)) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'Trello response payload was missing cards array.',
      cards,
    )
  }

  return cards
    .slice(0, limit)
    .map(card => {
      const envelope = normalizeTrelloCard(card)
      // Enrich with list name if available
      if (card.idList && boardLists.has(card.idList)) {
        const list = boardLists.get(card.idList)
        if (list?.name && !card.closed) {
          envelope.status = list.name
        }
      }
      return toNormalizedEnvelope(envelope, deriveCategory(envelope.labels))
    })
}

function handleTrelloErrors(response: Response): void {
  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'Trello authentication failed. Verify your API key and token.',
    )
  }

  if (response.status === 429) {
    throw new ExternalIssueAdapterError(
      'RATE_LIMITED',
      'Trello API rate limit exceeded. Wait a moment and try again.',
    )
  }

  if (!response.ok) {
    throw new ExternalIssueAdapterError(
      'REQUEST_FAILED',
      `Trello request failed with status ${response.status}.`,
    )
  }
}

export async function importTrelloCardToPmo(
  storage: {
    listTickets(projectId: string): Promise<Array<{ id: string; metadata?: Record<string, string> }>>,
    createTicket(projectId: string, input: {
      title: string
      description: string
      priority?: string
      category?: string
      labels: string[]
      metadata: Record<string, string>
    }): Promise<{ id: string }>,
    updateTicket(ticketId: string, input: {
      title: string
      description: string
      priority?: string
      category?: string
      labels: string[]
      metadata: Record<string, string>
    }): Promise<{ id: string }>,
  },
  projectId: string,
  envelope: NormalizedIssueEnvelope,
): Promise<{ ticketId: string; created: boolean }> {
  const tickets = await storage.listTickets(projectId)
  const existing = tickets.find((ticket) => {
    const source = ticket.metadata?.external_source
    const key = ticket.metadata?.external_key
    const id = ticket.metadata?.external_id
    return source === 'trello'
      && (key === envelope.source.externalKey || id === envelope.source.externalId)
  })

  const description = buildTrelloTicketDescription(envelope)
  const metadata = buildTrelloMetadata(envelope)

  if (existing) {
    await storage.updateTicket(existing.id, {
      title: envelope.title,
      description,
      priority: envelope.priority ?? undefined,
      category: envelope.category ?? undefined,
      labels: envelope.labels,
      metadata: {
        ...existing.metadata,
        ...metadata,
      },
    })
    return { ticketId: existing.id, created: false }
  }

  const ticket = await storage.createTicket(projectId, {
    title: envelope.title,
    description,
    priority: envelope.priority ?? undefined,
    category: envelope.category ?? undefined,
    labels: envelope.labels,
    metadata,
  })
  return { ticketId: ticket.id, created: true }
}
