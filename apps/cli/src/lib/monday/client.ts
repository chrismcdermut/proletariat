import type { MondayBoard, MondayItem } from './types.js'

const MONDAY_API_URL = 'https://api.monday.com/v2'

interface MondayGraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

export class MondayClient {
  constructor(private apiToken: string) {}

  async verify(): Promise<{ accountName: string; userName: string; email?: string }> {
    const data = await this.request<{
      me: { id: string; name: string; email?: string }
      account: { id: string; name: string; slug?: string }
    }>(`
      query VerifyMondayConnection {
        me {
          id
          name
          email
        }
        account {
          id
          name
          slug
        }
      }
    `)

    return {
      accountName: data.account.name,
      userName: data.me.name,
      email: data.me.email,
    }
  }

  async getBoard(boardId: string): Promise<MondayBoard | null> {
    const data = await this.request<{ boards: Array<{ id: string; name: string; url?: string | null }> }>(`
      query GetBoard($boardIds: [ID!]) {
        boards(ids: $boardIds) {
          id
          name
          url
        }
      }
    `, { boardIds: [boardId] })

    if (data.boards.length === 0) return null

    return {
      id: data.boards[0].id,
      name: data.boards[0].name,
      url: data.boards[0].url ?? undefined,
    }
  }

  async createItem(boardId: string, itemName: string): Promise<MondayItem> {
    const data = await this.request<{ create_item: { id: string; name: string; url?: string | null } }>(`
      mutation CreateItem($boardId: ID!, $itemName: String!) {
        create_item(board_id: $boardId, item_name: $itemName) {
          id
          name
          url
        }
      }
    `, {
      boardId,
      itemName,
    })

    return {
      id: data.create_item.id,
      name: data.create_item.name,
      url: data.create_item.url ?? undefined,
    }
  }

  async updateItemName(boardId: string, itemId: string, name: string): Promise<void> {
    await this.request<{ change_simple_column_value: { id: string } }>(`
      mutation UpdateItemName($boardId: ID!, $itemId: ID!, $value: String!) {
        change_simple_column_value(
          board_id: $boardId
          item_id: $itemId
          column_id: "name"
          value: $value
        ) {
          id
        }
      }
    `, {
      boardId,
      itemId,
      value: name,
    })
  }

  private async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
     
    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        Authorization: this.apiToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })

    const responseText = await response.text()

    let payload: MondayGraphQLResponse<T>
    try {
      payload = JSON.parse(responseText) as MondayGraphQLResponse<T>
    } catch {
      throw new Error(`Monday API returned invalid JSON (${response.status}): ${responseText}`)
    }

    if (!response.ok) {
      const message = payload.errors?.[0]?.message ?? responseText
      throw new Error(`Monday API request failed (${response.status}): ${message}`)
    }

    if (payload.errors && payload.errors.length > 0) {
      throw new Error(payload.errors[0].message)
    }

    if (!payload.data) {
      throw new Error('Monday API response missing data')
    }

    return payload.data
  }
}
