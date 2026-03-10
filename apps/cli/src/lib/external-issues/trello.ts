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

interface TrelloLabel {
  id?: string
  name?: string
  color?: string
}

interface TrelloCard {
  id?: string
  name?: string
  desc?: string
  shortLink?: string
  url?: string
  idBoard?: string
  idList?: string
  idMembers?: string[]
  labels?: TrelloLabel[]
  closed?: boolean
}

interface TrelloSearchResponse {
  cards?: TrelloCard[]
}

interface TrelloList {
  id?: string
  name?: string
}

interface TrelloBoard {
  id?: string
  name?: string
}

function ensureTrelloConfig(
  config: TrelloAdapterConfig,
): { apiKey: string; apiToken: string; boardId?: string } {
  const apiKey = config.apiKey || process.env.PRLT_TRELLO_API_KEY || process.env.TRELLO_API_KEY
  const apiToken = config.apiToken || process.env.PRLT_TRELLO_API_TOKEN || process.env.TRELLO_API_TOKEN
  const boardId = config.boardId || process.env.PRLT_TRELLO_BOARD_ID || process.env.TRELLO_BOARD_ID

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

function ensureCardShape(card: TrelloCard): asserts card is Required<Pick<TrelloCard, 'id' | 'name'>> & TrelloCard {
  if (!card.id || !card.name) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'Trello card payload is missing required fields (id, name).',
      card,
    )
  }
}

function derivePriorityFromLabels(labels: string[]): string | null {
  const priorityLabel = labels.find(l => /^P[0-3]$/i.test(l))
  return priorityLabel ? priorityLabel.toUpperCase() : null
}

function deriveCategory(labels: string[]): string {
  const lower = labels.map(l => l.toLowerCase())
  if (lower.includes('bug')) return 'bug'
  if (lower.includes('chore')) return 'chore'
  return 'feature'
}

function buildAuthParams(apiKey: string, apiToken: string): string {
  return `key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(apiToken)}`
}

/**
 * Normalize a raw Trello API card into a canonical IssueEnvelope.
 */
export function normalizeTrelloCard(
  rawCard: unknown,
  listNames?: Map<string, string>,
): IssueEnvelope {
  if (!rawCard || typeof rawCard !== 'object') {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', 'Trello card payload is invalid.', rawCard)
  }

  const card = rawCard as TrelloCard
  ensureCardShape(card)

  const labels = (card.labels || [])
    .map(label => label.name?.trim())
    .filter((name): name is string => Boolean(name))

  const listName = listNames?.get(card.idList ?? '') || 'Unknown'
  const externalKey = card.shortLink || card.id

  return {
    source: 'trello',
    external_id: card.id,
    external_key: externalKey,
    title: card.name,
    description: card.desc || '',
    labels,
    priority: derivePriorityFromLabels(labels),
    status: listName,
    url: card.url || `https://trello.com/c/${externalKey}`,
    project_key: card.idBoard || 'DEFAULT',
    assignee: null,
    item_type: 'card',
    raw: rawCard as Record<string, unknown>,
  }
}

/**
 * Normalize a raw Trello card into a PMO-ready NormalizedIssueEnvelope.
 */
export function normalizeTrelloCardToEnvelope(
  rawCard: unknown,
  listNames?: Map<string, string>,
): NormalizedIssueEnvelope {
  const envelope = normalizeTrelloCard(rawCard, listNames)
  return toNormalizedEnvelope(envelope, deriveCategory(envelope.labels))
}

/**
 * Build a PMO ticket description from a NormalizedIssueEnvelope.
 */
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

/**
 * Build ticket metadata from a NormalizedIssueEnvelope for traceability.
 */
export function buildTrelloMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
  return {
    external_source: envelope.source.name,
    external_key: envelope.source.externalKey,
    external_id: envelope.source.externalId,
    external_url: envelope.source.url,
    external_raw: JSON.stringify(envelope.source.raw),
  }
}

/**
 * Build a spawn context message from a NormalizedIssueEnvelope.
 */
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

/**
 * Build a CLI command string for selecting a specific Trello card.
 */
export function buildTrelloCardChoiceCommand(cardKey: string, projectId?: string): string {
  let command = `prlt work trello --issue ${cardKey} --json`
  if (projectId) {
    command += ` -P ${projectId}`
  }
  return command
}

/**
 * Fetch list names for a Trello board.
 * Returns a Map of list_id -> list name.
 */
async function fetchBoardLists(
  config: { apiKey: string; apiToken: string },
  boardId: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<Map<string, string>> {
  const fetchImpl = options?.fetchImpl || fetch
  const authParams = buildAuthParams(config.apiKey, config.apiToken)
  const response = await fetchImpl(`${TRELLO_API_BASE}/boards/${boardId}/lists?${authParams}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  })

  if (!response.ok) {
    return new Map()
  }

  const lists = await response.json() as TrelloList[]
  const listMap = new Map<string, string>()
  for (const list of lists) {
    if (list.id && list.name) {
      listMap.set(list.id, list.name)
    }
  }
  return listMap
}

/**
 * Fetch a single Trello card by its ID or shortLink and normalize it.
 */
export async function getTrelloCardByKey(
  configInput: TrelloAdapterConfig,
  cardKey: string,
  options?: {
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope | null> {
  const config = ensureTrelloConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch
  const authParams = buildAuthParams(config.apiKey, config.apiToken)

  const response = await fetchImpl(`${TRELLO_API_BASE}/cards/${cardKey}?${authParams}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  })

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'Trello authentication failed. Verify your TRELLO_API_KEY and TRELLO_API_TOKEN.',
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

  const card = await response.json() as TrelloCard

  // Fetch list names from the card's board
  let listNames: Map<string, string> | undefined
  if (card.idBoard) {
    listNames = await fetchBoardLists(config, card.idBoard, { fetchImpl })
  }

  return normalizeTrelloCardToEnvelope(card, listNames)
}

/**
 * Fetch and normalize Trello cards into NormalizedIssueEnvelopes.
 * If boardId is configured, fetches cards from that board.
 * Otherwise uses the Trello search API.
 */
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
  const authParams = buildAuthParams(config.apiKey, config.apiToken)

  let cards: TrelloCard[]
  let listNames = new Map<string, string>()

  if (config.boardId) {
    // Fetch open cards from the configured board
    listNames = await fetchBoardLists(config, config.boardId, { fetchImpl })

    const response = await fetchImpl(
      `${TRELLO_API_BASE}/boards/${config.boardId}/cards?${authParams}&filter=open&limit=${limit}`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      },
    )

    if (response.status === 401 || response.status === 403) {
      throw new ExternalIssueAdapterError(
        'AUTH_FAILED',
        'Trello authentication failed. Verify your TRELLO_API_KEY and TRELLO_API_TOKEN.',
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

    cards = await response.json() as TrelloCard[]
  } else {
    // Use search API
    const searchQuery = options?.query || 'is:open'
    const response = await fetchImpl(
      `${TRELLO_API_BASE}/search?${authParams}&query=${encodeURIComponent(searchQuery)}&modelTypes=cards&cards_limit=${limit}`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      },
    )

    if (response.status === 401 || response.status === 403) {
      throw new ExternalIssueAdapterError(
        'AUTH_FAILED',
        'Trello authentication failed. Verify your TRELLO_API_KEY and TRELLO_API_TOKEN.',
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

    const payload = await response.json() as TrelloSearchResponse
    cards = payload.cards || []

    // Collect unique board IDs to fetch list names
    const boardIds = new Set<string>()
    for (const card of cards) {
      if (card.idBoard) boardIds.add(card.idBoard)
    }
    for (const boardId of boardIds) {
      const boardLists = await fetchBoardLists(config, boardId, { fetchImpl })
      for (const [id, name] of boardLists) {
        listNames.set(id, name)
      }
    }
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
    .map(card => normalizeTrelloCardToEnvelope(card, listNames))
}

/**
 * Import a Trello card into PMO as a linked ticket.
 */
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
