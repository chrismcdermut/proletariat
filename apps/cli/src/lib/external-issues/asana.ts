import {
  ExternalIssueAdapterError,
  toNormalizedEnvelope,
  type IssueEnvelope,
  type NormalizedIssueEnvelope,
} from './types.js'

export interface AsanaAdapterConfig {
  accessToken?: string
  projectGid?: string
  workspaceGid?: string
}

interface AsanaApiTask {
  gid?: string
  name?: string
  completed?: boolean
  notes?: string
  assignee?: { gid?: string; name?: string } | null
  tags?: Array<{ gid?: string; name?: string }>
  memberships?: Array<{ project?: { gid?: string; name?: string }; section?: { gid?: string; name?: string } }>
  due_on?: string | null
  permalink_url?: string
}

function ensureAsanaConfig(
  config: AsanaAdapterConfig,
): { accessToken: string; projectGid?: string; workspaceGid?: string } {
  const accessToken = config.accessToken || process.env.PRLT_ASANA_ACCESS_TOKEN || process.env.ASANA_ACCESS_TOKEN

  if (!accessToken) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Asana access token. Set ASANA_ACCESS_TOKEN or PRLT_ASANA_ACCESS_TOKEN, or run "prlt asana connect".',
    )
  }

  return {
    accessToken,
    projectGid: config.projectGid || process.env.PRLT_ASANA_PROJECT_GID,
    workspaceGid: config.workspaceGid || process.env.PRLT_ASANA_WORKSPACE_GID,
  }
}

function deriveAsanaUrl(task: AsanaApiTask): string {
  if (task.permalink_url) {
    return task.permalink_url
  }
  return `https://app.asana.com/0/0/${task.gid}`
}

function deriveAsanaStatus(task: AsanaApiTask): string {
  if (task.completed) {
    return 'Completed'
  }
  const section = task.memberships?.[0]?.section?.name
  if (section) {
    return section
  }
  return 'Open'
}

function deriveAsanaProjectKey(task: AsanaApiTask): string {
  const project = task.memberships?.[0]?.project
  return project?.name || project?.gid || 'ASANA'
}

function deriveAsanaLabels(task: AsanaApiTask): string[] {
  if (!Array.isArray(task.tags)) {
    return []
  }
  return task.tags
    .map(tag => tag.name?.trim())
    .filter((name): name is string => Boolean(name))
}

/**
 * Normalize a raw Asana task into a canonical IssueEnvelope.
 */
export function normalizeAsanaTask(rawTask: unknown): IssueEnvelope {
  if (!rawTask || typeof rawTask !== 'object') {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', 'Asana task payload is invalid.', rawTask)
  }

  const task = rawTask as AsanaApiTask

  if (!task.gid || !task.name) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'Asana task payload is missing required fields (gid, name).',
      task,
    )
  }

  return {
    source: 'asana',
    external_id: task.gid,
    external_key: task.gid,
    title: task.name,
    description: task.notes || '',
    labels: deriveAsanaLabels(task),
    priority: null,
    status: deriveAsanaStatus(task),
    url: deriveAsanaUrl(task),
    project_key: deriveAsanaProjectKey(task),
    assignee: task.assignee?.name || null,
    item_type: 'task',
    raw: rawTask as Record<string, unknown>,
  }
}

/**
 * Normalize a raw Asana task into a PMO-ready NormalizedIssueEnvelope.
 */
export function normalizeAsanaTaskToEnvelope(rawTask: unknown): NormalizedIssueEnvelope {
  const envelope = normalizeAsanaTask(rawTask)
  return toNormalizedEnvelope(envelope, 'feature')
}

/**
 * Build a PMO ticket description from a NormalizedIssueEnvelope.
 */
export function buildAsanaTicketDescription(envelope: NormalizedIssueEnvelope): string {
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
export function buildAsanaMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
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
export function buildAsanaSpawnContextMessage(
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
 * Build a CLI command string for selecting a specific Asana task.
 */
export function buildAsanaTaskChoiceCommand(taskGid: string, projectId?: string): string {
  let command = `prlt work asana --task ${taskGid} --json`
  if (projectId) {
    command += ` -P ${projectId}`
  }
  return command
}

/**
 * Fetch a single Asana task by GID and normalize it.
 */
export async function getAsanaTaskByGid(
  configInput: AsanaAdapterConfig,
  taskGid: string,
  options?: {
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope | null> {
  const config = ensureAsanaConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch

  const optFields = 'gid,name,completed,notes,assignee.gid,assignee.name,tags.gid,tags.name,memberships.project.gid,memberships.project.name,memberships.section.gid,memberships.section.name,due_on,permalink_url'
  const url = `https://app.asana.com/api/1.0/tasks/${encodeURIComponent(taskGid)}?opt_fields=${encodeURIComponent(optFields)}`

  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available in supported Node runtimes for this CLI
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'Asana authentication failed. Verify your Asana access token.',
    )
  }

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new ExternalIssueAdapterError(
      'REQUEST_FAILED',
      `Asana request failed with status ${response.status}.`,
    )
  }

  const payload = await response.json() as { data?: AsanaApiTask; errors?: Array<{ message?: string }> }

  if (payload.errors && payload.errors.length > 0) {
    const message = payload.errors[0]?.message || 'Unknown Asana API error.'
    throw new ExternalIssueAdapterError('REQUEST_FAILED', `Asana API error: ${message}`)
  }

  const task = payload.data
  if (!task) return null
  return normalizeAsanaTaskToEnvelope(task)
}

/**
 * Fetch and normalize Asana tasks from a project into NormalizedIssueEnvelopes.
 */
export async function listAsanaTasks(
  configInput: AsanaAdapterConfig,
  options?: {
    limit?: number
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope[]> {
  const config = ensureAsanaConfig(configInput)

  if (!config.projectGid) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Asana project GID. Run "prlt asana connect" and select a project, or set PRLT_ASANA_PROJECT_GID.',
    )
  }

  const fetchImpl = options?.fetchImpl || fetch
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 100))

  const optFields = 'gid,name,completed,notes,assignee.gid,assignee.name,tags.gid,tags.name,memberships.project.gid,memberships.project.name,memberships.section.gid,memberships.section.name,due_on,permalink_url'
  const url = `https://app.asana.com/api/1.0/projects/${encodeURIComponent(config.projectGid)}/tasks?opt_fields=${encodeURIComponent(optFields)}&limit=${limit}&completed_since=now`

  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available in supported Node runtimes for this CLI
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'Asana authentication failed. Verify your Asana access token.',
    )
  }

  if (!response.ok) {
    throw new ExternalIssueAdapterError(
      'REQUEST_FAILED',
      `Asana request failed with status ${response.status}.`,
    )
  }

  const payload = await response.json() as { data?: AsanaApiTask[]; errors?: Array<{ message?: string }> }

  if (payload.errors && payload.errors.length > 0) {
    const message = payload.errors[0]?.message || 'Unknown Asana API error.'
    throw new ExternalIssueAdapterError('REQUEST_FAILED', `Asana API error: ${message}`)
  }

  const tasks = payload.data
  if (!Array.isArray(tasks)) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'Asana response payload was missing tasks array.',
      payload,
    )
  }

  return tasks.map(normalizeAsanaTaskToEnvelope)
}

/**
 * Import an Asana task into PMO as a linked ticket.
 *
 * Accepts a provider-shaped object (listTickets returns ProviderListResult)
 * so callers can pass a resolved TicketProvider. Also accepts the legacy
 * storage-shaped interface for backward-compatible test mocks.
 */
export async function importAsanaTaskToPmo(
  provider: {
    listTickets(projectId: string): Promise<{ success: boolean; tickets: Array<{ id: string; metadata?: Record<string, string> }> }>,
    createTicket(projectId: string, input: {
      title: string
      description: string
      priority?: string
      category?: string
      labels: string[]
      metadata: Record<string, string>
    }): Promise<{ success: boolean; ticket?: { id: string } | null; error?: string }>,
    updateTicket(ticketId: string, input: {
      title: string
      description: string
      priority?: string
      category?: string
      labels: string[]
      metadata: Record<string, string>
    }): Promise<{ success: boolean; ticket?: { id: string } | null; error?: string }>,
  },
  projectId: string,
  envelope: NormalizedIssueEnvelope,
): Promise<{ ticketId: string; created: boolean }> {
  const listResult = await provider.listTickets(projectId)
  const tickets = listResult.success ? listResult.tickets : []
  const existing = tickets.find((ticket) => {
    const source = ticket.metadata?.external_source
    const key = ticket.metadata?.external_key
    const id = ticket.metadata?.external_id
    return source === 'asana'
      && (key === envelope.source.externalKey || id === envelope.source.externalId)
  })

  const description = buildAsanaTicketDescription(envelope)
  const metadata = buildAsanaMetadata(envelope)

  if (existing) {
    const updateResult = await provider.updateTicket(existing.id, {
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
    if (!updateResult.success) throw new Error(updateResult.error || 'Failed to update ticket')
    return { ticketId: existing.id, created: false }
  }

  const createResult = await provider.createTicket(projectId, {
    title: envelope.title,
    description,
    priority: envelope.priority ?? undefined,
    category: envelope.category ?? undefined,
    labels: envelope.labels,
    metadata,
  })
  if (!createResult.success || !createResult.ticket) throw new Error(createResult.error || 'Failed to create ticket')
  return { ticketId: createResult.ticket.id, created: true }
}
