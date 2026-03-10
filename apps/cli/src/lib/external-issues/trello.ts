import {
  ExternalIssueAdapterError,
  toNormalizedEnvelope,
  type IssueEnvelope,
  type NormalizedIssueEnvelope,
} from './types.js'

const DEFAULT_TRELLO_API_URL = 'https://api.trello.com'

export interface TrelloAdapterConfig {
  apiKey?: string
  apiToken?: string
  boardId?: string
  apiUrl?: string
}

interface TrelloLabel {
  id?: string
  name?: string
  color?: string
}

interface TrelloCard {
  id?: string
  idShort?: number
  name?: string
  desc?: string
  url?: string
  shortUrl?: string
  idBoard?: string
  idList?: string
  idMembers?: string[]
  labels?: TrelloLabel[]
  closed?: boolean
  due?: string | null
}

interface TrelloList {
  id?: string
  name?: string
}

interface TrelloBoard {
  id?: string
  name?: string
  url?: string
}

interface TrelloSearchResponse {
  cards?: TrelloCard[]
}

interface TrelloMember {
  id?: string
  fullName?: string
  username?: string
}

function ensureTrelloConfig(
  config: TrelloAdapterConfig,
): { apiKey: string; apiToken: string; apiUrl: string; boardId?: string } {
  const apiKey = config.apiKey || process.env.TRELLO_API_KEY || process.env.PRLT_TRELLO_API_KEY
  const apiToken = config.apiToken || process.env.TRELLO_API_TOKEN || process.env.PRLT_TRELLO_API_TOKEN
  const boardId = config.boardId || process.env.TRELLO_BOARD_ID || process.env.PRLT_TRELLO_BOARD_ID
  const apiUrl = config.apiUrl || process.env.PRLT_TRELLO_API_URL || DEFAULT_TRELLO_API_URL

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

  return { apiKey, apiToken, apiUrl, boardId: boardId || undefined }
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

function deriveExternalKey(card: TrelloCard): string {
  return `trello-${card.idShort ?? card.id}`
}

function deriveCategory(labels: string[]): string {
  const normalized = labels.map(l => l.toLowerCase())
  if (normalized.some(l => l === 'bug' || l === 'bugfix')) return 'bug'
  if (normalized.some(l => l === 'chore' || l === 'maintenance')) return 'chore'
  return 'feature'
}

function derivePriorityFromLabels(labels: string[]): string | null {
  const priorityLabel = labels.find(l => /^P[0-3]$/i.test(l))
  return priorityLabel ? priorityLabel.toUpperCase() : null
}

function buildAuthParams(apiKey: string, apiToken: string): string {
  return `key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(apiToken)}`
}

/**
 * Normalize a raw Trello API card into a canonical IssueEnvelope.
 */
export function normalizeTrelloCard(
  rawCard: unknown,
  listName?: string,
): IssueEnvelope {
  if (!rawCard || typeof rawCard !== 'object') {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', 'Trello card payload is invalid.', rawCard)
  }

  const card = rawCard as TrelloCard
  ensureCardShape(card)

  const labels = (card.labels || [])
    .map(label => label.name?.trim())
    .filter((name): name is string => Boolean(name))

  const externalKey = deriveExternalKey(card)
  const url = card.url || card.shortUrl || ''

  return {
    source: 'trello',
    external_id: card.id,
    external_key: externalKey,
    title: card.name,
    description: card.desc || '',
    labels,
    priority: derivePriorityFromLabels(labels),
    status: listName || 'Unknown',
    url,
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
  listName?: string,
): NormalizedIssueEnvelope {
  const envelope = normalizeTrelloCard(rawCard, listName)
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
 * Fetch a single list name by ID.
 */
async function fetchListName(
  config: { apiKey: string; apiToken: string; apiUrl: string },
  listId: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<string> {
  const fetchImpl = options?.fetchImpl || fetch
  const response = await fetchImpl(
    `${config.apiUrl}/1/lists/${listId}?${buildAuthParams(config.apiKey, config.apiToken)}&fields=name`,
    { method: 'GET' },
  )

  if (!response.ok) {
    return 'Unknown'
  }

  const list = await response.json() as TrelloList
  return list.name || 'Unknown'
}

/**
 * Fetch lists for a board and return a Map of list ID to list name.
 */
async function fetchBoardLists(
  config: { apiKey: string; apiToken: string; apiUrl: string },
  boardId: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<Map<string, string>> {
  const fetchImpl = options?.fetchImpl || fetch
  const response = await fetchImpl(
    `${config.apiUrl}/1/boards/${boardId}/lists?${buildAuthParams(config.apiKey, config.apiToken)}&fields=id,name`,
    { method: 'GET' },
  )

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
 * Fetch a single Trello card by its ID and normalize it.
 */
export async function getTrelloCardByKey(
  configInput: TrelloAdapterConfig,
  cardId: string,
  options?: {
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope | null> {
  const config = ensureTrelloConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch

  const response = await fetchImpl(
    `${config.apiUrl}/1/cards/${cardId}?${buildAuthParams(config.apiKey, config.apiToken)}`,
    { method: 'GET' },
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
  const listName = card.idList
    ? await fetchListName(config, card.idList, { fetchImpl })
    : 'Unknown'

  return normalizeTrelloCardToEnvelope(card, listName)
}

/**
 * Check if Trello is configured via environment variables.
 */
export function isTrelloConfiguredFromEnv(config?: TrelloAdapterConfig): boolean {
  const apiKey = config?.apiKey
    || process.env.PRLT_TRELLO_API_KEY
    || process.env.TRELLO_API_KEY

  const apiToken = config?.apiToken
    || process.env.PRLT_TRELLO_API_TOKEN
    || process.env.TRELLO_API_TOKEN

  return Boolean(apiKey && apiToken)
}

/**
 * Fetch and normalize Trello cards into NormalizedIssueEnvelopes.
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

  if (config.boardId) {
    // Fetch cards from a specific board
    const listMap = await fetchBoardLists(config, config.boardId, { fetchImpl })

    const response = await fetchImpl(
      `${config.apiUrl}/1/boards/${config.boardId}/cards?${buildAuthParams(config.apiKey, config.apiToken)}&filter=open&limit=${limit}`,
      { method: 'GET' },
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

    const cards = await response.json() as TrelloCard[]
    if (!Array.isArray(cards)) {
      throw new ExternalIssueAdapterError(
        'BAD_PAYLOAD',
        'Trello response payload was not an array of cards.',
        cards,
      )
    }

    return cards
      .slice(0, limit)
      .map(card => normalizeTrelloCardToEnvelope(card, listMap.get(card.idList || '') || 'Unknown'))
  }

  // Use search endpoint if no board ID
  const searchQuery = options?.query || 'is:open'
  const response = await fetchImpl(
    `${config.apiUrl}/1/search?${buildAuthParams(config.apiKey, config.apiToken)}&query=${encodeURIComponent(searchQuery)}&modelTypes=cards&cards_limit=${limit}`,
    { method: 'GET' },
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
  const cards = payload.cards

  if (!Array.isArray(cards)) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'Trello response payload was missing cards array.',
      payload,
    )
  }

  return cards
    .slice(0, limit)
    .map(card => normalizeTrelloCardToEnvelope(card))
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
