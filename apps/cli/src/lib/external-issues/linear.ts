import {
  ExternalIssueAdapterError,
  toNormalizedEnvelope,
  type IssueEnvelope,
  type NormalizedIssueEnvelope,
} from './types.js'

const DEFAULT_LINEAR_API_URL = 'https://api.linear.app/graphql'

const LINEAR_ISSUES_QUERY = `
  query IssuesForSpawn($teamKey: String!, $first: Int!) {
    issues(
      first: $first
      filter: {
        team: { key: { eq: $teamKey } }
        state: { type: { nin: ["completed", "canceled"] } }
      }
      orderBy: updatedAt
    ) {
      nodes {
        id
        identifier
        title
        description
        url
        priority
        estimate
        dueDate
        assignee {
          id
          name
          email
        }
        labels {
          nodes {
            name
          }
        }
        state {
          name
          type
        }
        team {
          key
        }
      }
    }
  }
`

const LINEAR_ISSUE_BY_IDENTIFIER_QUERY = `
  query IssueForSpawn($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      priority
      estimate
      dueDate
      assignee {
        id
        name
        email
      }
      labels {
        nodes {
          name
        }
      }
      state {
        name
        type
      }
      team {
        key
      }
    }
  }
`

interface LinearIssueLabel {
  name?: string
}

interface LinearIssueNode {
  id?: string
  identifier?: string
  title?: string
  description?: string | null
  url?: string
  priority?: number | null
  estimate?: number | null
  dueDate?: string | null
  assignee?: {
    id?: string
    name?: string
    email?: string
  } | null
  labels?: {
    nodes?: LinearIssueLabel[]
  }
  state?: {
    name?: string
  }
  team?: {
    key?: string
  }
}

interface LinearGraphQLResponse {
  data?: {
    issues?: {
      nodes?: LinearIssueNode[]
    }
  }
  errors?: Array<{ message?: string }>
}

export interface LinearAdapterConfig {
  apiKey?: string
  team?: string
  apiUrl?: string
}

function priorityFromLinear(value: number | null | undefined): string | null {
  switch (value) {
    case 1:
      return 'P0'
    case 2:
      return 'P1'
    case 3:
      return 'P2'
    case 4:
      return 'P3'
    default:
      return null
  }
}

function ensureLinearConfig(
  config: LinearAdapterConfig,
  options?: { requireTeam?: boolean },
): { apiKey: string; apiUrl: string; team?: string } {
  const apiKey = config.apiKey || process.env.LINEAR_API_KEY || process.env.PRLT_LINEAR_API_KEY
  const team = config.team || process.env.PRLT_LINEAR_TEAM || process.env.LINEAR_TEAM_KEY
  const apiUrl = config.apiUrl || process.env.PRLT_LINEAR_API_URL || DEFAULT_LINEAR_API_URL

  if (!apiKey) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Linear API key. Set LINEAR_API_KEY or PRLT_LINEAR_API_KEY.',
    )
  }

  const requireTeam = options?.requireTeam ?? true
  if (requireTeam && !team) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Linear team key. Pass --team or set PRLT_LINEAR_TEAM.',
    )
  }

  return { apiKey, team, apiUrl }
}

function ensureLinearIssueShape(issue: LinearIssueNode): asserts issue is Required<Pick<LinearIssueNode, 'id' | 'identifier' | 'title' | 'url'>> & LinearIssueNode {
  if (!issue.id || !issue.identifier || !issue.title || !issue.url) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'Linear issue payload is missing required fields (id, identifier, title, url).',
      issue,
    )
  }
}

/**
 * Normalize a raw Linear API issue node into a canonical IssueEnvelope.
 */
export function normalizeLinearIssue(rawIssue: unknown): IssueEnvelope {
  if (!rawIssue || typeof rawIssue !== 'object') {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', 'Linear issue payload is invalid.', rawIssue)
  }

  const issue = rawIssue as LinearIssueNode
  ensureLinearIssueShape(issue)

  const labels = (issue.labels?.nodes || [])
    .map(label => label.name?.trim())
    .filter((name): name is string => Boolean(name))

  const projectKey = issue.team?.key || issue.identifier.split('-')[0]

  return {
    source: 'linear',
    external_id: issue.id,
    external_key: issue.identifier,
    title: issue.title,
    description: issue.description || '',
    labels,
    priority: priorityFromLinear(issue.priority),
    status: issue.state?.name || 'Unknown',
    url: issue.url,
    project_key: projectKey || 'UNKNOWN',
    assignee: issue.assignee?.name || null,
    item_type: 'issue',
    raw: rawIssue as Record<string, unknown>,
  }
}

/**
 * Normalize a raw Linear issue into a PMO-ready NormalizedIssueEnvelope.
 */
export function normalizeLinearIssueToEnvelope(rawIssue: unknown): NormalizedIssueEnvelope {
  const envelope = normalizeLinearIssue(rawIssue)
  return toNormalizedEnvelope(envelope, 'feature')
}

/**
 * Build a PMO ticket description from a NormalizedIssueEnvelope.
 */
export function buildLinearTicketDescription(envelope: NormalizedIssueEnvelope): string {
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
export function buildLinearMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
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
export function buildLinearSpawnContextMessage(
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
 * Build a CLI command string for selecting a specific Linear issue.
 */
export function buildLinearIssueChoiceCommand(issueIdentifier: string, projectId?: string): string {
  let command = `prlt work linear --issue ${issueIdentifier} --json`
  if (projectId) {
    command += ` -P ${projectId}`
  }
  return command
}

/**
 * Fetch a single Linear issue by identifier (for example, ENG-123) and normalize it.
 */
export async function getLinearIssueByIdentifier(
  configInput: LinearAdapterConfig,
  identifier: string,
  options?: {
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope | null> {
  const config = ensureLinearConfig(configInput, { requireTeam: false })
  const fetchImpl = options?.fetchImpl || fetch

  const response = await fetchImpl(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: config.apiKey,
    },
    body: JSON.stringify({
      query: LINEAR_ISSUE_BY_IDENTIFIER_QUERY,
      variables: {
        id: identifier,
      },
    }),
  })

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'Linear authentication failed. Verify your LINEAR_API_KEY token.',
    )
  }

  if (response.status === 429) {
    throw new ExternalIssueAdapterError(
      'RATE_LIMITED',
      'Linear API rate limit exceeded. Wait a moment and try again.',
    )
  }

  if (!response.ok) {
    throw new ExternalIssueAdapterError(
      'REQUEST_FAILED',
      `Linear request failed with status ${response.status}.`,
    )
  }

  const payload = await response.json() as {
    data?: { issue?: LinearIssueNode | null }
    errors?: Array<{ message?: string }>
  }

  if (payload.errors && payload.errors.length > 0) {
    const message = payload.errors[0]?.message || 'Unknown Linear API error.'
    if (/auth|token|forbidden|unauthorized/i.test(message)) {
      throw new ExternalIssueAdapterError('AUTH_FAILED', `Linear authentication failed: ${message}`)
    }
    // "not found" should be treated as null, not hard failure.
    if (/not found/i.test(message)) {
      return null
    }
    if (/rate.?limit|too many requests|throttl/i.test(message)) {
      throw new ExternalIssueAdapterError('RATE_LIMITED', `Linear API rate limit exceeded: ${message}`)
    }
    throw new ExternalIssueAdapterError('REQUEST_FAILED', `Linear API error: ${message}`)
  }

  const node = payload.data?.issue
  if (!node) return null
  return normalizeLinearIssueToEnvelope(node)
}

/**
 * Fetch and normalize Linear issues into NormalizedIssueEnvelopes.
 */
export async function listLinearIssues(
  configInput: LinearAdapterConfig,
  options?: {
    limit?: number
    fetchImpl?: typeof fetch
  },
): Promise<NormalizedIssueEnvelope[]> {
  const config = ensureLinearConfig(configInput)
  const fetchImpl = options?.fetchImpl || fetch
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100))

  const response = await fetchImpl(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: config.apiKey,
    },
    body: JSON.stringify({
      query: LINEAR_ISSUES_QUERY,
      variables: {
        teamKey: config.team,
        first: limit,
      },
    }),
  })

  if (response.status === 401 || response.status === 403) {
    throw new ExternalIssueAdapterError(
      'AUTH_FAILED',
      'Linear authentication failed. Verify your LINEAR_API_KEY token.',
    )
  }

  if (response.status === 429) {
    throw new ExternalIssueAdapterError(
      'RATE_LIMITED',
      'Linear API rate limit exceeded. Wait a moment and try again.',
    )
  }

  if (!response.ok) {
    throw new ExternalIssueAdapterError(
      'REQUEST_FAILED',
      `Linear request failed with status ${response.status}.`,
    )
  }

  const payload = await response.json() as LinearGraphQLResponse

  if (payload.errors && payload.errors.length > 0) {
    const message = payload.errors[0]?.message || 'Unknown Linear API error.'
    if (/auth|token|forbidden|unauthorized/i.test(message)) {
      throw new ExternalIssueAdapterError('AUTH_FAILED', `Linear authentication failed: ${message}`)
    }
    if (/rate.?limit|too many requests|throttl/i.test(message)) {
      throw new ExternalIssueAdapterError('RATE_LIMITED', `Linear API rate limit exceeded: ${message}`)
    }
    throw new ExternalIssueAdapterError('REQUEST_FAILED', `Linear API error: ${message}`)
  }

  const nodes = payload.data?.issues?.nodes
  if (!Array.isArray(nodes)) {
    throw new ExternalIssueAdapterError(
      'BAD_PAYLOAD',
      'Linear response payload was missing issues.nodes.',
      payload,
    )
  }

  return nodes.map(normalizeLinearIssueToEnvelope)
}
