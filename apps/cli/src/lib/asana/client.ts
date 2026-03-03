import type {
  AsanaProject,
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

    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available in supported Node runtimes for this CLI
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

  async getTask(taskGid: string): Promise<AsanaTask | null> {
    try {
      const task = await this.request<{ gid: string; name: string; completed: boolean; notes?: string }>(`/tasks/${taskGid}`, {
        query: { opt_fields: 'gid,name,completed,notes' },
      })
      return {
        gid: task.gid,
        name: task.name,
        completed: task.completed,
        notes: task.notes,
      }
    } catch {
      return null
    }
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
}
