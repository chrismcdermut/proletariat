import {
  ExternalIssueAdapterError,
  toNormalizedEnvelope,
  type IssueEnvelope,
  type NormalizedIssueEnvelope,
} from './types.js'

const DEFAULT_SHORTCUT_API_URL = 'https://api.app.shortcut.com/api/v3'

export interface ShortcutAdapterConfig {
  apiToken?: string
  workspaceSlug?: string
  apiUrl?: string
}

interface ShortcutLabel {
  name?: string
}

interface ShortcutStory {
  id?: number
  name?: string
  description?: string
  app_url?: string
  story_type?: string
  labels?: ShortcutLabel[]
  workflow_state_id?: number
  estimate?: number | null
  deadline?: string | null
  owner_ids?: string[]
  group_id?: string | null
  epic_id?: number | null
  project_id?: number | null
  external_id?: string | null
}

interface ShortcutSearchResponse {
  data?: ShortcutStory[]
  next?: string | null
  total?: number
}

interface _ShortcutMember {
  id?: string
  profile?: {
    name?: string
    email_address?: string
    mention_name?: string
  }
}

interface ShortcutWorkflowState {
  id?: number
  name?: string
  type?: string
}

function ensureShortcutConfig(
  config: ShortcutAdapterConfig,
): { apiToken: string; apiUrl: string; workspaceSlug?: string } {
  const apiToken = config.apiToken || process.env.SHORTCUT_API_TOKEN || process.env.PRLT_SHORTCUT_API_TOKEN
  const workspaceSlug = config.workspaceSlug || process.env.PRLT_SHORTCUT_WORKSPACE || process.env.SHORTCUT_WORKSPACE_SLUG
  const apiUrl = config.apiUrl || process.env.PRLT_SHORTCUT_API_URL || DEFAULT_SHORTCUT_API_URL

  if (!apiToken) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Shortcut API token. Set SHORTCUT_API_TOKEN or PRLT_SHORTCUT_API_TOKEN.',
    )
  }

  return { apiToken, apiUrl, workspaceSlug: workspaceSlug || undefined }
}

function ensureStoryShape(story: ShortcutStory): asserts story is Required<Pick<ShortcutStory, 'id' | 'name' | 'app_url'>> & ShortcutStory {
  if (!story.id || !story.name || !story.app_url) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'Shortcut story payload is missing required fields (id, name, app_url).',
      story,
    )
  }
}

function deriveExternalKey(story: ShortcutStory): string {
  // Shortcut stories have numeric IDs; the key is typically "sc-<id>"
  return `sc-${story.id}`
}

function deriveCategory(storyType: string | undefined): string {
  const normalized = (storyType || '').toLowerCase()
  if (normalized === 'bug') return 'bug'
  if (normalized === 'chore') return 'chore'
  return 'feature'
}

/**
 * Normalize a raw Shortcut API story into a canonical IssueEnvelope.
 */
export function normalizeShortcutStory(
  rawStory: unknown,
  workflowStates?: Map<number, ShortcutWorkflowState>,
): IssueEnvelope {
  if (!rawStory || typeof rawStory !== 'object') {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', 'Shortcut story payload is invalid.', rawStory)
  }

  const story = rawStory as ShortcutStory
  ensureStoryShape(story)

  const labels = (story.labels || [])
    .map(label => label.name?.trim())
    .filter((name): name is string => Boolean(name))

  const stateName = workflowStates?.get(story.workflow_state_id ?? 0)?.name || 'Unknown'
  const externalKey = deriveExternalKey(story)

  // Shortcut doesn't have a built-in priority field;
  // derive from labels if a priority label exists, otherwise null
  let priority: string | null = null
  const priorityLabel = labels.find(l => /^P[0-3]$/i.test(l))
  if (priorityLabel) {
    priority = priorityLabel.toUpperCase()
  }

  return {
    source: 'shortcut',
    external_id: String(story.id),
    external_key: externalKey,
    title: story.name,
    description: story.description || '',
    labels,
    priority,
    status: stateName,
    url: story.app_url,
    project_key: story.group_id ? String(story.group_id) : 'DEFAULT',
    assignee: null, // Resolved separately if needed
    item_type: story.story_type || null,
    raw: rawStory as Record<string, unknown>,
  }
}

/**
 * Normalize a raw Shortcut story into a PMO-ready NormalizedIssueEnvelope.
 */
export function normalizeShortcutStoryToEnvelope(
  rawStory: unknown,
  workflowStates?: Map<number, ShortcutWorkflowState>,
): NormalizedIssueEnvelope {
  const envelope = normalizeShortcutStory(rawStory, workflowStates)
  return toNormalizedEnvelope(envelope, deriveCategory(envelope.item_type ?? undefined))
}

/**
 * Build a PMO ticket description from a NormalizedIssueEnvelope.
 */
export function buildShortcutTicketDescription(envelope: NormalizedIssueEnvelope): string {
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
export function buildShortcutMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
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
export function buildShortcutSpawnContextMessage(
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
 * Build a CLI command string for selecting a specific Shortcut story.
 */
export function buildShortcutStoryChoiceCommand(storyKey: string, projectId?: string): string {
  let command = `prlt work shortcut --issue ${storyKey} --json`
  if (projectId) {
    command += ` -P ${projectId}`
  }
  return command
}

/**
 * Fetch workflow states for the Shortcut workspace.
 * Returns a Map of state_id -> state info.
 */
async function fetchWorkflowStates(
  config: { apiToken: string; apiUrl: string },
  options?: { fetchImpl?: typeof fetch },
): Promise<Map<number, ShortcutWorkflowState>> {
  const fetchImpl = options?.fetchImpl || fetch
  const response = await fetchImpl(`${config.apiUrl}/workflows`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Shortcut-Token': config.apiToken,
    },
  })

  if (!response.ok) {
    return new Map()
  }

  const workflows = await response.json() as Array<{
    states?: ShortcutWorkflowState[]
  }>

  const stateMap = new Map<number, ShortcutWorkflowState>()
  for (const workflow of workflows) {
    for (const state of workflow.states || []) {
      if (state.id !== undefined) {
        stateMap.set(state.id, state)
      }
    }
  }
  return stateMap
}

/**
 * Fetch a single Shortcut story by its numeric ID or sc-<id> key and normalize it.
 */
export async function getShortcutStoryByKey(
  configInput: ShortcutAdapterConfig,
  storyKey: string,
  options?: {
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope | null> {
  const config = ensureShortcutConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch

  // Extract numeric ID from "sc-123" or plain "123"
  const numericId = storyKey.replace(/^sc-/i, '')
  if (!/^\d+$/.test(numericId)) {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', `Invalid Shortcut story key: "${storyKey}". Expected "sc-<number>" or a numeric ID.`)
  }

  const workflowStates = await fetchWorkflowStates(config, { fetchImpl })

  const response = await fetchImpl(`${config.apiUrl}/stories/${numericId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Shortcut-Token': config.apiToken,
    },
  })

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'Shortcut authentication failed. Verify your SHORTCUT_API_TOKEN.',
    )
  }

  if (response.status === 429) {
    throw new ExternalIssueAdapterError(
      'RATE_LIMITED',
      'Shortcut API rate limit exceeded. Wait a moment and try again.',
    )
  }

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new ExternalIssueAdapterError(
      'REQUEST_FAILED',
      `Shortcut request failed with status ${response.status}.`,
    )
  }

  const payload = await response.json()
  return normalizeShortcutStoryToEnvelope(payload, workflowStates)
}

/**
 * Check if Shortcut is configured via environment variables.
 */
export function isShortcutConfiguredFromEnv(config?: ShortcutAdapterConfig): boolean {
  const apiToken = config?.apiToken
    || process.env.PRLT_SHORTCUT_API_TOKEN
    || process.env.SHORTCUT_API_TOKEN

  return Boolean(apiToken)
}

/**
 * Fetch and normalize Shortcut stories into NormalizedIssueEnvelopes.
 */
export async function listShortcutStories(
  configInput: ShortcutAdapterConfig,
  options?: {
    limit?: number
    query?: string
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope[]> {
  const config = ensureShortcutConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100))

  const workflowStates = await fetchWorkflowStates(config, { fetchImpl })

  // Use Shortcut search endpoint
  const searchQuery = options?.query || 'is:story !is:done !is:archived'
  const searchUrl = `${config.apiUrl}/search/stories?query=${encodeURIComponent(searchQuery)}&page_size=${limit}`

  const response = await fetchImpl(searchUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Shortcut-Token': config.apiToken,
    },
  })

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'Shortcut authentication failed. Verify your SHORTCUT_API_TOKEN.',
    )
  }

  if (response.status === 429) {
    throw new ExternalIssueAdapterError(
      'RATE_LIMITED',
      'Shortcut API rate limit exceeded. Wait a moment and try again.',
    )
  }

  if (!response.ok) {
    throw new ExternalIssueAdapterError(
      'REQUEST_FAILED',
      `Shortcut request failed with status ${response.status}.`,
    )
  }

  const payload = await response.json() as ShortcutSearchResponse
  const stories = payload.data

  if (!Array.isArray(stories)) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'Shortcut response payload was missing stories array.',
      payload,
    )
  }

  return stories
    .slice(0, limit)
    .map(story => normalizeShortcutStoryToEnvelope(story, workflowStates))
}

/**
 * Import a Shortcut story into PMO as a linked ticket.
 */
export async function importShortcutStoryToPmo(
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
    return source === 'shortcut'
      && (key === envelope.source.externalKey || id === envelope.source.externalId)
  })

  const description = buildShortcutTicketDescription(envelope)
  const metadata = buildShortcutMetadata(envelope)

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
