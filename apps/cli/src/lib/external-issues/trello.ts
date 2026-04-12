import {
  ExternalIssueAdapterError,
  toNormalizedEnvelope,
  type IssueEnvelope,
  type NormalizedIssueEnvelope,
} from './types.js'

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
  members?: Array<{ id?: string; fullName?: string; username?: string }>
}

interface TrelloListPayload {
  id?: string
  name?: string
}

function ensureTrelloConfig(
  config: TrelloAdapterConfig,
): { apiKey: string; apiToken: string; boardId?: string } {
  const apiKey = config.apiKey || process.env.PRLT_TRELLO_API_KEY || process.env.TRELLO_API_KEY
  const apiToken = config.apiToken || process.env.PRLT_TRELLO_API_TOKEN || process.env.TRELLO_API_TOKEN
  const boardId = config.boardId || process.env.PRLT_TRELLO_BOARD_ID

  if (!apiKey) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Trello API key. Set TRELLO_API_KEY or PRLT_TRELLO_API_KEY, or run "prlt trello configure".',
    )
  }

  if (!apiToken) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Trello API token. Set TRELLO_API_TOKEN or PRLT_TRELLO_API_TOKEN, or run "prlt trello configure".',
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

function deriveTrelloLabels(card: TrelloCardPayload): string[] {
  if (!Array.isArray(card.labels)) {
    return []
  }
  return card.labels
    .map(label => label.name?.trim())
    .filter(Boolean)
}

function deriveTrelloPriority(labels: string[]): string | null {
  const priorityLabel = labels.find(l => /^P[0-3]$/i.test(l))
  return priorityLabel ? priorityLabel.toUpperCase() : null
}

function deriveTrelloAssignee(card: TrelloCardPayload): string | null {
  const members = card.members
  if (Array.isArray(members) && members.length > 0) {
    return members[0]?.fullName || members[0]?.username || null
  }
  return null
}

function deriveCategory(_card: TrelloCardPayload): string {
  return 'feature'
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

  const card = rawCard as TrelloCardPayload
  ensureCardShape(card)

  const labels = deriveTrelloLabels(card)

  return {
    source: 'trello',
    external_id: card.id,
    external_key: card.id,
    title: card.name,
    description: card.desc || '',
    labels,
    priority: deriveTrelloPriority(labels),
    status: listName ?? (card.closed ? 'Closed' : 'Open'),
    url: card.url,
    project_key: card.idBoard || 'DEFAULT',
    assignee: deriveTrelloAssignee(card),
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
  const card = rawCard as TrelloCardPayload
  return toNormalizedEnvelope(envelope, deriveCategory(card))
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
export function buildTrelloCardChoiceCommand(cardId: string, projectId?: string): string {
  let command = `prlt work start --from trello:${cardId} --json`
  if (projectId) {
    command += ` -P ${projectId}`
  }
  return command
}

/**
 * Fetch the list name for a card's idList.
 */
async function fetchListName(
  config: { apiKey: string; apiToken: string },
  listId: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<string | undefined> {
  const fetchImpl = options?.fetchImpl || fetch
  try {
    const url = `https://api.trello.com/1/lists/${listId}?key=${encodeURIComponent(config.apiKey)}&token=${encodeURIComponent(config.apiToken)}&fields=name`
    const response = await fetchImpl(url)
    if (!response.ok) return undefined
    const list = await response.json() as TrelloListPayload
    return list.name ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Fetch a single Trello card by its ID and normalize it.
 */
export async function getTrelloCardById(
  configInput: TrelloAdapterConfig,
  cardId: string,
  options?: {
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope | null> {
  const config = ensureTrelloConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch

  const url = `https://api.trello.com/1/cards/${encodeURIComponent(cardId)}?key=${encodeURIComponent(config.apiKey)}&token=${encodeURIComponent(config.apiToken)}&fields=id,name,desc,url,shortUrl,idBoard,idList,idMembers,closed,due,dueComplete&members=true&member_fields=fullName,username&labels=all`

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

  const payload = await response.json() as TrelloCardPayload

  // Resolve list name for status
  const listName = payload.idList
    ? await fetchListName(config, payload.idList, { fetchImpl })
    : undefined

  return normalizeTrelloCardToEnvelope(payload, listName)
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
 * Fetch and normalize Trello cards from a board into NormalizedIssueEnvelopes.
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

  if (!config.boardId && !options?.query) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Trello board ID. Run "prlt trello configure" and select a board, or set PRLT_TRELLO_BOARD_ID.',
    )
  }

  // If query, use search endpoint
  if (options?.query) {
    const url = `https://api.trello.com/1/search?key=${encodeURIComponent(config.apiKey)}&token=${encodeURIComponent(config.apiToken)}&query=${encodeURIComponent(options.query)}&modelTypes=cards&cards_limit=${limit}&card_fields=id,name,desc,url,shortUrl,idBoard,idList,idMembers,closed,due,dueComplete&card_members=true&card_member_fields=fullName,username&card_labels=all`

    const response = await fetchImpl(url)

    if (response.status === 401 || response.status === 403) {
      throw new ExternalIssueAdapterError('AUTH_FAILED', 'Trello authentication failed. Verify your API key and token.')
    }

    if (!response.ok) {
      throw new ExternalIssueAdapterError('REQUEST_FAILED', `Trello request failed with status ${response.status}.`)
    }

    const payload = await response.json() as { cards?: TrelloCardPayload[] }
    const cards = payload.cards ?? []
    return cards.slice(0, limit).map(card => normalizeTrelloCardToEnvelope(card))
  }

  // Otherwise, list from board
  const url = `https://api.trello.com/1/boards/${encodeURIComponent(config.boardId!)}/cards/open?key=${encodeURIComponent(config.apiKey)}&token=${encodeURIComponent(config.apiToken)}&fields=id,name,desc,url,shortUrl,idBoard,idList,idMembers,closed,due,dueComplete&members=true&member_fields=fullName,username&labels=all`

  const response = await fetchImpl(url)

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError('AUTH_FAILED', 'Trello authentication failed. Verify your API key and token.')
  }

  if (!response.ok) {
    throw new ExternalIssueAdapterError('REQUEST_FAILED', `Trello request failed with status ${response.status}.`)
  }

  const cards = await response.json() as TrelloCardPayload[]

  if (!Array.isArray(cards)) {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', 'Trello response payload was missing cards array.', cards)
  }

  return cards.slice(0, limit).map(card => normalizeTrelloCardToEnvelope(card))
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
