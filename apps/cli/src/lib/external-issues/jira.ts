import {
  ExternalIssueAdapterError,
  toNormalizedEnvelope,
  type IssueEnvelope,
  type NormalizedIssueEnvelope,
} from './types.js'
import { JiraIssueAdapter } from './adapters.js'

const DEFAULT_JIRA_API_PATH = '/rest/api/3'
const JIRA_ISSUE_FIELDS = [
  'summary',
  'description',
  'labels',
  'priority',
  'status',
  'project',
  'issuetype',
  'assignee',
] as const

export interface JiraAdapterConfig {
  baseUrl?: string
  host?: string
  email?: string
  apiToken?: string
  projectKey?: string
  jql?: string
}

interface JiraIssueSearchResponse {
  issues?: unknown[]
  errorMessages?: string[]
}

interface JiraIssueResponse {
  id?: string
  key?: string
  fields?: Record<string, unknown>
  errorMessages?: string[]
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }
  return `https://${trimmed}`
}

function ensureJiraConfig(config: JiraAdapterConfig): Required<JiraAdapterConfig> {
  const baseUrl = config.baseUrl
    || config.host
    || process.env.PRLT_JIRA_BASE_URL
    || process.env.JIRA_BASE_URL
    || process.env.PRLT_JIRA_HOST
    || process.env.JIRA_HOST
  const email = config.email || process.env.PRLT_JIRA_EMAIL || process.env.JIRA_EMAIL || ''
  const apiToken = config.apiToken || process.env.PRLT_JIRA_API_TOKEN || process.env.JIRA_API_TOKEN
  const projectKey = config.projectKey || process.env.PRLT_JIRA_PROJECT || process.env.JIRA_PROJECT_KEY || ''
  const jql = config.jql || process.env.PRLT_JIRA_JQL || ''

  if (!baseUrl) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Jira base URL. Set PRLT_JIRA_BASE_URL/JIRA_BASE_URL or PRLT_JIRA_HOST/JIRA_HOST.',
    )
  }

  if (!apiToken) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Jira API token. Set PRLT_JIRA_API_TOKEN or JIRA_API_TOKEN.',
    )
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    host: normalizeBaseUrl(baseUrl),
    email,
    apiToken,
    projectKey,
    jql,
  }
}

function ensureIssueKey(key: string): string {
  const trimmed = key.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(trimmed)) {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', `Invalid Jira issue key: "${key}".`)
  }
  return trimmed
}

function buildAuthHeader(config: Required<JiraAdapterConfig>): string {
  if (config.email) {
    const token = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
    return `Basic ${token}`
  }

  return `Bearer ${config.apiToken}`
}

function buildListJql(config: Required<JiraAdapterConfig>, explicitJql?: string): string {
  const jql = explicitJql?.trim() || config.jql.trim()
  if (jql.length > 0) {
    return jql
  }

  const projectKey = config.projectKey.trim()
  if (!projectKey) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Jira project key/JQL. Pass --project-key or --jql, or set PRLT_JIRA_PROJECT/PRLT_JIRA_JQL.',
    )
  }

  return `project = "${projectKey}" AND statusCategory != Done ORDER BY updated DESC`
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') {
    return fallback
  }

  const errorMessages = (payload as { errorMessages?: unknown }).errorMessages
  if (Array.isArray(errorMessages) && typeof errorMessages[0] === 'string' && errorMessages[0].trim()) {
    return errorMessages[0].trim()
  }

  return fallback
}

async function parseJsonOrThrow(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', 'Jira response was not valid JSON.')
  }
}

function deriveJiraCategory(envelope: IssueEnvelope): string {
  const typeValue = envelope.item_type?.trim().toLowerCase() || ''
  if (typeValue === 'bug' || typeValue === 'incident') {
    return 'bug'
  }
  if (typeValue === 'task' || typeValue === 'story' || typeValue === 'issue') {
    return 'feature'
  }
  return 'feature'
}

function ensureIssueShape(issue: JiraIssueResponse): asserts issue is Required<Pick<JiraIssueResponse, 'id' | 'key'>> & JiraIssueResponse {
  if (!issue.id || !issue.key || !issue.fields) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'Jira issue payload is missing required fields (id, key, fields).',
      issue,
    )
  }
}

export function normalizeJiraIssue(rawIssue: unknown): IssueEnvelope {
  if (!rawIssue || typeof rawIssue !== 'object') {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', 'Jira issue payload is invalid.', rawIssue)
  }

  const issue = rawIssue as JiraIssueResponse
  ensureIssueShape(issue)

  const adapter = new JiraIssueAdapter()
  return adapter.normalize(issue)
}

export function normalizeJiraIssueToEnvelope(rawIssue: unknown): NormalizedIssueEnvelope {
  const envelope = normalizeJiraIssue(rawIssue)
  return toNormalizedEnvelope(envelope, deriveJiraCategory(envelope))
}

export function buildJiraTicketDescription(envelope: NormalizedIssueEnvelope): string {
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

export function buildJiraMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
  return {
    external_source: envelope.source.name,
    external_key: envelope.source.externalKey,
    external_id: envelope.source.externalId,
    external_url: envelope.source.url,
    external_raw: JSON.stringify(envelope.source.raw),
  }
}

export function buildJiraSpawnContextMessage(
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

export function buildJiraIssueChoiceCommand(issueKey: string, projectId?: string): string {
  let command = `prlt work jira --issue ${issueKey} --json`
  if (projectId) {
    command += ` -P ${projectId}`
  }
  return command
}

export async function getJiraIssueByKey(
  configInput: JiraAdapterConfig,
  issueKey: string,
  options?: {
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope | null> {
  const config = ensureJiraConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch
  const key = ensureIssueKey(issueKey)
  const baseApiUrl = `${config.baseUrl}${DEFAULT_JIRA_API_PATH}`
  const fields = encodeURIComponent(JIRA_ISSUE_FIELDS.join(','))
  const issueUrl = `${baseApiUrl}/issue/${encodeURIComponent(key)}?fields=${fields}`

  const response = await fetchImpl(issueUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: buildAuthHeader(config),
    },
  })

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'Jira authentication failed. Verify your Jira credentials.',
    )
  }

  if (response.status === 404) {
    return null
  }

  const payload = await parseJsonOrThrow(response)

  if (!response.ok) {
    const msg = getErrorMessage(payload, `Jira request failed with status ${response.status}.`)
    throw new ExternalIssueAdapterError('REQUEST_FAILED', msg, payload)
  }

  return normalizeJiraIssueToEnvelope(payload)
}

/**
 * Check if Jira is configured via environment variables.
 * Returns true if at least a base URL and API token are present.
 */
export function isJiraConfigured(config?: JiraAdapterConfig): boolean {
  const baseUrl = config?.baseUrl
    || config?.host
    || process.env.PRLT_JIRA_BASE_URL
    || process.env.JIRA_BASE_URL
    || process.env.PRLT_JIRA_HOST
    || process.env.JIRA_HOST
  const apiToken = config?.apiToken
    || process.env.PRLT_JIRA_API_TOKEN
    || process.env.JIRA_API_TOKEN

  return Boolean(baseUrl && apiToken)
}

/**
 * Get the configured Jira project key from config or environment variables.
 */
export function getJiraProjectKey(config?: JiraAdapterConfig): string | undefined {
  return config?.projectKey
    || process.env.PRLT_JIRA_PROJECT
    || process.env.JIRA_PROJECT_KEY
    || undefined
}

/**
 * Import a Jira issue into PMO as a linked ticket.
 *
 * Creates a new PMO ticket or updates an existing one that is linked
 * to the same Jira issue (matched by external_key or external_id).
 *
 * @returns Object with ticketId and whether it was newly created
 */
export async function importJiraIssueToPmo(
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
    return source === 'jira'
      && (key === envelope.source.externalKey || id === envelope.source.externalId)
  })

  const description = buildJiraTicketDescription(envelope)
  const metadata = buildJiraMetadata(envelope)

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

export async function listJiraIssues(
  configInput: JiraAdapterConfig,
  options?: {
    limit?: number
    jql?: string
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope[]> {
  const config = ensureJiraConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100))
  const jql = buildListJql(config, options?.jql)
  const baseApiUrl = `${config.baseUrl}${DEFAULT_JIRA_API_PATH}`

  const response = await fetchImpl(`${baseApiUrl}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: buildAuthHeader(config),
    },
    body: JSON.stringify({
      jql,
      maxResults: limit,
      fields: JIRA_ISSUE_FIELDS,
    }),
  })

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'Jira authentication failed. Verify your Jira credentials.',
    )
  }

  const payload = await parseJsonOrThrow(response)

  if (!response.ok) {
    const msg = getErrorMessage(payload, `Jira request failed with status ${response.status}.`)
    throw new ExternalIssueAdapterError('REQUEST_FAILED', msg, payload)
  }

  const data = payload as JiraIssueSearchResponse
  if (!Array.isArray(data.issues)) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'Jira response payload was missing issues array.',
      payload,
    )
  }

  return data.issues.map(normalizeJiraIssueToEnvelope)
}
