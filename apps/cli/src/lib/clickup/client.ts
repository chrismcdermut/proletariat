import type {
  ClickUpFolder,
  ClickUpList,
  ClickUpSpace,
  ClickUpTask,
  ClickUpTaskCreateInput,
  ClickUpTaskUpdateInput,
  ClickUpUser,
  ClickUpWorkspace,
} from './types.js'

export class ClickUpClient {
  private readonly baseUrl = 'https://api.clickup.com/api/v2'

  constructor(private apiKey: string) {}

  private async request<T>(
    path: string,
    init: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
      query?: Record<string, string | number | boolean | undefined>
      body?: unknown
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    if (init.query) {
      for (const [key, value] of Object.entries(init.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available in supported Node runtimes for this CLI
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })

    if (response.status === 401 || response.status === 403) {
      throw new Error('ClickUp authentication failed. Check your API key.')
    }

    if (!response.ok) {
      let errorMessage = `ClickUp API request failed (${response.status})`
      try {
        const payload = await response.json() as { err?: string; ECODE?: string }
        if (payload.err) {
          errorMessage = payload.err
        }
      } catch {
        // Use default error message
      }
      throw new Error(errorMessage)
    }

    return await response.json() as T
  }

  async verify(): Promise<ClickUpUser> {
    const user = await this.request<{ user: ClickUpUser }>('/user')
    return user.user
  }

  async listWorkspaces(): Promise<ClickUpWorkspace[]> {
    const result = await this.request<{ teams: Array<{ id: string; name: string }> }>('/team')
    return result.teams.map((team) => ({
      id: team.id,
      name: team.name,
    }))
  }

  async listSpaces(workspaceId: string): Promise<ClickUpSpace[]> {
    const result = await this.request<{ spaces: ClickUpSpace[] }>(
      `/team/${workspaceId}/space`,
    )
    return result.spaces
  }

  async getSpace(spaceId: string): Promise<ClickUpSpace | null> {
    try {
      return await this.request<ClickUpSpace>(`/space/${spaceId}`)
    } catch {
      return null
    }
  }

  async listFolders(spaceId: string): Promise<ClickUpFolder[]> {
    const result = await this.request<{ folders: ClickUpFolder[] }>(
      `/space/${spaceId}/folder`,
    )
    return result.folders
  }

  async listFolderlessLists(spaceId: string): Promise<ClickUpList[]> {
    const result = await this.request<{ lists: ClickUpList[] }>(
      `/space/${spaceId}/list`,
    )
    return result.lists
  }

  async listFolderLists(folderId: string): Promise<ClickUpList[]> {
    const result = await this.request<{ lists: ClickUpList[] }>(
      `/folder/${folderId}/list`,
    )
    return result.lists
  }

  async getList(listId: string): Promise<ClickUpList | null> {
    try {
      return await this.request<ClickUpList>(`/list/${listId}`)
    } catch {
      return null
    }
  }

  async listTasks(
    listId: string,
    options?: { page?: number; subtasks?: boolean; statuses?: string[] },
  ): Promise<ClickUpTask[]> {
    const query: Record<string, string | number | boolean | undefined> = {
      page: options?.page ?? 0,
      subtasks: options?.subtasks ?? false,
    }

    if (options?.statuses) {
      // ClickUp API expects statuses[] query params
      // We'll handle this through manual URL building
    }

    const result = await this.request<{ tasks: ClickUpTask[] }>(
      `/list/${listId}/task`,
      { query },
    )
    return result.tasks
  }

  async getTask(taskId: string): Promise<ClickUpTask | null> {
    try {
      return await this.request<ClickUpTask>(`/task/${taskId}`)
    } catch {
      return null
    }
  }

  async createTask(listId: string, input: ClickUpTaskCreateInput): Promise<ClickUpTask> {
    return await this.request<ClickUpTask>(`/list/${listId}/task`, {
      method: 'POST',
      body: input,
    })
  }

  async updateTask(taskId: string, input: ClickUpTaskUpdateInput): Promise<ClickUpTask> {
    return await this.request<ClickUpTask>(`/task/${taskId}`, {
      method: 'PUT',
      body: input,
    })
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request(`/task/${taskId}`, { method: 'DELETE' })
  }

  async addComment(taskId: string, commentText: string): Promise<void> {
    await this.request(`/task/${taskId}/comment`, {
      method: 'POST',
      body: { comment_text: commentText },
    })
  }
}
