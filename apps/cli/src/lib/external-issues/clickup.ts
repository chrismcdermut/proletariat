import {
  ExternalIssueAdapterError,
  toNormalizedEnvelope,
  type IssueEnvelope,
  type NormalizedIssueEnvelope,
} from './types.js'
import { CLICKUP_PRIORITY_TO_PMO } from '../clickup/types.js'

export interface ClickUpAdapterConfig {
  apiKey?: string
  listId?: string
  workspaceId?: string
}

interface ClickUpApiTask {
  id?: string
  custom_id?: string | null
  name?: string
  description?: string
  status?: { status?: string; type?: string; color?: string }
  priority?: { id?: string; priority?: string; color?: string; orderindex?: string } | null
  assignees?: Array<{ id?: number; username?: string; email?: string }>
  tags?: Array<{ name?: string }>
  url?: string
  list?: { id?: string; name?: string }
  space?: { id?: string }
  folder?: { id?: string; name?: string }
  date_created?: string
  date_updated?: string
  due_date?: string | null
}

function ensureClickUpConfig(
  config: ClickUpAdapterConfig,
): { apiKey: string; listId?: string; workspaceId?: string } {
  const apiKey = config.apiKey || process.env.PRLT_CLICKUP_API_KEY || process.env.CLICKUP_API_KEY

  if (!apiKey) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing ClickUp API key. Set CLICKUP_API_KEY or PRLT_CLICKUP_API_KEY, or run "prlt clickup connect".',
    )
  }

  return {
    apiKey,
    listId: config.listId || process.env.PRLT_CLICKUP_LIST_ID,
    workspaceId: config.workspaceId || process.env.PRLT_CLICKUP_WORKSPACE_ID,
  }
}

function deriveClickUpUrl(task: ClickUpApiTask): string {
  if (task.url) return task.url
  return `https://app.clickup.com/t/${task.id}`
}

function deriveClickUpStatus(task: ClickUpApiTask): string {
  return task.status?.status || 'Open'
}

function deriveClickUpProjectKey(task: ClickUpApiTask): string {
  return task.list?.name || task.list?.id || 'CLICKUP'
}

function deriveClickUpLabels(task: ClickUpApiTask): string[] {
  if (!Array.isArray(task.tags)) return []
  return task.tags
    .map(tag => tag.name?.trim())
    .filter((name): name is string => Boolean(name))
}

function deriveClickUpPriority(task: ClickUpApiTask): string | null {
  const priorityId = task.priority?.id
  if (!priorityId) return null
  return CLICKUP_PRIORITY_TO_PMO[priorityId] ?? null
}

/**
 * Normalize a raw ClickUp task into a canonical IssueEnvelope.
 */
export function normalizeClickUpTask(rawTask: unknown): IssueEnvelope {
  if (!rawTask || typeof rawTask !== 'object') {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', 'ClickUp task payload is invalid.', rawTask)
  }

  const task = rawTask as ClickUpApiTask

  if (!task.id || !task.name) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'ClickUp task payload is missing required fields (id, name).',
      task,
    )
  }

  return {
    source: 'clickup',
    external_id: task.id,
    external_key: task.custom_id || task.id,
    title: task.name,
    description: task.description || '',
    labels: deriveClickUpLabels(task),
    priority: deriveClickUpPriority(task),
    status: deriveClickUpStatus(task),
    url: deriveClickUpUrl(task),
    project_key: deriveClickUpProjectKey(task),
    assignee: task.assignees?.[0]?.username || null,
    item_type: 'task',
    raw: rawTask as Record<string, unknown>,
  }
}

/**
 * Normalize a raw ClickUp task into a PMO-ready NormalizedIssueEnvelope.
 */
export function normalizeClickUpTaskToEnvelope(rawTask: unknown): NormalizedIssueEnvelope {
  const envelope = normalizeClickUpTask(rawTask)
  return toNormalizedEnvelope(envelope, 'feature')
}

/**
 * Build a PMO ticket description from a NormalizedIssueEnvelope.
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
 * Build ticket metadata from a NormalizedIssueEnvelope for traceability.
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
 * Fetch a single ClickUp task by ID and normalize it.
 */
export async function getClickUpTaskById(
  configInput: ClickUpAdapterConfig,
  taskId: string,
  options?: {
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope | null> {
  const config = ensureClickUpConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch

  const url = `https://api.clickup.com/api/v2/task/${encodeURIComponent(taskId)}`

  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available in supported Node runtimes for this CLI
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: config.apiKey,
      'Content-Type': 'application/json',
    },
  })

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'ClickUp authentication failed. Verify your API key.',
    )
  }

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new ExternalIssueAdapterError(
      'REQUEST_FAILED',
      `ClickUp request failed with status ${response.status}.`,
    )
  }

  const task = await response.json() as ClickUpApiTask
  if (!task) return null
  return normalizeClickUpTaskToEnvelope(task)
}

/**
 * Fetch and normalize ClickUp tasks from a list into NormalizedIssueEnvelopes.
 */
export async function listClickUpTasks(
  configInput: ClickUpAdapterConfig,
  options?: {
    limit?: number
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope[]> {
  const config = ensureClickUpConfig(configInput)

  if (!config.listId) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing ClickUp list ID. Run "prlt clickup connect" and select a list, or set PRLT_CLICKUP_LIST_ID.',
    )
  }

  const fetchImpl = options?.fetchImpl || fetch

  const url = `https://api.clickup.com/api/v2/list/${encodeURIComponent(config.listId)}/task?page=0`

  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available in supported Node runtimes for this CLI
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: config.apiKey,
      'Content-Type': 'application/json',
    },
  })

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'ClickUp authentication failed. Verify your API key.',
    )
  }

  if (!response.ok) {
    throw new ExternalIssueAdapterError(
      'REQUEST_FAILED',
      `ClickUp request failed with status ${response.status}.`,
    )
  }

  const payload = await response.json() as { tasks?: ClickUpApiTask[] }

  const tasks = payload.tasks
  if (!Array.isArray(tasks)) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'ClickUp response payload was missing tasks array.',
      payload,
    )
  }

  const limit = options?.limit ?? 50
  return tasks.slice(0, limit).map(normalizeClickUpTaskToEnvelope)
}
