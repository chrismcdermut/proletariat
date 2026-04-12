import type { NotionPage, NotionDatabase } from './types.js'

const NOTION_API_URL = 'https://api.notion.com/v1'
const NOTION_API_VERSION = '2022-06-28'

export class NotionClient {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${NOTION_API_URL}${path}`
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'Notion-Version': NOTION_API_VERSION,
      },
    }
    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }
    const response = await fetch(url, options)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Notion API ${method} ${path} failed with status ${response.status}: ${text}`)
    }
    return (await response.json()) as T
  }

  async verify(): Promise<{ botId: string; workspaceName: string }> {
    const data = await this.request<{ id: string; name: string }>('GET', '/users/me')
    return { botId: data.id, workspaceName: data.name }
  }

  async getDatabase(databaseId: string): Promise<NotionDatabase> {
    return this.request<NotionDatabase>('GET', `/databases/${databaseId}`)
  }

  async queryDatabase(databaseId: string, options?: {
    filter?: Record<string, unknown>
    sorts?: Array<Record<string, unknown>>
    startCursor?: string
    pageSize?: number
  }): Promise<{ results: NotionPage[]; has_more: boolean; next_cursor: string | null }> {
    const body: Record<string, unknown> = {}
    if (options?.filter) body.filter = options.filter
    if (options?.sorts) body.sorts = options.sorts
    if (options?.startCursor) body.start_cursor = options.startCursor
    if (options?.pageSize) body.page_size = options.pageSize
    return this.request<{ results: NotionPage[]; has_more: boolean; next_cursor: string | null }>('POST', `/databases/${databaseId}/query`, body)
  }

  async getPage(pageId: string): Promise<NotionPage> {
    return this.request<NotionPage>('GET', `/pages/${pageId}`)
  }

  async createPage(databaseId: string, properties: Record<string, unknown>): Promise<NotionPage> {
    return this.request<NotionPage>('POST', '/pages', { parent: { database_id: databaseId }, properties })
  }

  async updatePage(pageId: string, properties: Record<string, unknown>): Promise<NotionPage> {
    return this.request<NotionPage>('PATCH', `/pages/${pageId}`, { properties })
  }

  async archivePage(pageId: string): Promise<void> {
    await this.request<NotionPage>('PATCH', `/pages/${pageId}`, { archived: true })
  }
}
