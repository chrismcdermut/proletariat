import {
  ExternalIssueAdapterError,
  type NormalizedIssueEnvelope,
  toNormalizedEnvelope,
} from './types.js'
import { JiraIssueAdapter } from './adapters.js'

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

function buildBasicAuth(email: string, apiToken: string): string {
  const encoded = Buffer.from(`${email}:${apiToken}`, 'utf8').toString('base64')
  return `Basic ${encoded}`
}

function normalizeHost(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '')
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }
  return `https://${trimmed}`
}

function ensureJiraConfig(config: JiraAdapterConfig): Required<JiraAdapterConfig> {
  const host = config.host || process.env.PRLT_JIRA_HOST || process.env.JIRA_HOST
  const email = config.email || process.env.PRLT_JIRA_EMAIL || process.env.JIRA_EMAIL
  const apiToken = config.apiToken || process.env.PRLT_JIRA_API_TOKEN || process.env.JIRA_API_TOKEN
  const projectKey = config.projectKey || process.env.PRLT_JIRA_PROJECT || process.env.JIRA_PROJECT_KEY
  const jql = config.jql || process.env.PRLT_JIRA_JQL

  if (!host) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Jira host. Pass --host or set PRLT_JIRA_HOST/JIRA_HOST.',
    )
  }

  if (!email) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Jira email. Set PRLT_JIRA_EMAIL or JIRA_EMAIL.',
    )
  }

  if (!apiToken) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Jira API token. Set PRLT_JIRA_API_TOKEN or JIRA_API_TOKEN.',
    )
  }

  if (!projectKey && !jql) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Jira project key/JQL. Pass --project-key or --jql, or set PRLT_JIRA_PROJECT/PRLT_JIRA_JQL.',
    )
  }

  return {
    host: normalizeHost(host),
    email,
    apiToken,
    projectKey: projectKey ?? '',
    jql: jql ?? '',
  }
}

function ensureIssueKey(key: string): string {
  const trimmed = key.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(trimmed)) {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', `Invalid Jira issue key: "${key}".`)
  }
  return trimmed
}

function buildListJql(config: Required<JiraAdapterConfig>, explicitJql?: string): string {
  const jql = explicitJql?.trim() || config.jql.trim()
  if (jql.length > 0) {
    return jql
  }

  const projectKey = config.projectKey.trim()
  if (!projectKey) {
    throw new ExternalIssueAdapterError('MISSING_CONFIG', 'Missing Jira project key or JQL for issue listing.')
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

function normalizeJiraIssue(rawIssue: unknown): NormalizedIssueEnvelope {
  const adapter = new JiraIssueAdapter()
  const envelope = adapter.normalize(rawIssue)
  return toNormalizedEnvelope(envelope, 'feature')
}

function buildHeaders(config: Required<JiraAdapterConfig>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: buildBasicAuth(config.email, config.apiToken),
  }
}

/**
 * Build a PMO ticket description from a Jira issue envelope.
 */
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

/**
 * Build ticket metadata from a Jira envelope for traceability.
 */
export function buildJiraMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
  return {
    external_source: envelope.source.name,
    external_key: envelope.source.externalKey,
    external_id: envelope.source.externalId,
    external_url: envelope.source.url,
    external_raw: JSON.stringify(envelope.source.raw),
  }
}

/**
 * Build a spawn context message from a Jira envelope.
 */
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

/**
 * Build a CLI command string for selecting a specific Jira issue.
 */
export function buildJiraIssueChoiceCommand(issueKey: string, projectId?: string): string {
  let command = `prlt work jira --issue ${issueKey} --json`
  if (projectId) {
    command += ` -P ${projectId}`
  }
  return command
}

/**
 * Fetch a single Jira issue by key (for example, PROJ-123) and normalize it.
 */
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

  const response = await fetchImpl(`${config.host}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${JIRA_ISSUE_FIELDS.join(',')}`, {
    method: 'GET',
    headers: buildHeaders(config),
  })

  if (response.status === 404) {
    return null
  }

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'Jira authentication failed. Verify Jira host/email/token configuration.',
    )
  }

  const payload = await parseJsonOrThrow(response)

  if (!response.ok) {
    const msg = getErrorMessage(payload, `Jira request failed with status ${response.status}.`)
    throw new ExternalIssueAdapterError('REQUEST_FAILED', msg, payload)
  }

  const issue = payload as JiraIssueResponse
  if (!issue.id || !issue.key || !issue.fields) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'Jira issue payload is missing required fields (id, key, fields).',
      payload,
    )
  }

  return normalizeJiraIssue(payload)
}

/**
 * Fetch and normalize Jira issues into NormalizedIssueEnvelopes.
 */
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

  const response = await fetchImpl(`${config.host}/rest/api/3/search`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({
      jql,
      maxResults: limit,
      fields: JIRA_ISSUE_FIELDS,
    }),
  })

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'Jira authentication failed. Verify Jira host/email/token configuration.',
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

  return data.issues.map(normalizeJiraIssue)
}
