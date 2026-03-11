import type {
  TrelloBoard,
  TrelloCard,
  TrelloCardUpsertInput,
  TrelloList,
  TrelloMember,
} from './types.js'

const TRELLO_API_BASE = 'https://api.trello.com/1'

export class TrelloClient {
  constructor(
    private apiKey: string,
    private apiToken: string,
  ) {}

  private async request<T>(
    path: string,
    init: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
      query?: Record<string, string | number | boolean | undefined>
      body?: unknown
    } = {},
  ): Promise<T> {
    const url = new URL(`${TRELLO_API_BASE}${path}`)
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

    if (response.status === 401 || response.status === 403) {
      throw new Error('Trello authentication failed. Verify your API key and token.')
    }

    if (response.status === 429) {
      throw new Error('Trello API rate limit exceeded. Wait a moment and try again.')
    }

    if (response.status === 404) {
      throw new Error(`Trello resource not found: ${path}`)
    }

    if (!response.ok) {
      throw new Error(`Trello API request failed (${response.status})`)
    }

    return response.json() as Promise<T>
  }

  async verify(): Promise<TrelloMember> {
    return this.request<TrelloMember>('/members/me')
  }

  async getBoard(boardId: string): Promise<TrelloBoard> {
    return this.request<TrelloBoard>(`/boards/${boardId}`)
  }

  async listBoards(): Promise<TrelloBoard[]> {
    return this.request<TrelloBoard[]>('/members/me/boards', {
      query: { filter: 'open' },
    })
  }

  async listLists(boardId: string): Promise<TrelloList[]> {
    return this.request<TrelloList[]>(`/boards/${boardId}/lists`, {
      query: { filter: 'open' },
    })
  }

  async getCard(cardId: string): Promise<TrelloCard | null> {
    try {
      return await this.request<TrelloCard>(`/cards/${cardId}`, {
        query: {
          members: true,
          member_fields: 'fullName,username',
        },
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return null
      }
      throw error
    }
  }

  async listCards(boardId: string, options?: { limit?: number; listId?: string }): Promise<TrelloCard[]> {
    const limit = Math.max(1, Math.min(options?.limit ?? 50, 1000))

    if (options?.listId) {
      return this.request<TrelloCard[]>(`/lists/${options.listId}/cards`, {
        query: { limit },
      })
    }

    return this.request<TrelloCard[]>(`/boards/${boardId}/cards`, {
      query: {
        limit,
        filter: 'open',
      },
    })
  }

  async searchCards(query: string, options?: { limit?: number; boardId?: string }): Promise<TrelloCard[]> {
    const limit = Math.max(1, Math.min(options?.limit ?? 20, 100))

    const searchQuery: Record<string, string | number | boolean | undefined> = {
      query,
      card_fields: 'id,name,desc,url,shortUrl,idBoard,idList,idMembers,labels,closed,due,dueComplete',
      cards_limit: limit,
      cards_page: 0,
      modelTypes: 'cards',
    }

    if (options?.boardId) {
      searchQuery.idBoards = options.boardId
    }

    const result = await this.request<{ cards: TrelloCard[] }>('/search', {
      query: searchQuery,
    })

    return result.cards ?? []
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
}
