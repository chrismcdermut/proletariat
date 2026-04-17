import type {
  AsanaProject,
  AsanaSection,
  AsanaTask,
  AsanaTaskUpsertInput,
  AsanaUser,
  AsanaWorkspace,
} from './types.js'

interface AsanaResponse<T> {
  data: T
  errors?: Array<{ message: string }>
}

export class AsanaClient {
  private readonly baseUrl = 'https://app.asana.com/api/1.0'

  constructor(private accessToken: string) {}

  private async request<T>(
    path: string,
    init: {
      method?: 'GET' | 'POST' | 'PUT'
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

     
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })

    const payload = await response.json() as AsanaResponse<T>

    if (!response.ok) {
      const errorMessage = payload?.errors?.[0]?.message ?? `Asana API request failed (${response.status})`
      throw new Error(errorMessage)
    }

    return payload.data
  }

  async verify(): Promise<AsanaUser> {
    const user = await this.request<{
      gid: string
      name: string
      email?: string
      workspaces?: Array<{ gid: string; name: string }>
    }>('/users/me', {
      query: { opt_fields: 'gid,name,email,workspaces.gid,workspaces.name' },
    })

    return {
      gid: user.gid,
      name: user.name,
      email: user.email,
      workspaces: (user.workspaces ?? []).map((workspace) => ({
        gid: workspace.gid,
        name: workspace.name,
      })),
    }
  }

  async listWorkspaces(): Promise<AsanaWorkspace[]> {
    const user = await this.verify()
    return user.workspaces
  }

  async getWorkspace(workspaceGid: string): Promise<AsanaWorkspace | null> {
    try {
      const workspace = await this.request<{ gid: string; name: string }>(`/workspaces/${workspaceGid}`)
      return { gid: workspace.gid, name: workspace.name }
    } catch {
      return null
    }
  }

  async listProjects(workspaceGid: string): Promise<AsanaProject[]> {
    const projects = await this.request<Array<{ gid: string; name: string }>>('/projects', {
      query: {
        workspace: workspaceGid,
        archived: false,
        opt_fields: 'gid,name',
      },
    })

    return projects.map((project) => ({ gid: project.gid, name: project.name }))
  }

  async getProject(projectGid: string): Promise<AsanaProject | null> {
    try {
      const project = await this.request<{ gid: string; name: string }>(`/projects/${projectGid}`, {
        query: { opt_fields: 'gid,name' },
      })
      return { gid: project.gid, name: project.name }
    } catch {
      return null
    }
  }

  private static readonly RICH_TASK_FIELDS = 'gid,name,completed,notes,assignee.gid,assignee.name,tags.gid,tags.name,memberships.project.gid,memberships.project.name,memberships.section.gid,memberships.section.name,due_on,permalink_url'

  async getTask(taskGid: string): Promise<AsanaTask | null> {
    try {
      const task = await this.request<AsanaTask>(`/tasks/${taskGid}`, {
        query: { opt_fields: AsanaClient.RICH_TASK_FIELDS },
      })
      return task
    } catch {
      return null
    }
  }

  async listTasks(projectGid: string, options?: { limit?: number; completedSince?: string }): Promise<AsanaTask[]> {
    const limit = Math.max(1, Math.min(options?.limit ?? 50, 100))
    const tasks = await this.request<AsanaTask[]>(`/projects/${projectGid}/tasks`, {
      query: {
        opt_fields: AsanaClient.RICH_TASK_FIELDS,
        limit,
        completed_since: options?.completedSince ?? 'now',
      },
    })
    return tasks
  }

  async searchTasks(workspaceGid: string, query: string, options?: { limit?: number }): Promise<AsanaTask[]> {
    const limit = Math.max(1, Math.min(options?.limit ?? 20, 100))
    const tasks = await this.request<AsanaTask[]>(`/workspaces/${workspaceGid}/tasks/search`, {
      query: {
        'text': query,
        'opt_fields': AsanaClient.RICH_TASK_FIELDS,
        'limit': limit,
        'is_subtask': false,
      },
    })
    return tasks
  }

  async createTask(input: AsanaTaskUpsertInput): Promise<AsanaTask> {
    const task = await this.request<{ gid: string; name: string; completed: boolean; notes?: string }>('/tasks', {
      method: 'POST',
      body: { data: input },
    })

    return {
      gid: task.gid,
      name: task.name,
      completed: task.completed,
      notes: task.notes,
    }
  }

  async updateTask(taskGid: string, input: AsanaTaskUpsertInput): Promise<AsanaTask> {
    const task = await this.request<{ gid: string; name: string; completed: boolean; notes?: string }>(`/tasks/${taskGid}`, {
      method: 'PUT',
      body: { data: input },
    })

    return {
      gid: task.gid,
      name: task.name,
      completed: task.completed,
      notes: task.notes,
    }
  }

  async deleteTask(taskGid: string): Promise<void> {
    await this.request(`/tasks/${taskGid}`, { method: 'DELETE' as 'PUT' })
  }

  async listSections(projectGid: string): Promise<AsanaSection[]> {
    const sections = await this.request<Array<{ gid: string; name: string }>>(`/projects/${projectGid}/sections`, {
      query: { opt_fields: 'gid,name' },
    })
    return sections.map((s) => ({ gid: s.gid, name: s.name }))
  }

  async addTaskToSection(sectionGid: string, taskGid: string): Promise<void> {
    await this.request(`/sections/${sectionGid}/addTask`, {
      method: 'POST',
      body: { data: { task: taskGid } },
    })
  }
}
