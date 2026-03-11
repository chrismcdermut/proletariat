export interface TrelloConfig {
  apiKey: string
  apiToken: string
  boardId?: string
  boardName?: string
}

export interface TrelloBoard {
  id: string
  name: string
  url: string
}

export interface TrelloList {
  id: string
  name: string
  closed: boolean
}

export interface TrelloMember {
  id: string
  fullName: string
  username: string
}

export interface TrelloLabel {
  id: string
  name: string
  color: string
}

export interface TrelloCard {
  id: string
  name: string
  desc: string
  url: string
  shortUrl: string
  idBoard: string
  idList: string
  idMembers: string[]
  labels: TrelloLabel[]
  closed: boolean
  due: string | null
  dueComplete: boolean
}

export interface TrelloCardMap {
  pmoTicketId: string
  trelloCardId: string
  trelloBoardId?: string
  lastSyncedAt?: Date
  createdAt: Date
}

export interface TrelloCardUpsertInput {
  name: string
  desc?: string
  closed?: boolean
  idList?: string
  idBoard?: string
}
