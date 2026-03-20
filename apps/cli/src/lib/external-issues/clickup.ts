import {
  ExternalIssueAdapterError,
  toNormalizedEnvelope,
  type IssueEnvelope,
  type NormalizedIssueEnvelope,
} from './types.js'

export interface ClickUpAdapterConfig {
  apiKey?: string
  spaceId?: string
}

interface ClickUpTaskPayload {
  id?: string
  custom_id?: string | null
  name?: string
  description?: string
  status?: {
    status?: string
    type?: string
    orderindex?: number
  }
  priority?: {
    id?: string
    priority?: string
  } | null
  assignees?: Array<{
    id?: number
    username?: string
    email?: string
  }>
  tags?: Array<{
    name?: string
  }>
  list?: {
    id?: string
    name?: string
  }
  space?: {
    id?: string
  }
  url?: string
  date_created?: string
  date_updated?: string
  due_date?: string | null
}

function ensureClickUpConfig(
  config: ClickUpAdapterConfig,
): { apiKey: string; spaceId?: string } {
  const apiKey = config.apiKey || process.env.PRLT_CLICKUP_API_KEY || process.env.CLICKUP_API_KEY
  const spaceId = config.spaceId || process.env.PRLT_CLICKUP_SPACE_ID

  if (!apiKey) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing ClickUp API key. Set CLICKUP_API_KEY or PRLT_CLICKUP_API_KEY, or run "prlt clickup connect".',
    )
  }

  return { apiKey, spaceId: spaceId || undefined }
}

function mapClickUpPriority(priority: ClickUpTaskPayload['priority']): string | null {
  if (!priority?.id) return null
  const map: Record<string, string> = {
    '1': 'P0',
    '2': 'P1',
    '3': 'P2',
    '4': 'P3',
  }
  return map[priority.id] ?? null
}

function mapClickUpStatusToCategory(statusType?: string): string | null {
  if (!statusType) return null
  const map: Record<string, string> = {
    open: 'backlog',
    custom: 'started',
    closed: 'completed',
    done: 'completed',
  }
  return map[statusType] ?? null
}

/**
 * Normalize a ClickUp task into a canonical IssueEnvelope.
 */
export function normalizeClickUpTask(task: ClickUpTaskPayload): IssueEnvelope {
  if (!task.id || !task.name || !task.url) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'ClickUp task is missing required fields (id, name, url).',
    )
  }

  return {
    source: 'clickup',
    external_id: task.id,
    external_key: task.custom_id || task.id,
    title: task.name,
    description: task.description || '',
    labels: (task.tags ?? []).map(t => t.name ?? '').filter(Boolean),
    priority: mapClickUpPriority(task.priority),
    status: task.status?.status ?? 'open',
    url: task.url,
    project_key: task.list?.name ?? task.space?.id ?? 'default',
    assignee: task.assignees?.[0]?.username ?? null,
    item_type: 'task',
    raw: task as unknown as Record<string, unknown>,
  }
}

/**
 * Convert to NormalizedIssueEnvelope (PMO-ready).
 */
export function toClickUpNormalizedEnvelope(task: ClickUpTaskPayload): NormalizedIssueEnvelope {
  const envelope = normalizeClickUpTask(task)
  const category = mapClickUpStatusToCategory(task.status?.type)
  return toNormalizedEnvelope(envelope, category)
}

/**
 * Fetch a ClickUp task by ID using the REST API.
 */
export async function fetchClickUpTask(
  taskId: string,
  config: ClickUpAdapterConfig = {},
): Promise<NormalizedIssueEnvelope> {
  const { apiKey } = ensureClickUpConfig(config)

  const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
  })

  if (response.status === 401) {
    throw new ExternalIssueAdapterError('AUTH_FAILED', 'ClickUp authentication failed.')
  }

  if (response.status === 429) {
    throw new ExternalIssueAdapterError('RATE_LIMITED', 'ClickUp API rate limited.')
  }

  if (!response.ok) {
    throw new ExternalIssueAdapterError(
      'REQUEST_FAILED',
      `ClickUp API error (${response.status}): ${await response.text().catch(() => '')}`,
    )
  }

  const task = await response.json() as ClickUpTaskPayload
  return toClickUpNormalizedEnvelope(task)
}

/**
 * Fetch ClickUp tasks from a list.
 */
export async function listClickUpTasks(
  config: ClickUpAdapterConfig & { listId: string },
  options?: { limit?: number },
): Promise<NormalizedIssueEnvelope[]> {
  const { apiKey } = ensureClickUpConfig(config)

  const url = new URL(`https://api.clickup.com/api/v2/list/${config.listId}/task`)
  if (options?.limit) {
    url.searchParams.set('page', '0')
  }

  const response = await fetch(url, {
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new ExternalIssueAdapterError(
      'REQUEST_FAILED',
      `ClickUp API error (${response.status})`,
    )
  }

  const data = await response.json() as { tasks: ClickUpTaskPayload[] }
  return (data.tasks ?? []).map(task => toClickUpNormalizedEnvelope(task))
}

/**
 * Build ticket description from ClickUp envelope.
 */
export function buildClickUpTicketDescription(envelope: NormalizedIssueEnvelope): string {
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
 * Build metadata from ClickUp envelope.
 */
export function buildClickUpMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
  return {
    external_source: envelope.source.name,
    external_key: envelope.source.externalKey,
    external_id: envelope.source.externalId,
    external_url: envelope.source.url,
    external_raw: JSON.stringify(envelope.source.raw),
  }
}

/**
 * Build a spawn context message from a ClickUp NormalizedIssueEnvelope.
 */
export function buildClickUpSpawnContextMessage(
  envelope: NormalizedIssueEnvelope,
  additionalMessage?: string,
): string {
  const lines = [
    `External issue source: ${envelope.source.name}`,
    `External issue key: ${envelope.source.externalKey}`,
    `External issue id: ${envelope.source.externalId}`,
    `External issue URL: ${envelope.source.url}`,
    '',
    `Title: ${envelope.title}`,
    `Status: ${envelope.status}`,
    `Priority: ${envelope.priority || 'Unset'}`,
  ]

  if (envelope.assignee) {
    lines.push(`Assignee: ${envelope.assignee}`)
  }

  if (envelope.labels.length > 0) {
    lines.push(`Labels: ${envelope.labels.join(', ')}`)
  }

  if (envelope.description) {
    lines.push('', 'Description:', envelope.description)
  }

  if (additionalMessage) {
    lines.push('', 'Additional context:', additionalMessage)
  }

  return lines.join('\n')
}
