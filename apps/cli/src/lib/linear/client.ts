/**
 * Linear API Client
 *
 * Thin wrapper around @linear/sdk providing typed access to
 * Linear issues, teams, states, and cycles for the PMO integration.
 */

import { LinearClient as SDKClient } from '@linear/sdk'
import type {
  LinearIssue,
  LinearTeam,
  LinearWorkflowState,
  LinearCycle,
  LinearIssueFilter,
} from './types.js'

export class LinearClient {
  private sdk: SDKClient

  constructor(apiKey: string) {
    this.sdk = new SDKClient({ apiKey })
  }

  /**
   * Verify the API key is valid and return the authenticated user's organization.
   */
  async verify(): Promise<{ organizationName: string; userName: string; email: string }> {
    const viewer = await this.sdk.viewer
    const org = await this.sdk.organization

    return {
      organizationName: org.name,
      userName: viewer.name,
      email: viewer.email,
    }
  }

  /**
   * List all teams in the workspace.
   */
  async listTeams(): Promise<LinearTeam[]> {
    const teams = await this.sdk.teams()
    return teams.nodes.map((t) => ({
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
    const team = await this.sdk.team(teamId)
    const states = await team.states()
    return states.nodes.map((s) => ({
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
    const team = await this.sdk.team(teamId)
    const cycles = await team.cycles()
    return cycles.nodes.map((c) => ({
      id: c.id,
      name: c.name ?? `Cycle ${c.number}`,
      number: c.number,
      startsAt: c.startsAt?.toISOString() ?? '',
      endsAt: c.endsAt?.toISOString() ?? '',
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

    if (filter.assigneeId) {
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

    const issues = await this.sdk.issues({
      filter: queryFilter,
      first: filter.limit ?? 50,
    })

    const results: LinearIssue[] = []

    for (const issue of issues.nodes) {
      // eslint-disable-next-line no-await-in-loop
      const state = await issue.state
      // eslint-disable-next-line no-await-in-loop
      const team = await issue.team
      // eslint-disable-next-line no-await-in-loop
      const assignee = await issue.assignee
      // eslint-disable-next-line no-await-in-loop
      const labelsConn = await issue.labels()
      // eslint-disable-next-line no-await-in-loop
      const cycle = await issue.cycle
      // eslint-disable-next-line no-await-in-loop
      const project = await issue.project

      results.push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? undefined,
        priority: issue.priority,
        state: state ? {
          id: state.id,
          name: state.name,
          type: state.type,
        } : { id: '', name: 'Unknown', type: 'backlog' },
        team: team ? {
          id: team.id,
          key: team.key,
          name: team.name,
        } : { id: '', key: '', name: 'Unknown' },
        assignee: assignee ? {
          id: assignee.id,
          name: assignee.name,
          email: assignee.email,
        } : undefined,
        labels: labelsConn.nodes.map((l) => ({
          id: l.id,
          name: l.name,
          color: l.color,
        })),
        cycle: cycle ? {
          id: cycle.id,
          name: cycle.name ?? `Cycle ${cycle.number}`,
          number: cycle.number,
        } : undefined,
        project: project ? {
          id: project.id,
          name: project.name,
        } : undefined,
        estimate: issue.estimate ?? undefined,
        url: issue.url,
        createdAt: issue.createdAt.toISOString(),
        updatedAt: issue.updatedAt.toISOString(),
      })
    }

    return results
  }

  /**
   * Fetch a single issue by its identifier (e.g., "ENG-123").
   */
  async getIssueByIdentifier(identifier: string): Promise<LinearIssue | null> {
    // Parse team key from identifier
    const match = identifier.match(/^([A-Z]+)-(\d+)$/i)
    if (!match) return null

    const [, teamKey, numberStr] = match
    const issues = await this.sdk.issues({
      filter: {
        team: { key: { eq: teamKey.toUpperCase() } },
        number: { eq: parseInt(numberStr, 10) },
      },
      first: 1,
    })

    if (issues.nodes.length === 0) return null

    const issue = issues.nodes[0]
    const state = await issue.state
    const team = await issue.team
    const assignee = await issue.assignee
    const labelsConn = await issue.labels()
    const cycle = await issue.cycle
    const project = await issue.project

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? undefined,
      priority: issue.priority,
      state: state ? {
        id: state.id,
        name: state.name,
        type: state.type,
      } : { id: '', name: 'Unknown', type: 'backlog' },
      team: team ? {
        id: team.id,
        key: team.key,
        name: team.name,
      } : { id: '', key: '', name: 'Unknown' },
      assignee: assignee ? {
        id: assignee.id,
        name: assignee.name,
        email: assignee.email,
      } : undefined,
      labels: labelsConn.nodes.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
      })),
      cycle: cycle ? {
        id: cycle.id,
        name: cycle.name ?? `Cycle ${cycle.number}`,
        number: cycle.number,
      } : undefined,
      project: project ? {
        id: project.id,
        name: project.name,
      } : undefined,
      estimate: issue.estimate ?? undefined,
      url: issue.url,
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
    }
  }

  /**
   * Update the state of an issue.
   */
  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    await this.sdk.updateIssue(issueId, { stateId })
  }

  /**
   * Add a comment to an issue.
   */
  async addComment(issueId: string, body: string): Promise<void> {
    await this.sdk.createComment({ issueId, body })
  }

  /**
   * Attach a URL to an issue (e.g., a PR link).
   */
  async attachUrl(issueId: string, url: string, title: string): Promise<void> {
    await this.sdk.createAttachment({
      issueId,
      url,
      title,
    })
  }
}
