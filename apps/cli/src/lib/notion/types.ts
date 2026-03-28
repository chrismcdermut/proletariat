/**
 * Notion Integration Types
 *
 * Types for Notion API responses and internal mappings.
 */

export interface NotionConfig {
  apiKey: string
  databaseId?: string
  databaseName?: string
}

export interface NotionDatabase {
  id: string
  title: Array<{ plain_text: string }>
  url: string
}

export interface NotionUser {
  id: string
  name?: string
  type: 'person' | 'bot'
}

export interface NotionSelectOption {
  id: string
  name: string
  color?: string
}

export interface NotionStatusProperty {
  id: string
  name: string
  color?: string
  /** Status group (e.g., "To-do", "In progress", "Complete") */
  group?: { id: string; name: string; color: string }
}

export interface NotionPage {
  id: string
  url: string
  created_time: string
  last_edited_time: string
  archived: boolean
  properties: Record<string, NotionPropertyValue>
}

export type NotionPropertyValue =
  | { type: 'title'; title: Array<{ plain_text: string }> }
  | { type: 'rich_text'; rich_text: Array<{ plain_text: string }> }
  | { type: 'status'; status: { id: string; name: string; color: string } | null }
  | { type: 'select'; select: { id: string; name: string; color: string } | null }
  | { type: 'multi_select'; multi_select: Array<{ id: string; name: string; color: string }> }
  | { type: 'people'; people: Array<{ id: string; name?: string }> }
  | { type: 'url'; url: string | null }
  | { type: 'date'; date: { start: string; end?: string | null } | null }
  | { type: 'checkbox'; checkbox: boolean }
  | { type: 'number'; number: number | null }

export interface NotionPageMap {
  pmoTicketId: string
  notionPageId: string
  notionDatabaseId?: string
  lastSyncedAt?: Date
  createdAt: Date
}

export interface NotionQueryFilter {
  property?: string
  status?: { equals: string }
  title?: { contains: string }
}

export interface NotionDatabaseQueryResponse {
  results: NotionPage[]
  has_more: boolean
  next_cursor: string | null
}
