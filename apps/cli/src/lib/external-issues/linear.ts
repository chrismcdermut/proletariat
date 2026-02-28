import {
  ExternalIssueAdapterError,
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
        labels {
          nodes {
            name
          }
        }
        state {
          name
          type
        }
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
  labels?: {
    nodes?: LinearIssueLabel[]
  }
  state?: {
    name?: string
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

function priorityFromLinear(value: number | null | undefined): string | undefined {
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
      return undefined
  }
}

function ensureLinearConfig(config: LinearAdapterConfig): Required<LinearAdapterConfig> {
  const apiKey = config.apiKey || process.env.LINEAR_API_KEY || process.env.PRLT_LINEAR_API_KEY
  const team = config.team || process.env.PRLT_LINEAR_TEAM || process.env.LINEAR_TEAM_KEY
  const apiUrl = config.apiUrl || process.env.PRLT_LINEAR_API_URL || DEFAULT_LINEAR_API_URL

  if (!apiKey) {
    throw new ExternalIssueAdapterError(
      'MISSING_CONFIG',
      'Missing Linear API key. Set LINEAR_API_KEY or PRLT_LINEAR_API_KEY.',
    )
  }

  if (!team) {
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

export function normalizeLinearIssue(rawIssue: unknown): NormalizedIssueEnvelope {
  if (!rawIssue || typeof rawIssue !== 'object') {
    throw new ExternalIssueAdapterError('BAD_PAYLOAD', 'Linear issue payload is invalid.', rawIssue)
  }

  const issue = rawIssue as LinearIssueNode
  ensureLinearIssueShape(issue)

  const labels = (issue.labels?.nodes || [])
    .map(label => label.name?.trim())
    .filter((name): name is string => Boolean(name))

  return {
    title: issue.title,
    description: issue.description || undefined,
    priority: priorityFromLinear(issue.priority),
    category: labels[0],
    statusName: issue.state?.name,
    labels,
    source: {
      source: 'linear',
      externalKey: issue.identifier,
      externalId: issue.id,
      url: issue.url,
      raw: rawIssue,
    },
  }
}

export function buildLinearTicketDescription(envelope: NormalizedIssueEnvelope): string {
  const body = envelope.description?.trim()
  const metadataLines = [
    `- Source: ${envelope.source.source}`,
    `- External key: ${envelope.source.externalKey}`,
    `- External id: ${envelope.source.externalId}`,
    `- URL: ${envelope.source.url}`,
    `- Status: ${envelope.statusName || 'Unknown'}`,
    `- Priority: ${envelope.priority || 'Unset'}`,
    `- Labels: ${envelope.labels.length > 0 ? envelope.labels.join(', ') : 'None'}`,
  ]

  const parts = [
    body || '',
    '## External Issue Context',
    metadataLines.join('\n'),
  ].filter(Boolean)

  return parts.join('\n\n')
}

export function buildLinearMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
  return {
    external_source: envelope.source.source,
    external_key: envelope.source.externalKey,
    external_id: envelope.source.externalId,
    external_url: envelope.source.url,
    external_raw: JSON.stringify(envelope.source.raw),
  }
}

export function buildLinearSpawnContextMessage(
  envelope: NormalizedIssueEnvelope,
  additionalMessage?: string,
): string {
  const lines = [
    `External issue source: ${envelope.source.source}`,
    `External issue key: ${envelope.source.externalKey}`,
    `External issue id: ${envelope.source.externalId}`,
    `External issue URL: ${envelope.source.url}`,
  ]

  if (additionalMessage?.trim()) {
    lines.push('', additionalMessage.trim())
  }

  return lines.join('\n')
}

export function buildLinearIssueChoiceCommand(issueIdentifier: string, projectId?: string): string {
  let command = `prlt work linear --issue ${issueIdentifier} --json`
  if (projectId) {
    command += ` -P ${projectId}`
  }
  return command
}

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

  return nodes.map(normalizeLinearIssue)
}
