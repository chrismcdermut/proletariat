/**
 * Notion Integration Types
 */

export interface NotionPage {
  id: string
  url: string
  created_time: string
  last_edited_time: string
  properties: Record<string, NotionProperty>
}

export interface NotionProperty {
  type: string
  title?: Array<{ plain_text: string }>
  rich_text?: Array<{ plain_text: string }>
  status?: { id: string; name: string; color: string } | null
  select?: { id: string; name: string; color: string } | null
  multi_select?: Array<{ id: string; name: string; color: string }>
  people?: Array<{ id: string; name?: string; person?: { email?: string } }>
  date?: { start: string; end?: string } | null
  url?: string | null
  number?: number | null
  checkbox?: boolean
  unique_id?: { prefix: string | null; number: number }
  [key: string]: unknown
}

export interface NotionDatabase {
  id: string
  title: Array<{ plain_text: string }>
  properties: Record<string, NotionDatabaseProperty>
}

export interface NotionDatabaseProperty {
  type: string
  status?: {
    options: Array<{ id: string; name: string; color: string }>
    groups: Array<{ id: string; name: string; option_ids: string[]; color: string }>
  }
  select?: { options: Array<{ id: string; name: string; color: string }> }
  multi_select?: { options: Array<{ id: string; name: string; color: string }> }
  [key: string]: unknown
}

export interface NotionConfig {
  apiKey: string
  defaultDatabaseId?: string
  defaultDatabaseName?: string
  statusPropertyName?: string
  titlePropertyName?: string
}

export const NOTION_STATUS_GROUP_TO_PMO_CATEGORY: Record<string, string> = {
  'To-do': 'backlog',
  'In progress': 'started',
  'Complete': 'completed',
}

export const NOTION_STATUS_NAME_TO_PMO_CATEGORY: Record<string, string> = {
  'Not started': 'backlog',
  'To do': 'backlog',
  'Backlog': 'backlog',
  'In progress': 'started',
  'In Progress': 'started',
  'In Review': 'started',
  'Review': 'started',
  'Done': 'completed',
  'Complete': 'completed',
  'Completed': 'completed',
  'Cancelled': 'canceled',
  'Archived': 'canceled',
}

export const NOTION_PRIORITY_TO_PMO: Record<string, string> = {
  Urgent: 'P0',
  High: 'P1',
  Medium: 'P2',
  Low: 'P3',
}

export const PMO_PRIORITY_TO_NOTION: Record<string, string> = {
  P0: 'Urgent',
  P1: 'High',
  P2: 'Medium',
  P3: 'Low',
}
