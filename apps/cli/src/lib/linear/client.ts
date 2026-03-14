/**
 * Linear API Client
 *
 * Thin wrapper using direct GraphQL queries for Linear API access.
 * Provides typed access to issues, teams, states, and cycles for the PMO integration.
 */

import type {
  LinearIssue,
  LinearTeam,
  LinearWorkflowState,
  LinearCycle,
  LinearIssueFilter,
} from './types.js'

const LINEAR_API_URL = 'https://api.linear.app/graphql'

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

export class LinearClient {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private async query<T>(gql: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query: gql, variables }),
    })

    if (!response.ok) {
      throw new Error(`Linear API request failed with status ${response.status}`)
    }

    const result = (await response.json()) as GraphQLResponse<T>

    if (result.errors && result.errors.length > 0) {
      throw new Error(`Linear API error: ${result.errors[0].message}`)
    }

    if (!result.data) {
      throw new Error('Linear API returned no data')
    }

    return result.data
  }

  /**
   * Verify the API key is valid and return the authenticated user's organization.
   */
  async verify(): Promise<{ organizationName: string; userName: string; email: string }> {
    const data = await this.query<{
      viewer: { name: string; email: string }
      organization: { name: string }
    }>(`
      query {
        viewer { name email }
        organization { name }
      }
    `)

    return {
      organizationName: data.organization.name,
      userName: data.viewer.name,
      email: data.viewer.email,
    }
  }

  /**
   * List all teams in the workspace.
   */
  async listTeams(): Promise<LinearTeam[]> {
    const data = await this.query<{
      teams: { nodes: Array<{ id: string; key: string; name: string; description: string | null }> }
    }>(`
      query {
        teams {
          nodes { id key name description }
        }
      }
    `)

    return data.teams.nodes.map((t) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      description: t.description ?? undefined,
    }))
  }

  /**
   * Get a team by its key (e.g., "ENG").
   */
  async getTeamByKey(key: string): Promise<LinearTeam | null> {
    const teams = await this.listTeams()
    return teams.find((t) => t.key.toLowerCase() === key.toLowerCase()) ?? null
  }

  /**
   * List workflow states for a team.
   */
  async listStates(teamId: string): Promise<LinearWorkflowState[]> {
    const data = await this.query<{
      team: { states: { nodes: Array<{ id: string; name: string; type: string; color: string; position: number }> } }
    }>(`
      query TeamStates($teamId: String!) {
        team(id: $teamId) {
          states {
            nodes { id name type color position }
          }
        }
      }
    `, { teamId })

    return data.team.states.nodes.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      color: s.color,
      position: s.position,
    }))
  }

  /**
   * List cycles for a team.
   */
  async listCycles(teamId: string): Promise<LinearCycle[]> {
    const data = await this.query<{
      team: { cycles: { nodes: Array<{ id: string; name: string | null; number: number; startsAt: string | null; endsAt: string | null }> } }
    }>(`
      query TeamCycles($teamId: String!) {
        team(id: $teamId) {
          cycles {
            nodes { id name number startsAt endsAt }
          }
        }
      }
    `, { teamId })

    return data.team.cycles.nodes.map((c) => ({
      id: c.id,
      name: c.name ?? `Cycle ${c.number}`,
      number: c.number,
      startsAt: c.startsAt ?? '',
      endsAt: c.endsAt ?? '',
    }))
  }

  /**
   * Fetch issues from Linear with optional filters.
   */
  async listIssues(filter: LinearIssueFilter = {}): Promise<LinearIssue[]> {
    const queryFilter: Record<string, unknown> = {}

    if (filter.teamId) {
      queryFilter.team = { id: { eq: filter.teamId } }
    } else if (filter.teamKey) {
      queryFilter.team = { key: { eq: filter.teamKey } }
    }

    if (filter.stateType) {
      queryFilter.state = { type: { eq: filter.stateType } }
    } else if (filter.stateName) {
      queryFilter.state = { name: { eqIgnoreCase: filter.stateName } }
    }

    if (filter.assigneeMe) {
      // Fetch viewer ID first
      const viewerData = await this.query<{ viewer: { id: string } }>(`
        query { viewer { id } }
      `)
      queryFilter.assignee = { id: { eq: viewerData.viewer.id } }
    } else if (filter.assigneeId) {
      queryFilter.assignee = { id: { eq: filter.assigneeId } }
    }

    if (filter.labelName) {
      queryFilter.labels = { name: { eqIgnoreCase: filter.labelName } }
    }

    if (filter.cycleId) {
      queryFilter.cycle = { id: { eq: filter.cycleId } }
    }

    if (filter.projectId) {
      queryFilter.project = { id: { eq: filter.projectId } }
    }

    const data = await this.query<{
      issues: {
        nodes: Array<{
          id: string
          identifier: string
          title: string
          description: string | null
          priority: number
          estimate: number | null
          dueDate: string | null
          url: string
          createdAt: string
          updatedAt: string
          state: { id: string; name: string; type: string } | null
          team: { id: string; key: string; name: string } | null
          assignee: { id: string; name: string; email: string } | null
          labels: { nodes: Array<{ id: string; name: string; color: string }> }
          cycle: { id: string; name: string | null; number: number } | null
          project: { id: string; name: string } | null
        }>
      }
    }>(`
      query Issues($filter: IssueFilter, $first: Int!) {
        issues(filter: $filter, first: $first) {
          nodes {
            id identifier title description priority estimate dueDate url createdAt updatedAt
            state { id name type }
            team { id key name }
            assignee { id name email }
            labels { nodes { id name color } }
            cycle { id name number }
            project { id name }
          }
        }
      }
    `, { filter: queryFilter, first: filter.limit ?? 50 })

    return data.issues.nodes.map((issue) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? undefined,
      priority: issue.priority,
      state: issue.state ? {
        id: issue.state.id,
        name: issue.state.name,
        type: issue.state.type,
      } : { id: '', name: 'Unknown', type: 'backlog' },
      team: issue.team ? {
        id: issue.team.id,
        key: issue.team.key,
        name: issue.team.name,
      } : { id: '', key: '', name: 'Unknown' },
      assignee: issue.assignee ? {
        id: issue.assignee.id,
        name: issue.assignee.name,
        email: issue.assignee.email,
      } : undefined,
      labels: issue.labels.nodes.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
      })),
      cycle: issue.cycle ? {
        id: issue.cycle.id,
        name: issue.cycle.name ?? `Cycle ${issue.cycle.number}`,
        number: issue.cycle.number,
      } : undefined,
      project: issue.project ? {
        id: issue.project.id,
        name: issue.project.name,
      } : undefined,
      estimate: issue.estimate ?? undefined,
      dueDate: issue.dueDate ?? undefined,
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    }))
  }

  /**
   * Fetch a single issue by its identifier (e.g., "ENG-123").
   */
  async getIssueByIdentifier(identifier: string): Promise<LinearIssue | null> {
    const match = identifier.match(/^([A-Z]+)-(\d+)$/i)
    if (!match) return null

    const [, teamKey, numberStr] = match

    const data = await this.query<{
      issues: {
        nodes: Array<{
          id: string
          identifier: string
          title: string
          description: string | null
          priority: number
          estimate: number | null
          dueDate: string | null
          url: string
          createdAt: string
          updatedAt: string
          state: { id: string; name: string; type: string } | null
          team: { id: string; key: string; name: string } | null
          assignee: { id: string; name: string; email: string } | null
          labels: { nodes: Array<{ id: string; name: string; color: string }> }
          cycle: { id: string; name: string | null; number: number } | null
          project: { id: string; name: string } | null
        }>
      }
    }>(`
      query IssueByIdentifier($filter: IssueFilter!) {
        issues(filter: $filter, first: 1) {
          nodes {
            id identifier title description priority estimate dueDate url createdAt updatedAt
            state { id name type }
            team { id key name }
            assignee { id name email }
            labels { nodes { id name color } }
            cycle { id name number }
            project { id name }
          }
        }
      }
    `, {
      filter: {
        team: { key: { eq: teamKey.toUpperCase() } },
        number: { eq: parseInt(numberStr, 10) },
      },
    })

    if (data.issues.nodes.length === 0) return null

    const issue = data.issues.nodes[0]
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? undefined,
      priority: issue.priority,
      state: issue.state ? {
        id: issue.state.id,
        name: issue.state.name,
        type: issue.state.type,
      } : { id: '', name: 'Unknown', type: 'backlog' },
      team: issue.team ? {
        id: issue.team.id,
        key: issue.team.key,
        name: issue.team.name,
      } : { id: '', key: '', name: 'Unknown' },
      assignee: issue.assignee ? {
        id: issue.assignee.id,
        name: issue.assignee.name,
        email: issue.assignee.email,
      } : undefined,
      labels: issue.labels.nodes.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
      })),
      cycle: issue.cycle ? {
        id: issue.cycle.id,
        name: issue.cycle.name ?? `Cycle ${issue.cycle.number}`,
        number: issue.cycle.number,
      } : undefined,
      project: issue.project ? {
        id: issue.project.id,
        name: issue.project.name,
      } : undefined,
      estimate: issue.estimate ?? undefined,
      dueDate: issue.dueDate ?? undefined,
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    }
  }

  /**
   * Update the state of an issue.
   */
  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    await this.query<{ issueUpdate: { success: boolean } }>(`
      mutation UpdateIssueState($issueId: String!, $stateId: String!) {
        issueUpdate(id: $issueId, input: { stateId: $stateId }) {
          success
        }
      }
    `, { issueId, stateId })
  }

  /**
   * Add a comment to an issue.
   */
  async addComment(issueId: string, body: string): Promise<void> {
    await this.query<{ commentCreate: { success: boolean } }>(`
      mutation CreateComment($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
        }
      }
    `, { issueId, body })
  }

  /**
   * Attach a URL to an issue (e.g., a PR link).
   */
  async attachUrl(issueId: string, url: string, title: string): Promise<void> {
    await this.query<{ attachmentCreate: { success: boolean } }>(`
      mutation CreateAttachment($issueId: String!, $url: String!, $title: String!) {
        attachmentCreate(input: { issueId: $issueId, url: $url, title: $title }) {
          success
        }
      }
    `, { issueId, url, title })
  }

  /**
   * Create a new issue in Linear.
   */
  async createIssue(input: {
    teamId: string
    title: string
    description?: string
    priority?: number
    stateId?: string
  }): Promise<LinearIssue> {
    const data = await this.query<{
      issueCreate: {
        success: boolean
        issue: {
          id: string
          identifier: string
          title: string
          description: string | null
          priority: number
          url: string
          createdAt: string
          updatedAt: string
          state: { id: string; name: string; type: string } | null
          team: { id: string; key: string; name: string } | null
          assignee: { id: string; name: string; email: string } | null
          labels: { nodes: Array<{ id: string; name: string; color: string }> }
        }
      }
    }>(`
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id identifier title description priority url createdAt updatedAt
            state { id name type }
            team { id key name }
            assignee { id name email }
            labels { nodes { id name color } }
          }
        }
      }
    `, { input })

    const issue = data.issueCreate.issue
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? undefined,
      priority: issue.priority,
      state: issue.state ? {
        id: issue.state.id,
        name: issue.state.name,
        type: issue.state.type,
      } : { id: '', name: 'Unknown', type: 'backlog' },
      team: issue.team ? {
        id: issue.team.id,
        key: issue.team.key,
        name: issue.team.name,
      } : { id: '', key: '', name: 'Unknown' },
      assignee: issue.assignee ? {
        id: issue.assignee.id,
        name: issue.assignee.name,
        email: issue.assignee.email,
      } : undefined,
      labels: issue.labels.nodes.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
      })),
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    }
  }
}
