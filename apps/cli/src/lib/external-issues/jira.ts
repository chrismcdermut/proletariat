import {
  ExternalIssueAdapterError,
  toNormalizedEnvelope,
  type IssueEnvelope,
  type NormalizedIssueEnvelope,
} from './types.js'
import { JiraIssueAdapter } from './adapters.js'

const DEFAULT_JIRA_API_PATH = '/rest/api/3'

export interface JiraAdapterConfig {
  baseUrl?: string
  email?: string
  apiToken?: string
}

interface JiraIssueResponse {
  id?: string
  key?: string
  self?: string
  fields?: Record<string, unknown>
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function ensureJiraConfig(config: JiraAdapterConfig): Required<JiraAdapterConfig> {
  const baseUrl = config.baseUrl || process.env.PRLT_JIRA_BASE_URL || process.env.JIRA_BASE_URL
  const email = config.email || process.env.PRLT_JIRA_EMAIL || process.env.JIRA_EMAIL || ''
  const apiToken = config.apiToken || process.env.PRLT_JIRA_API_TOKEN || process.env.JIRA_API_TOKEN

  if (!baseUrl) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Jira base URL. Set PRLT_JIRA_BASE_URL or JIRA_BASE_URL.',
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
    email,
    apiToken,
  }
}

function buildAuthHeader(config: Required<JiraAdapterConfig>): string {
  if (config.email) {
    const token = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
    return `Basic ${token}`
  }
  return `Bearer ${config.apiToken}`
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

function toIssueEnvelope(rawIssue: unknown): IssueEnvelope {
  const adapter = new JiraIssueAdapter()
  return adapter.normalize(rawIssue)
}

export function normalizeJiraIssue(rawIssue: unknown): IssueEnvelope {
  if (!rawIssue || typeof rawIssue !== 'object') {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', 'Jira issue payload is invalid.', rawIssue)
  }

  const issue = rawIssue as JiraIssueResponse
  ensureIssueShape(issue)
  return toIssueEnvelope(issue)
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

export async function getJiraIssueByKey(
  configInput: JiraAdapterConfig,
  key: string,
  options?: {
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope | null> {
  const config = ensureJiraConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch

  const baseApiUrl = `${config.baseUrl}${DEFAULT_JIRA_API_PATH}`
  const fields = [
    'summary',
    'description',
    'labels',
    'priority',
    'status',
    'project',
    'assignee',
    'issuetype',
  ].join(',')
  const issueUrl = `${baseApiUrl}/issue/${encodeURIComponent(key)}?fields=${encodeURIComponent(fields)}`

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

  if (!response.ok) {
    throw new ExternalIssueAdapterError(
      'REQUEST_FAILED',
      `Jira request failed with status ${response.status}.`,
    )
  }

  const payload = await response.json() as JiraIssueResponse
  return normalizeJiraIssueToEnvelope(payload)
}
