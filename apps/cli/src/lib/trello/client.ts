import type {
  TrelloBoard,
  TrelloCard,
  TrelloCardUpsertInput,
  TrelloList,
  TrelloMember,
} from './types.js'

interface TrelloSearchResponse {
  cards: TrelloCard[]
}

export class TrelloClient {
  private readonly baseUrl = 'https://api.trello.com/1'

  constructor(
    private apiKey: string,
    private apiToken: string,
  ) {}

  private async request<T>(
    path: string,
    init: {
      method?: 'GET' | 'POST' | 'PUT'
      query?: Record<string, string | number | boolean | undefined>
      body?: unknown
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    url.searchParams.set('key', this.apiKey)
    url.searchParams.set('token', this.apiToken)

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
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })

    if (response.status === 401) {
      throw new Error('Trello authentication failed. Verify your API key and token.')
    }

    if (response.status === 429) {
      throw new Error('Trello API rate limit exceeded. Wait a moment and try again.')
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Trello API request failed (${response.status}): ${text}`)
    }

    return response.json() as Promise<T>
  }

  async verify(): Promise<TrelloMember> {
    return this.request<TrelloMember>('/members/me', {
      query: { fields: 'id,fullName,username' },
    })
  }

  async getCard(cardId: string): Promise<TrelloCard | null> {
    try {
      return await this.request<TrelloCard>(`/cards/${cardId}`, {
        query: { fields: 'id,name,desc,url,shortUrl,idBoard,idList,idMembers,closed,due,dueComplete', members: true, member_fields: 'fullName,username', labels: 'all' },
      })
    } catch {
      return null
    }
  }

  async searchCards(query: string, options?: { limit?: number; boardId?: string }): Promise<TrelloCard[]> {
    const limit = Math.max(1, Math.min(options?.limit ?? 20, 100))
    const result = await this.request<TrelloSearchResponse>('/search', {
      query: {
        query,
        modelTypes: 'cards',
        cards_limit: limit,
        card_fields: 'id,name,desc,url,shortUrl,idBoard,idList,idMembers,closed,due,dueComplete',
        card_members: true,
        card_member_fields: 'fullName,username',
        card_labels: 'all',
        ...(options?.boardId ? { idBoards: options.boardId } : {}),
      },
    })
    return result.cards ?? []
  }

  async getBoard(boardId: string): Promise<TrelloBoard | null> {
    try {
      return await this.request<TrelloBoard>(`/boards/${boardId}`, {
        query: { fields: 'id,name,url' },
      })
    } catch {
      return null
    }
  }

  async getBoardLists(boardId: string): Promise<TrelloList[]> {
    return this.request<TrelloList[]>(`/boards/${boardId}/lists`, {
      query: { fields: 'id,name' },
    })
  }

  async getBoardCards(boardId: string, options?: { limit?: number; filter?: string }): Promise<TrelloCard[]> {
    const filter = options?.filter ?? 'open'
    return this.request<TrelloCard[]>(`/boards/${boardId}/cards/${filter}`, {
      query: {
        fields: 'id,name,desc,url,shortUrl,idBoard,idList,idMembers,closed,due,dueComplete',
        members: true,
        member_fields: 'fullName,username',
        labels: 'all',
      },
    })
  }

  async getBoards(): Promise<TrelloBoard[]> {
    return this.request<TrelloBoard[]>('/members/me/boards', {
      query: { fields: 'id,name,url', filter: 'open' },
    })
  }

  async createCard(input: TrelloCardUpsertInput): Promise<TrelloCard> {
    return this.request<TrelloCard>('/cards', {
      method: 'POST',
      body: input,
    })
  }

  async updateCard(cardId: string, input: TrelloCardUpsertInput): Promise<TrelloCard> {
    return this.request<TrelloCard>(`/cards/${cardId}`, {
      method: 'PUT',
      body: input,
    })
  }

  async addComment(cardId: string, text: string): Promise<void> {
    await this.request(`/cards/${cardId}/actions/comments`, {
      method: 'POST',
      body: { text },
    })
  }
}
