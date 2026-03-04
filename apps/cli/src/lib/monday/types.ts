/**
 * Monday.com Integration Types
 */

export interface MondayBoard {
  id: string
  name: string
  url?: string
}

export interface MondayItem {
  id: string
  name: string
  url?: string
}

export interface MondayConfig {
  apiToken: string
  boardId?: string
  boardName?: string
  accountName?: string
}

export interface MondayItemMap {
  pmoTicketId: string
  mondayBoardId: string
  mondayItemId: string
  mondayItemName: string
  mondayItemUrl?: string
  syncDirection: 'outbound' | 'bidirectional'
  lastSyncedAt?: Date
  createdAt: Date
}

export interface MondaySyncResult {
  synced: number
  created: number
  skipped: number
  errors: Array<{
    ticketId: string
    error: string
  }>
}
