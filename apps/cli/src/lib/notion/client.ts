/**
 * Notion API Client
 *
 * Lightweight wrapper around the Notion REST API.
 * Uses the Notion API with Bearer token authentication.
 */

import type {
  NotionDatabase,
  NotionPage,
  NotionUser,
  NotionDatabaseQueryResponse,
} from './types.js'

const NOTION_API_VERSION = '2022-06-28'

export class NotionClient {
  private readonly baseUrl = 'https://api.notion.com/v1'

  constructor(private apiKey: string) {}

  private async request<T>(
    path: string,
    init: {
      method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
      body?: unknown
      query?: Record<string, string | undefined>
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)

    if (init.query) {
      for (const [key, value] of Object.entries(init.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value)
        }
      }
    }

    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_API_VERSION,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })

    if (response.status === 401) {
      throw new Error('Notion authentication failed. Verify your integration token.')
    }

    if (response.status === 429) {
      throw new Error('Notion API rate limit exceeded. Wait a moment and try again.')
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Notion API request failed (${response.status}): ${text}`)
    }

    return response.json() as Promise<T>
  }

  /**
   * Verify the integration token by fetching the bot user.
   */
  async verify(): Promise<NotionUser> {
    const result = await this.request<{ bot: { owner: { type: string } }; id: string; name?: string }>('/users/me')
    return { id: result.id, name: result.name, type: 'bot' }
  }

  /**
   * Get a database by ID.
   */
  async getDatabase(databaseId: string): Promise<NotionDatabase | null> {
    try {
      return await this.request<NotionDatabase>(`/databases/${databaseId}`)
    } catch {
      return null
    }
  }

  /**
   * Query a database for pages, optionally with a filter.
   */
  async queryDatabase(
    databaseId: string,
    options?: {
      filter?: unknown
      sorts?: unknown
      startCursor?: string
      pageSize?: number
    },
  ): Promise<NotionDatabaseQueryResponse> {
    const body: Record<string, unknown> = {}
    if (options?.filter) body.filter = options.filter
    if (options?.sorts) body.sorts = options.sorts
    if (options?.startCursor) body.start_cursor = options.startCursor
    if (options?.pageSize) body.page_size = Math.min(options.pageSize, 100)

    return this.request<NotionDatabaseQueryResponse>(`/databases/${databaseId}/query`, {
      method: 'POST',
      body,
    })
  }

  /**
   * Get a page by ID.
   */
  async getPage(pageId: string): Promise<NotionPage | null> {
    try {
      return await this.request<NotionPage>(`/pages/${pageId}`)
    } catch {
      return null
    }
  }

  /**
   * Create a page in a database.
   */
  async createPage(
    databaseId: string,
    properties: Record<string, unknown>,
  ): Promise<NotionPage> {
    return this.request<NotionPage>('/pages', {
      method: 'POST',
      body: {
        parent: { database_id: databaseId },
        properties,
      },
    })
  }

  /**
   * Update a page's properties.
   */
  async updatePage(
    pageId: string,
    properties: Record<string, unknown>,
  ): Promise<NotionPage> {
    return this.request<NotionPage>(`/pages/${pageId}`, {
      method: 'PATCH',
      body: { properties },
    })
  }

  /**
   * Archive (soft-delete) a page.
   */
  async archivePage(pageId: string): Promise<NotionPage> {
    return this.request<NotionPage>(`/pages/${pageId}`, {
      method: 'PATCH',
      body: { archived: true },
    })
  }

  /**
   * Search for pages and databases.
   */
  async search(
    query: string,
    options?: { filter?: { property: string; value: string }; pageSize?: number },
  ): Promise<{ results: NotionPage[] }> {
    const body: Record<string, unknown> = { query }
    if (options?.filter) body.filter = options.filter
    if (options?.pageSize) body.page_size = Math.min(options.pageSize, 100)

    return this.request<{ results: NotionPage[] }>('/search', {
      method: 'POST',
      body,
    })
  }

  /**
   * Retrieve the status property options from a database schema.
   * Returns the status groups and options if a status property exists.
   */
  async getDatabaseStatuses(databaseId: string): Promise<Array<{ id: string; name: string; color: string }>> {
    const db = await this.getDatabase(databaseId)
    if (!db) return []

    const props = (db as unknown as { properties: Record<string, unknown> }).properties
    if (!props) return []

    for (const prop of Object.values(props)) {
      const p = prop as Record<string, unknown>
      if (p.type === 'status') {
        const statusConfig = p.status as { options?: Array<{ id: string; name: string; color: string }> } | undefined
        return statusConfig?.options ?? []
      }
    }

    return []
  }

  /**
   * Add a comment to a page.
   */
  async addComment(pageId: string, text: string): Promise<void> {
    await this.request('/comments', {
      method: 'POST',
      body: {
        parent: { page_id: pageId },
        rich_text: [{ type: 'text', text: { content: text } }],
      },
    })
  }
}
