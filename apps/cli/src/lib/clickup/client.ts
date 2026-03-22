/**
 * ClickUp API Client
 *
 * Thin wrapper for ClickUp REST API v2 access.
 * Provides typed access to workspaces, spaces, lists, and tasks.
 */

import type {
  ClickUpTask,
  ClickUpWorkspace,
  ClickUpSpace,
  ClickUpList,
  ClickUpFolder,
  ClickUpStatus,
} from './types.js'

const CLICKUP_API_URL = 'https://api.clickup.com/api/v2'

export class ClickUpClient {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private async request<T>(
    path: string,
    init: {
      method?: 'GET' | 'POST' | 'PUT'
      body?: unknown
      query?: Record<string, string | number | boolean | undefined>
    } = {},
  ): Promise<T> {
    const url = new URL(`${CLICKUP_API_URL}${path}`)

    if (init.query) {
      for (const [key, value] of Object.entries(init.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })

    if (response.status === 401) {
      throw new Error('ClickUp authentication failed. Verify your API key.')
    }

    if (response.status === 429) {
      throw new Error('ClickUp API rate limit exceeded. Wait a moment and try again.')
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`ClickUp API request failed (${response.status}): ${text}`)
    }

    return response.json() as Promise<T>
  }

  /**
   * Verify the API key is valid by fetching the authenticated user's workspaces.
   */
  async verify(): Promise<{ userName: string; workspaces: ClickUpWorkspace[] }> {
    const data = await this.request<{ user: { id: number; username: string; email: string } }>(
      '/user',
    )
    const teamsData = await this.request<{ teams: ClickUpWorkspace[] }>('/team')

    return {
      userName: data.user.username,
      workspaces: teamsData.teams,
    }
  }

  /**
   * List all workspaces (teams) the authenticated user belongs to.
   */
  async listWorkspaces(): Promise<ClickUpWorkspace[]> {
    const data = await this.request<{ teams: ClickUpWorkspace[] }>('/team')
    return data.teams
  }

  /**
   * List all spaces in a workspace.
   */
  async listSpaces(workspaceId: string): Promise<ClickUpSpace[]> {
    const data = await this.request<{ spaces: ClickUpSpace[] }>(
      `/team/${workspaceId}/space`,
    )
    return data.spaces
  }

  /**
   * List all folders in a space.
   */
  async listFolders(spaceId: string): Promise<ClickUpFolder[]> {
    const data = await this.request<{ folders: ClickUpFolder[] }>(
      `/space/${spaceId}/folder`,
    )
    return data.folders
  }

  /**
   * List all lists in a space (folderless lists).
   */
  async listFolderlessLists(spaceId: string): Promise<ClickUpList[]> {
    const data = await this.request<{ lists: ClickUpList[] }>(
      `/space/${spaceId}/list`,
    )
    return data.lists
  }

  /**
   * List all lists in a folder.
   */
  async listFolderLists(folderId: string): Promise<ClickUpList[]> {
    const data = await this.request<{ lists: ClickUpList[] }>(
      `/folder/${folderId}/list`,
    )
    return data.lists
  }

  /**
   * List tasks in a list.
   */
  async listTasks(
    listId: string,
    options?: { page?: number; subtasks?: boolean; statuses?: string[] },
  ): Promise<ClickUpTask[]> {
    const query: Record<string, string | number | boolean | undefined> = {
      page: options?.page ?? 0,
      subtasks: options?.subtasks ?? false,
    }

    if (options?.statuses && options.statuses.length > 0) {
      // ClickUp expects statuses as separate query params: statuses[]=open&statuses[]=in%20progress
      // We'll handle this via the URL directly
    }

    const data = await this.request<{ tasks: ClickUpTask[] }>(
      `/list/${listId}/task`,
      { query },
    )
    return data.tasks
  }

  /**
   * Get a single task by ID.
   */
  async getTask(taskId: string): Promise<ClickUpTask> {
    return this.request<ClickUpTask>(`/task/${taskId}`)
  }

  /**
   * Create a task in a list.
   */
  async createTask(
    listId: string,
    input: {
      name: string
      description?: string
      priority?: number
      status?: string
      assignees?: number[]
      tags?: string[]
      due_date?: number
    },
  ): Promise<ClickUpTask> {
    return this.request<ClickUpTask>(`/list/${listId}/task`, {
      method: 'POST',
      body: input,
    })
  }

  /**
   * Update a task.
   */
  async updateTask(
    taskId: string,
    input: {
      name?: string
      description?: string
      priority?: number
      status?: string
      assignees?: { add?: number[]; rem?: number[] }
      due_date?: number
    },
  ): Promise<ClickUpTask> {
    return this.request<ClickUpTask>(`/task/${taskId}`, {
      method: 'PUT',
      body: input,
    })
  }

  /**
   * Add a comment to a task.
   */
  async addComment(taskId: string, commentText: string): Promise<void> {
    await this.request<{ id: string }>(`/task/${taskId}/comment`, {
      method: 'POST',
      body: { comment_text: commentText },
    })
  }

  /**
   * Get statuses for a list.
   */
  async getListStatuses(listId: string): Promise<ClickUpStatus[]> {
    const data = await this.request<{
      id: string
      name: string
      statuses: ClickUpStatus[]
    }>(`/list/${listId}`)
    return data.statuses
  }
}
