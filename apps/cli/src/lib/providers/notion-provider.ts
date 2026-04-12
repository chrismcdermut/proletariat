/**
 * Notion Ticket Provider
 *
 * Writes ticket operations directly to Notion via REST API,
 * then updates local PMO to keep it in sync.
 */

import type Database from 'better-sqlite3'
import { NotionClient } from '../notion/client.js'
import { getNotionApiKey, loadNotionConfig } from '../notion/config.js'
import type { NotionPage, NotionDatabase } from '../notion/types.js'
import {
  NOTION_STATUS_GROUP_TO_PMO_CATEGORY,
  NOTION_STATUS_NAME_TO_PMO_CATEGORY,
  NOTION_PRIORITY_TO_PMO,
  PMO_PRIORITY_TO_NOTION,
} from '../notion/types.js'
import type { Ticket, TicketFilter, CreateTicketInput, UpdateTicketInput } from '../pmo/types.js'
import type {
  TicketProvider,
  TicketProviderName,
  ProviderMoveResult,
  ProviderDeleteResult,
  ProviderListResult,
  ProviderCreateResult,
  ProviderGetResult,
  ProviderUpdateResult,
  ProviderAssignResult,
  ProviderStorage,
} from './types.js'

export class NotionTicketProvider implements TicketProvider {
  readonly name: TicketProviderName = 'notion'

  constructor(
    private db: Database.Database,
    private storage: ProviderStorage,
    private projectId: string,
  ) {}

  private getApiKeyOrFail(): string {
    const apiKey = getNotionApiKey(this.db)
    if (!apiKey) throw new Error('Notion API key not configured')
    return apiKey
  }

  private getDatabaseIdOrFail(): string {
    const config = loadNotionConfig(this.db)
    const dbId = config?.defaultDatabaseId || process.env.PRLT_NOTION_DATABASE_ID
    if (!dbId) throw new Error('Notion database ID is required. Set PRLT_NOTION_DATABASE_ID.')
    return dbId
  }

  private getStatusPropertyName(): string {
    const config = loadNotionConfig(this.db)
    return config?.statusPropertyName || 'Status'
  }

  private getTitlePropertyName(): string {
    const config = loadNotionConfig(this.db)
    return config?.titlePropertyName || 'Name'
  }

  async moveTicket(ticketId: string, newState: string): Promise<ProviderMoveResult> {
    const apiKey = getNotionApiKey(this.db)
    if (!apiKey) {
      return { success: false, provider: 'notion', error: 'Notion API key not configured' }
    }
    const ticket = await this.storage.getTicket(ticketId)
    if (!ticket) {
      return { success: false, provider: 'notion', error: `Ticket ${ticketId} not found` }
    }
    const notionPageId = ticket.metadata?.['notion.page_id']
    if (!notionPageId) {
      return { success: false, provider: 'notion', error: `No Notion mapping for ticket ${ticketId}` }
    }
    const client = new NotionClient(apiKey)
    try {
      await client.updatePage(notionPageId, {
        [this.getStatusPropertyName()]: { status: { name: newState } },
      })
    } catch (error) {
      return { success: false, provider: 'notion', error: `Failed to update Notion page: ${error instanceof Error ? error.message : String(error)}` }
    }
    try { await this.storage.moveTicket(this.projectId, ticketId, newState) } catch { /* Non-fatal */ }
    return { success: true, provider: 'notion' }
  }

  async deleteTicket(ticketId: string): Promise<ProviderDeleteResult> {
    let apiKey: string
    try { apiKey = this.getApiKeyOrFail() } catch { return { success: false, provider: 'notion', error: 'Notion API key not configured' } }
    const ticket = await this.storage.getTicket(ticketId)
    const notionPageId = ticket?.metadata?.['notion.page_id']
    if (notionPageId) {
      const client = new NotionClient(apiKey)
      try { await client.archivePage(notionPageId) } catch (error) {
        return { success: false, provider: 'notion', error: `Failed to archive Notion page: ${error instanceof Error ? error.message : String(error)}` }
      }
    }
    try { await this.storage.deleteTicket(ticketId) } catch { /* Non-fatal */ }
    return { success: true, provider: 'notion' }
  }

  async listTickets(_projectId?: string, filter?: TicketFilter): Promise<ProviderListResult> {
    let apiKey: string
    try { apiKey = this.getApiKeyOrFail() } catch { return { success: false, provider: 'notion', tickets: [], error: 'Notion API key not configured' } }
    let databaseId: string
    try { databaseId = this.getDatabaseIdOrFail() } catch { return { success: false, provider: 'notion', tickets: [], error: 'Notion database ID is required. Set PRLT_NOTION_DATABASE_ID.' } }
    try {
      const client = new NotionClient(apiKey)
      const notionFilter = filter?.column ? { property: this.getStatusPropertyName(), status: { equals: filter.column } } : undefined
      const allPages: NotionPage[] = []
      let cursor: string | undefined
      do {
        const response = await client.queryDatabase(databaseId, { filter: notionFilter, startCursor: cursor, pageSize: 100 })
        allPages.push(...response.results)
        cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
      } while (cursor)
      let statusGroupMap: Map<string, string> | undefined
      try {
        const dbSchema = await client.getDatabase(databaseId)
        statusGroupMap = buildStatusGroupMap(dbSchema, this.getStatusPropertyName())
      } catch { /* Non-fatal */ }
      let tickets: Ticket[] = allPages.map(page => notionPageToTicket(page, this.getTitlePropertyName(), this.getStatusPropertyName(), statusGroupMap))
      if (filter?.priority) { tickets = tickets.filter(t => t.priority === filter.priority) }
      if (filter?.category) { tickets = tickets.filter(t => t.category === filter.category) }
      if (filter?.search) { const term = filter.search.toLowerCase(); tickets = tickets.filter(t => t.title.toLowerCase().includes(term) || (t.description || '').toLowerCase().includes(term)) }
      if (filter?.label) { const label = filter.label.toLowerCase(); tickets = tickets.filter(t => t.labels.some(l => l.toLowerCase() === label)) }
      return { success: true, provider: 'notion', tickets }
    } catch (error) {
      return { success: false, provider: 'notion', tickets: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  async createTicket(projectId: string, input: CreateTicketInput): Promise<ProviderCreateResult> {
    let apiKey: string
    try { apiKey = this.getApiKeyOrFail() } catch { return { success: false, provider: 'notion', error: 'Notion API key not configured' } }
    let databaseId: string
    try { databaseId = this.getDatabaseIdOrFail() } catch { return { success: false, provider: 'notion', error: 'Notion database ID is required. Set PRLT_NOTION_DATABASE_ID.' } }
    const client = new NotionClient(apiKey)
    const titleProp = this.getTitlePropertyName()
    const statusProp = this.getStatusPropertyName()
    try {
      const properties: Record<string, unknown> = { [titleProp]: { title: [{ text: { content: input.title } }] } }
      if (input.statusName) { properties[statusProp] = { status: { name: input.statusName } } }
      if (input.priority) { const np = PMO_PRIORITY_TO_NOTION[input.priority]; if (np) { properties['Priority'] = { select: { name: np } } } }
      if (input.labels && input.labels.length > 0) { properties['Tags'] = { multi_select: input.labels.map((name: string) => ({ name })) } }
      const page = await client.createPage(databaseId, properties)
      const pmoTicket = await this.storage.createTicket(projectId, {
        ...input,
        metadata: { ...input.metadata, external_source: 'notion', external_id: page.id, external_key: page.id, external_url: page.url, 'notion.page_id': page.id, 'notion.database_id': databaseId },
      })
      return { success: true, provider: 'notion', ticket: pmoTicket }
    } catch (error) {
      return { success: false, provider: 'notion', error: error instanceof Error ? error.message : String(error) }
    }
  }

  async getTicket(ticketId: string): Promise<ProviderGetResult> {
    try {
      const ticket = await this.storage.getTicket(ticketId)
      return { success: true, provider: 'notion', ticket }
    } catch (error) {
      return { success: false, provider: 'notion', error: error instanceof Error ? error.message : String(error) }
    }
  }

  async updateTicket(ticketId: string, input: UpdateTicketInput): Promise<ProviderUpdateResult> {
    let apiKey: string
    try { apiKey = this.getApiKeyOrFail() } catch { return { success: false, provider: 'notion', error: 'Notion API key not configured' } }
    const ticket = await this.storage.getTicket(ticketId)
    const notionPageId = ticket?.metadata?.['notion.page_id']
    if (notionPageId) {
      const titleProp = this.getTitlePropertyName()
      const properties: Record<string, unknown> = {}
      if (input.title !== undefined) { properties[titleProp] = { title: [{ text: { content: input.title } }] } }
      if (input.priority !== undefined) { const np = input.priority ? PMO_PRIORITY_TO_NOTION[input.priority] : null; if (np) { properties['Priority'] = { select: { name: np } } } else { properties['Priority'] = { select: null } } }
      if (Object.keys(properties).length > 0) {
        const client = new NotionClient(apiKey)
        try { await client.updatePage(notionPageId, properties) } catch (error) {
          return { success: false, provider: 'notion', error: `Failed to update Notion page: ${error instanceof Error ? error.message : String(error)}` }
        }
      }
    }
    try {
      const updated = await this.storage.updateTicket(ticketId, input as Partial<Ticket>)
      return { success: true, provider: 'notion', ticket: updated }
    } catch (error) {
      return { success: false, provider: 'notion', error: error instanceof Error ? error.message : String(error) }
    }
  }

  async assignTicket(ticketId: string, assignee: string): Promise<ProviderAssignResult> {
    try { this.getApiKeyOrFail() } catch { return { success: false, provider: 'notion', error: 'Notion API key not configured' } }
    try {
      await this.storage.updateTicket(ticketId, { assignee } as Partial<Ticket>)
      return { success: true, provider: 'notion' }
    } catch (error) {
      return { success: false, provider: 'notion', error: error instanceof Error ? error.message : String(error) }
    }
  }
}

export function buildStatusGroupMap(dbSchema: NotionDatabase, statusPropertyName: string): Map<string, string> {
  const map = new Map<string, string>()
  const statusProp = dbSchema.properties[statusPropertyName]
  if (statusProp?.type !== 'status' || !statusProp.status) return map
  for (const group of statusProp.status.groups) {
    for (const optionId of group.option_ids) {
      const option = statusProp.status.options.find((o: { id: string; name: string }) => o.id === optionId)
      if (option) { map.set(option.name, group.name) }
    }
  }
  return map
}

function extractText(prop: { type: string; title?: Array<{ plain_text: string }>; rich_text?: Array<{ plain_text: string }> } | undefined): string {
  if (!prop) return ''
  if (prop.type === 'title' && prop.title) { return prop.title.map((t: { plain_text: string }) => t.plain_text).join('') }
  if (prop.type === 'rich_text' && prop.rich_text) { return prop.rich_text.map((t: { plain_text: string }) => t.plain_text).join('') }
  return ''
}

function resolveStatusCategory(statusName: string, statusGroupMap?: Map<string, string>): string {
  if (statusGroupMap) {
    const groupName = statusGroupMap.get(statusName)
    if (groupName) { return NOTION_STATUS_GROUP_TO_PMO_CATEGORY[groupName] || 'started' }
  }
  return NOTION_STATUS_NAME_TO_PMO_CATEGORY[statusName] || 'started'
}

export function notionPageToTicket(page: NotionPage, titlePropertyName: string, statusPropertyName: string, statusGroupMap?: Map<string, string>): Ticket {
  const title = extractText(page.properties[titlePropertyName])
  const statusProp = page.properties[statusPropertyName]
  let statusName = 'Not started'
  if (statusProp?.type === 'status' && statusProp.status) { statusName = statusProp.status.name }
  else if (statusProp?.type === 'select' && statusProp.select) { statusName = statusProp.select.name }
  const statusCategory = resolveStatusCategory(statusName, statusGroupMap)
  const priorityProp = page.properties['Priority']
  let priority: string | undefined
  if (priorityProp?.type === 'select' && priorityProp.select) { priority = NOTION_PRIORITY_TO_PMO[priorityProp.select.name] }
  const description = extractText(page.properties['Description'])
  const tagsProp = page.properties['Tags']
  const labels: string[] = []
  if (tagsProp?.type === 'multi_select' && tagsProp.multi_select) { for (const tag of tagsProp.multi_select) { labels.push(tag.name) } }
  const assigneeProp = page.properties['Assignee'] || page.properties['Assign']
  let assignee: string | undefined
  if (assigneeProp?.type === 'people' && assigneeProp.people && assigneeProp.people.length > 0) { assignee = assigneeProp.people[0].name || assigneeProp.people[0].person?.email }
  let uniqueKey = page.id
  const idProp = page.properties['ID']
  if (idProp?.type === 'unique_id' && idProp.unique_id) { const prefix = idProp.unique_id.prefix || ''; uniqueKey = prefix ? `${prefix}-${idProp.unique_id.number}` : String(idProp.unique_id.number) }
  return {
    id: uniqueKey, title, description: description || undefined, priority, projectId: '',
    statusId: statusName, statusName, statusCategory: statusCategory as Ticket['statusCategory'],
    assignee, subtasks: [], labels,
    metadata: { external_source: 'notion', external_key: uniqueKey, external_id: page.id, external_url: page.url, 'notion.page_id': page.id },
    createdAt: new Date(page.created_time), updatedAt: new Date(page.last_edited_time),
  }
}
