/**
 * ClickUp API Client
 *
 * REST wrapper for ClickUp API v2 access.
 * Provides typed access to tasks, lists, spaces, and statuses for the PMO integration.
 */

import type { ClickUpTask, ClickUpSpace, ClickUpList, ClickUpStatus } from './types.js'

const CLICKUP_API_URL = 'https://api.clickup.com/api/v2'

export class ClickUpClient {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${CLICKUP_API_URL}${path}`
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey,
      },
    }

    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(url, options)

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`ClickUp API ${method} ${path} failed with status ${response.status}: ${text}`)
    }

    return (await response.json()) as T
  }

  /**
   * Verify the API key is valid and return the authenticated user info.
   */
  async verify(): Promise<{ userName: string; email: string }> {
    const data = await this.request<{
      user: { id: number; username: string; email: string }
    }>('GET', '/user')

    return {
      userName: data.user.username,
      email: data.user.email,
    }
  }

  /**
   * List teams (workspaces) accessible to the authenticated user.
   */
  async listTeams(): Promise<Array<{ id: string; name: string }>> {
    const data = await this.request<{
      teams: Array<{ id: string; name: string }>
    }>('GET', '/team')

    return data.teams
  }

  /**
   * Get a task by ID.
   */
  async getTask(taskId: string): Promise<ClickUpTask> {
    return this.request<ClickUpTask>('GET', `/task/${taskId}?include_subtasks=true`)
  }

  /**
   * Update a task's status.
   */
  async updateTaskStatus(taskId: string, status: string): Promise<void> {
    await this.request<ClickUpTask>('PUT', `/task/${taskId}`, { status })
  }

  /**
   * Update a task's fields (name, description, priority, assignees).
   */
  async updateTask(taskId: string, input: {
    name?: string
    description?: string
    priority?: number | null
    status?: string
  }): Promise<ClickUpTask> {
    return this.request<ClickUpTask>('PUT', `/task/${taskId}`, input)
  }

  /**
   * Add a comment to a task.
   */
  async addComment(taskId: string, commentText: string): Promise<void> {
    await this.request<unknown>('POST', `/task/${taskId}/comment`, {
      comment_text: commentText,
    })
  }

  /**
   * Create a new task in a list.
   */
  async createTask(listId: string, input: {
    name: string
    description?: string
    priority?: number | null
    status?: string
    tags?: string[]
  }): Promise<ClickUpTask> {
    return this.request<ClickUpTask>('POST', `/list/${listId}/task`, input)
  }

  /**
   * List tasks in a list with optional filters.
   */
  async listTasks(listId: string, options?: {
    statuses?: string[]
    assignees?: string[]
    page?: number
  }): Promise<ClickUpTask[]> {
    const params = new URLSearchParams()
    if (options?.statuses) {
      for (const s of options.statuses) {
        params.append('statuses[]', s)
      }
    }
    if (options?.assignees) {
      for (const a of options.assignees) {
        params.append('assignees[]', a)
      }
    }
    if (options?.page !== undefined) {
      params.set('page', String(options.page))
    }
    const qs = params.toString()
    const path = `/list/${listId}/task${qs ? `?${qs}` : ''}`

    const data = await this.request<{ tasks: ClickUpTask[] }>('GET', path)
    return data.tasks
  }

  /**
   * Get statuses for a list.
   */
  async getListStatuses(listId: string): Promise<ClickUpStatus[]> {
    const data = await this.request<ClickUpList>('GET', `/list/${listId}`)
    return data.statuses
  }

  /**
   * Get a list by ID.
   */
  async getList(listId: string): Promise<ClickUpList> {
    return this.request<ClickUpList>('GET', `/list/${listId}`)
  }

  /**
   * Get spaces for a team/workspace.
   */
  async listSpaces(teamId: string): Promise<ClickUpSpace[]> {
    const data = await this.request<{ spaces: ClickUpSpace[] }>(
      'GET', `/team/${teamId}/space?archived=false`,
    )
    return data.spaces
  }

  /**
   * Delete (trash) a task.
   */
  async deleteTask(taskId: string): Promise<void> {
    await this.request<unknown>('DELETE', `/task/${taskId}`)
  }

  /**
   * Assign a user to a task by adding them to the assignees list.
   */
  async addAssignee(taskId: string, assigneeId: number): Promise<void> {
    // ClickUp uses a separate endpoint for managing assignees
    await this.request<unknown>('POST', `/task/${taskId}`, {
      assignees: { add: [assigneeId] },
    })
  }

  /**
   * Find a workspace member by email.
   */
  async findMemberByEmail(teamId: string, email: string): Promise<{ id: number; username: string } | null> {
    // ClickUp doesn't have a direct user-by-email endpoint.
    // We list team members and filter.
    const data = await this.request<{
      members: Array<{ user: { id: number; username: string; email: string } }>
    }>('GET', `/team/${teamId}`)

    const member = data.members?.find(
      (m) => m.user.email.toLowerCase() === email.toLowerCase(),
    )
    return member ? { id: member.user.id, username: member.user.username } : null
  }
}
