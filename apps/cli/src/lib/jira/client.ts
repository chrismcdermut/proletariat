/**
 * Jira API Client
 *
 * REST wrapper for Jira Cloud (API v3) and Server (API v2).
 * Uses Basic auth with email + API token (Cloud) or username + password (Server).
 */

import type {
  JiraIssue,
  JiraTransition,
  JiraStatus,
  JiraProject,
  JiraUser,
} from './types.js'

export interface JiraClientOptions {
  baseUrl: string
  email?: string
  apiToken: string
  /** API version: 3 for Cloud (default), 2 for Server */
  apiVersion?: 2 | 3
}

export class JiraClient {
  private baseUrl: string
  private authHeader: string
  private apiBase: string

  constructor(options: JiraClientOptions) {
    // Normalize base URL — strip trailing slash
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    const version = options.apiVersion ?? 3
    this.apiBase = `${this.baseUrl}/rest/api/${version}`

    // Basic auth: email:token (Cloud) or just token as bearer
    if (options.email) {
      const credentials = Buffer.from(`${options.email}:${options.apiToken}`).toString('base64')
      this.authHeader = `Basic ${credentials}`
    } else {
      // Server may use Bearer token or personal access token
      this.authHeader = `Bearer ${options.apiToken}`
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.apiBase}${path}`
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: this.authHeader,
      },
    }

    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(url, options)

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Jira API ${method} ${path} failed with status ${response.status}: ${text}`)
    }

    // Some endpoints return 204 No Content
    if (response.status === 204) {
      return undefined as T
    }

    return (await response.json()) as T
  }

  /**
   * Verify the credentials and return the authenticated user info.
   */
  async verify(): Promise<{ displayName: string; email?: string; accountId?: string }> {
    const user = await this.request<JiraUser>('GET', '/myself')
    return {
      displayName: user.displayName,
      email: user.emailAddress,
      accountId: user.accountId,
    }
  }

  /**
   * Get an issue by key or ID.
   */
  async getIssue(issueKeyOrId: string): Promise<JiraIssue> {
    return this.request<JiraIssue>(
      'GET',
      `/issue/${issueKeyOrId}?fields=summary,description,status,priority,issuetype,assignee,reporter,labels,project,created,updated,comment`,
    )
  }

  /**
   * Create a new issue.
   */
  async createIssue(input: {
    projectKey: string
    summary: string
    description?: string
    issueType?: string
    priority?: string
    labels?: string[]
    assigneeId?: string
  }): Promise<JiraIssue> {
    const fields: Record<string, unknown> = {
      project: { key: input.projectKey },
      summary: input.summary,
      issuetype: { name: input.issueType || 'Task' },
    }

    if (input.description) {
      fields.description = input.description
    }
    if (input.priority) {
      fields.priority = { name: input.priority }
    }
    if (input.labels && input.labels.length > 0) {
      fields.labels = input.labels
    }
    if (input.assigneeId) {
      fields.assignee = { accountId: input.assigneeId }
    }

    const created = await this.request<{ id: string; key: string; self: string }>(
      'POST',
      '/issue',
      { fields },
    )

    // Fetch the full issue to return consistent data
    return this.getIssue(created.key)
  }

  /**
   * Update an issue's fields.
   */
  async updateIssue(issueKeyOrId: string, input: {
    summary?: string
    description?: string
    priority?: string
    labels?: string[]
  }): Promise<void> {
    const fields: Record<string, unknown> = {}

    if (input.summary !== undefined) fields.summary = input.summary
    if (input.description !== undefined) fields.description = input.description
    if (input.priority !== undefined) fields.priority = { name: input.priority }
    if (input.labels !== undefined) fields.labels = input.labels

    if (Object.keys(fields).length > 0) {
      await this.request<void>('PUT', `/issue/${issueKeyOrId}`, { fields })
    }
  }

  /**
   * Get available transitions for an issue.
   */
  async getTransitions(issueKeyOrId: string): Promise<JiraTransition[]> {
    const data = await this.request<{ transitions: JiraTransition[] }>(
      'GET',
      `/issue/${issueKeyOrId}/transitions`,
    )
    return data.transitions
  }

  /**
   * Transition an issue to a new status.
   * Jira requires using the transition ID, not the status name directly.
   */
  async transitionIssue(issueKeyOrId: string, transitionId: string): Promise<void> {
    await this.request<void>(
      'POST',
      `/issue/${issueKeyOrId}/transitions`,
      { transition: { id: transitionId } },
    )
  }

  /**
   * Delete an issue (moves to trash in Jira Cloud).
   */
  async deleteIssue(issueKeyOrId: string): Promise<void> {
    await this.request<void>('DELETE', `/issue/${issueKeyOrId}`)
  }

  /**
   * Add a comment to an issue.
   */
  async addComment(issueKeyOrId: string, commentBody: string): Promise<void> {
    await this.request<unknown>(
      'POST',
      `/issue/${issueKeyOrId}/comment`,
      { body: commentBody },
    )
  }

  /**
   * Search issues using JQL.
   */
  async searchIssues(jql: string, options?: {
    maxResults?: number
    startAt?: number
    fields?: string[]
  }): Promise<{ issues: JiraIssue[]; total: number }> {
    const body = {
      jql,
      maxResults: options?.maxResults ?? 50,
      startAt: options?.startAt ?? 0,
      fields: options?.fields ?? [
        'summary', 'description', 'status', 'priority',
        'issuetype', 'assignee', 'reporter', 'labels',
        'project', 'created', 'updated',
      ],
    }

    return this.request<{ issues: JiraIssue[]; total: number }>('POST', '/search', body)
  }

  /**
   * List all statuses available in the Jira instance.
   */
  async listStatuses(): Promise<JiraStatus[]> {
    return this.request<JiraStatus[]>('GET', '/status')
  }

  /**
   * List statuses for a specific project.
   */
  async listProjectStatuses(projectKeyOrId: string): Promise<Array<{
    id: string
    name: string
    statuses: JiraStatus[]
  }>> {
    return this.request<Array<{
      id: string
      name: string
      statuses: JiraStatus[]
    }>>('GET', `/project/${projectKeyOrId}/statuses`)
  }

  /**
   * List projects accessible to the authenticated user.
   */
  async listProjects(options?: { maxResults?: number }): Promise<JiraProject[]> {
    const params = new URLSearchParams()
    if (options?.maxResults) {
      params.set('maxResults', String(options.maxResults))
    }
    const qs = params.toString()
    const path = `/project${qs ? `?${qs}` : ''}`

    return this.request<JiraProject[]>('GET', path)
  }

  /**
   * Find a user by email or display name.
   * Uses user search (Cloud) or user picker (Server).
   */
  async findUser(query: string): Promise<JiraUser[]> {
    const params = new URLSearchParams({ query, maxResults: '10' })
    try {
      // Cloud endpoint
      return await this.request<JiraUser[]>('GET', `/user/search?${params}`)
    } catch {
      // Server fallback
      try {
        return await this.request<JiraUser[]>('GET', `/user/picker?${params}`)
      } catch {
        return []
      }
    }
  }

  /**
   * Assign an issue to a user.
   */
  async assignIssue(issueKeyOrId: string, accountId: string): Promise<void> {
    await this.request<void>(
      'PUT',
      `/issue/${issueKeyOrId}/assignee`,
      { accountId },
    )
  }

  /**
   * Get the browse URL for an issue.
   */
  getBrowseUrl(issueKey: string): string {
    return `${this.baseUrl}/browse/${issueKey}`
  }
}
