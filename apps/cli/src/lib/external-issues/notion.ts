/**
 * Notion External Issue Adapter
 *
 * Normalizes Notion database pages into the canonical IssueEnvelope format
 * for use with the external issue pipeline.
 */

import {
  ExternalIssueAdapterError,
  toNormalizedEnvelope,
  type IssueEnvelope,
  type NormalizedIssueEnvelope,
} from './types.js'

export interface NotionAdapterConfig {
  apiKey?: string
  databaseId?: string
}

interface NotionPagePayload {
  id?: string
  url?: string
  created_time?: string
  last_edited_time?: string
  archived?: boolean
  properties?: Record<string, NotionPropertyPayload>
}

type NotionPropertyPayload =
  | { type: 'title'; title: Array<{ plain_text: string }> }
  | { type: 'rich_text'; rich_text: Array<{ plain_text: string }> }
  | { type: 'status'; status: { id: string; name: string; color: string } | null }
  | { type: 'select'; select: { id: string; name: string; color: string } | null }
  | { type: 'multi_select'; multi_select: Array<{ id: string; name: string; color: string }> }
  | { type: 'people'; people: Array<{ id: string; name?: string }> }

const NOTION_API_VERSION = '2022-06-28'

function ensureNotionConfig(
  config: NotionAdapterConfig,
): { apiKey: string; databaseId?: string } {
  const apiKey = config.apiKey || process.env.PRLT_NOTION_API_KEY || process.env.NOTION_API_KEY
  const databaseId = config.databaseId || process.env.PRLT_NOTION_DATABASE_ID

  if (!apiKey) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Notion API key. Set NOTION_API_KEY or PRLT_NOTION_API_KEY, or run "prlt notion configure".',
    )
  }

  return { apiKey, databaseId: databaseId || undefined }
}

function extractPageTitle(page: NotionPagePayload): string {
  if (!page.properties) return 'Untitled'
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'title' && 'title' in prop && prop.title.length > 0) {
      return prop.title.map(t => t.plain_text).join('')
    }
  }
  return 'Untitled'
}

function extractPageDescription(page: NotionPagePayload): string {
  if (!page.properties) return ''
  const desc = page.properties['Description']
  if (desc && desc.type === 'rich_text' && 'rich_text' in desc) {
    return desc.rich_text.map(t => t.plain_text).join('')
  }
  return ''
}

function extractPageStatus(page: NotionPagePayload): string {
  if (!page.properties) return 'Unknown'
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'status' && 'status' in prop && prop.status) {
      return prop.status.name
    }
  }
  return page.archived ? 'Archived' : 'Unknown'
}

function extractPageLabels(page: NotionPagePayload): string[] {
  if (!page.properties) return []
  const labels: string[] = []
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'multi_select' && 'multi_select' in prop) {
      for (const item of prop.multi_select) {
        labels.push(item.name)
      }
    }
  }
  return labels
}

function extractPageAssignee(page: NotionPagePayload): string | null {
  if (!page.properties) return null
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'people' && 'people' in prop && prop.people.length > 0) {
      return prop.people[0].name || null
    }
  }
  return null
}

function derivePriority(labels: string[]): string | null {
  const priorityLabel = labels.find(l => /^P[0-3]$/i.test(l))
  return priorityLabel ? priorityLabel.toUpperCase() : null
}

function ensurePageShape(page: NotionPagePayload): asserts page is Required<Pick<NotionPagePayload, 'id' | 'url'>> & NotionPagePayload {
  if (!page.id || !page.url) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'Notion page payload is missing required fields (id, url).',
      page,
    )
  }
}

/**
 * Normalize a raw Notion page into a canonical IssueEnvelope.
 */
export function normalizeNotionPage(rawPage: unknown): IssueEnvelope {
  if (!rawPage || typeof rawPage !== 'object') {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', 'Notion page payload is invalid.', rawPage)
  }

  const page = rawPage as NotionPagePayload
  ensurePageShape(page)

  const labels = extractPageLabels(page)

  return {
    source: 'notion',
    external_id: page.id,
    external_key: page.id,
    title: extractPageTitle(page),
    description: extractPageDescription(page),
    labels,
    priority: derivePriority(labels),
    status: extractPageStatus(page),
    url: page.url,
    project_key: 'DEFAULT',
    assignee: extractPageAssignee(page),
    item_type: 'page',
    raw: rawPage as Record<string, unknown>,
  }
}

/**
 * Normalize a raw Notion page into a PMO-ready NormalizedIssueEnvelope.
 */
export function normalizeNotionPageToEnvelope(rawPage: unknown): NormalizedIssueEnvelope {
  const envelope = normalizeNotionPage(rawPage)
  return toNormalizedEnvelope(envelope, 'feature')
}

/**
 * Build a PMO ticket description from a NormalizedIssueEnvelope.
 */
export function buildNotionTicketDescription(envelope: NormalizedIssueEnvelope): string {
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
export function buildNotionMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
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
export function buildNotionSpawnContextMessage(
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
 * Check if Notion is configured via environment variables.
 */
export function isNotionConfiguredFromEnv(config?: NotionAdapterConfig): boolean {
  const apiKey = config?.apiKey
    || process.env.PRLT_NOTION_API_KEY
    || process.env.NOTION_API_KEY

  return Boolean(apiKey)
}

/**
 * Fetch a single Notion page by its ID and normalize it.
 */
export async function getNotionPageById(
  configInput: NotionAdapterConfig,
  pageId: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<NormalizedIssueEnvelope | null> {
  const config = ensureNotionConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch

  const url = `https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`

  const response = await fetchImpl(url, {
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Notion-Version': NOTION_API_VERSION,
    },
  })

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'Notion authentication failed. Verify your integration token.',
    )
  }

  if (response.status === 429) {
    throw new ExternalIssueAdapterError(
      'RATE_LIMITED',
      'Notion API rate limit exceeded. Wait a moment and try again.',
    )
  }

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new ExternalIssueAdapterError(
      'REQUEST_FAILED',
      `Notion request failed with status ${response.status}.`,
    )
  }

  const payload = await response.json() as NotionPagePayload
  return normalizeNotionPageToEnvelope(payload)
}

/**
 * Fetch and normalize Notion pages from a database into NormalizedIssueEnvelopes.
 */
export async function listNotionPages(
  configInput: NotionAdapterConfig,
  options?: {
    limit?: number
    query?: string
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope[]> {
  const config = ensureNotionConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100))

  if (!config.databaseId) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Notion database ID. Run "prlt notion configure" and select a database, or set PRLT_NOTION_DATABASE_ID.',
    )
  }

  const url = `https://api.notion.com/v1/databases/${encodeURIComponent(config.databaseId)}/query`

  const body: Record<string, unknown> = { page_size: limit }

  // If there's a text query, we use Notion's filter on title
  if (options?.query) {
    body.filter = {
      property: 'Name',
      title: { contains: options.query },
    }
  }

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_API_VERSION,
    },
    body: JSON.stringify(body),
  })

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError('AUTH_FAILED', 'Notion authentication failed. Verify your integration token.')
  }

  if (!response.ok) {
    throw new ExternalIssueAdapterError('REQUEST_FAILED', `Notion request failed with status ${response.status}.`)
  }

  const payload = await response.json() as { results?: NotionPagePayload[] }
  const pages = payload.results ?? []

  return pages.slice(0, limit).map(page => normalizeNotionPageToEnvelope(page))
}

/**
 * Import a Notion page into PMO as a linked ticket.
 */
export async function importNotionPageToPmo(
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
    return source === 'notion'
      && (key === envelope.source.externalKey || id === envelope.source.externalId)
  })

  const description = buildNotionTicketDescription(envelope)
  const metadata = buildNotionMetadata(envelope)

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
