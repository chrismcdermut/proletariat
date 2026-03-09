/**
 * Shortcut REST v3 API Client
 *
 * Provides methods for interacting with Shortcut stories, workflows, and members.
 * Auth via Shortcut-Token header.
 */

const DEFAULT_API_URL = 'https://api.app.shortcut.com/api/v3'

export interface ShortcutStory {
  id: number
  name: string
  description?: string
  app_url: string
  story_type?: string
  labels?: Array<{ name: string }>
  workflow_state_id?: number
  estimate?: number | null
  deadline?: string | null
  owner_ids?: string[]
  group_id?: string | null
  epic_id?: number | null
  project_id?: number | null
  completed?: boolean
  archived?: boolean
}

export interface ShortcutWorkflowState {
  id: number
  name: string
  type: string
}

export interface ShortcutStoryUpdateInput {
  name?: string
  description?: string
  story_type?: string
  workflow_state_id?: number
  estimate?: number | null
  deadline?: string | null
  archived?: boolean
}

export class ShortcutClient {
  private readonly apiUrl: string

  constructor(private apiToken: string, apiUrl?: string) {
    this.apiUrl = apiUrl || DEFAULT_API_URL
  }

  private async request<T>(
    path: string,
    init: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
      body?: unknown
      query?: Record<string, string | number | boolean | undefined>
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.apiUrl}${path}`)
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
        'Shortcut-Token': this.apiToken,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })

    if (response.status === 401 || response.status === 403) {
      throw new Error('Shortcut authentication failed. Verify your API token.')
    }

    if (response.status === 429) {
      throw new Error('Shortcut API rate limit exceeded. Wait a moment and try again.')
    }

    if (response.status === 404) {
      throw new ShortcutNotFoundError(`Resource not found: ${path}`)
    }

    if (!response.ok) {
      throw new Error(`Shortcut API request failed (${response.status})`)
    }

    return response.json() as Promise<T>
  }

  async getStory(storyId: number): Promise<ShortcutStory | null> {
    try {
      return await this.request<ShortcutStory>(`/stories/${storyId}`)
    } catch (error) {
      if (error instanceof ShortcutNotFoundError) return null
      throw error
    }
  }

  async updateStory(storyId: number, input: ShortcutStoryUpdateInput): Promise<ShortcutStory> {
    return this.request<ShortcutStory>(`/stories/${storyId}`, {
      method: 'PUT',
      body: input,
    })
  }

  async listWorkflowStates(): Promise<ShortcutWorkflowState[]> {
    const workflows = await this.request<Array<{
      states?: ShortcutWorkflowState[]
    }>>('/workflows')

    const states: ShortcutWorkflowState[] = []
    for (const workflow of workflows) {
      for (const state of workflow.states || []) {
        states.push(state)
      }
    }
    return states
  }

  async searchStories(query: string, limit = 20): Promise<ShortcutStory[]> {
    const response = await this.request<{ data?: ShortcutStory[] }>('/search/stories', {
      query: { query, page_size: Math.min(limit, 100) },
    })
    return response.data || []
  }

  async verify(): Promise<{ name: string; email: string; mentionName: string }> {
    const data = await this.request<{
      profile: { name: string; email_address: string; mention_name: string }
    }>('/member')

    return {
      name: data.profile?.name || 'Unknown',
      email: data.profile?.email_address || '',
      mentionName: data.profile?.mention_name || '',
    }
  }
}

export class ShortcutNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShortcutNotFoundError'
  }
}
