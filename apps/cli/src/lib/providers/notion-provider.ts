/**
 * Notion Ticket Provider
 *
 * Writes ticket operations directly to Notion via API,
 * then updates local PMO to keep it in sync.
 *
 * Follows the same pattern as TrelloTicketProvider:
 * Notion is the source of truth, PMO is best-effort mirror.
 *
 * Notion databases act as kanban boards — pages are tickets,
 * and the Status property maps to board columns.
 */

import type Database from 'better-sqlite3'
import { NotionClient } from '../notion/client.js'
import { NotionMapper } from '../notion/mapper.js'
import { getNotionApiKey, loadNotionConfig } from '../notion/config.js'
import type { NotionPage, NotionPropertyValue } from '../notion/types.js'
import type { Ticket, TicketFilter, CreateTicketInput, UpdateTicketInput } from '../pmo/types.js'
import type {
  TicketProvider,
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
  readonly name = 'notion' as const

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

  async moveTicket(ticketId: string, newState: string): Promise<ProviderMoveResult> {
    // 1. Get Notion credentials
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'notion', error: 'Notion credentials not configured' }
    }

    // 2. Look up Notion mapping for this PMO ticket
    const mapper = new NotionMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)
    if (!mapping) {
      return { success: false, provider: 'notion', error: `No Notion mapping for ticket ${ticketId}` }
    }

    const client = new NotionClient(apiKey)

    // 3. Get the page to find its Status property
    const page = await client.getPage(mapping.notionPageId)
    if (!page) {
      return { success: false, provider: 'notion', error: `Notion page ${mapping.notionPageId} not found` }
    }

    // 4. Find the Status property name on this page
    const statusPropName = findStatusPropertyName(page)
    if (!statusPropName) {
      return {
        success: false,
        provider: 'notion',
        error: 'No Status property found on Notion page. Ensure the database has a Status property.',
      }
    }

    // 5. Update the page's Status property
    try {
      await client.updatePage(mapping.notionPageId, {
        [statusPropName]: { status: { name: newState } },
      })
    } catch (error) {
      return {
        success: false,
        provider: 'notion',
        error: `Failed to update Notion page status: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // 6. Update local PMO mirror (best-effort)
    try {
      await this.storage.moveTicket(this.projectId, ticketId, newState)
    } catch {
      // Non-fatal: Notion is the source of truth
    }

    // 7. Post a comment about the status change (best-effort)
    try {
      await client.addComment(
        mapping.notionPageId,
        `Status updated to ${newState} (via prlt)`,
      )
    } catch {
      // Non-fatal: comment is informational
    }

    // 8. Update sync timestamp (best-effort)
    try {
      mapper.updateSyncTimestamp(ticketId)
    } catch {
      // Non-fatal
    }

    return { success: true, provider: 'notion' }
  }

  async deleteTicket(ticketId: string): Promise<ProviderDeleteResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'notion', error: 'Notion credentials not configured' }
    }

    // Look up Notion mapping
    const mapper = new NotionMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)

    if (mapping) {
      // Archive the page in Notion
      const client = new NotionClient(apiKey)
      try {
        await client.archivePage(mapping.notionPageId)
      } catch (error) {
        return {
          success: false,
          provider: 'notion',
          error: `Failed to archive Notion page: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    // Delete the local PMO mirror
    try {
      await this.storage.deleteTicket(ticketId)
    } catch {
      // Non-fatal if Notion archive succeeded
    }

    return { success: true, provider: 'notion' }
  }

  async listTickets(_projectId?: string, filter?: TicketFilter): Promise<ProviderListResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'notion', tickets: [], error: 'Notion credentials not configured' }
    }

    const notionConfig = loadNotionConfig(this.db)
    const databaseId = notionConfig?.databaseId || process.env.PRLT_NOTION_DATABASE_ID

    if (!databaseId) {
      return {
        success: false,
        provider: 'notion',
        tickets: [],
        error: 'Notion database ID is required. Run "prlt notion configure" or set PRLT_NOTION_DATABASE_ID.',
      }
    }

    const client = new NotionClient(apiKey)

    try {
      // Build Notion filter if we have a status/column filter
      let notionFilter: unknown | undefined
      if (filter?.column) {
        notionFilter = {
          property: 'Status',
          status: { equals: filter.column },
        }
      }

      const response = await client.queryDatabase(databaseId, {
        filter: notionFilter,
        pageSize: 50,
      })

      let tickets: Ticket[] = response.results.map(page => notionPageToTicket(page, databaseId))

      // Apply client-side filters
      if (filter?.priority) {
        tickets = tickets.filter(t => t.priority === filter.priority)
      }
      if (filter?.category) {
        tickets = tickets.filter(t => t.category === filter.category)
      }
      if (filter?.search) {
        const term = filter.search.toLowerCase()
        tickets = tickets.filter(t =>
          t.title.toLowerCase().includes(term) ||
          (t.description || '').toLowerCase().includes(term),
        )
      }
      if (filter?.label) {
        const label = filter.label.toLowerCase()
        tickets = tickets.filter(t => t.labels.some(l => l.toLowerCase() === label))
      }

      return { success: true, provider: 'notion', tickets }
    } catch (error) {
      return {
        success: false,
        provider: 'notion',
        tickets: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async createTicket(projectId: string, input: CreateTicketInput): Promise<ProviderCreateResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'notion', error: 'Notion credentials not configured' }
    }

    const notionConfig = loadNotionConfig(this.db)
    const databaseId = notionConfig?.databaseId || process.env.PRLT_NOTION_DATABASE_ID

    if (!databaseId) {
      return {
        success: false,
        provider: 'notion',
        error: 'Notion database ID is required. Run "prlt notion configure" or set PRLT_NOTION_DATABASE_ID.',
      }
    }

    const client = new NotionClient(apiKey)

    try {
      // Build Notion properties
      const properties: Record<string, unknown> = {
        Name: { title: [{ text: { content: input.title } }] },
      }

      if (input.description) {
        properties['Description'] = {
          rich_text: [{ text: { content: input.description } }],
        }
      }

      // Create the page in Notion
      const page = await client.createPage(databaseId, properties)

      // Create local PMO mirror ticket
      const mirrorDescription = [
        input.description || '',
        '',
        '---',
        `_Created in Notion: [${input.title}](${page.url})_`,
      ].join('\n').trim()

      const pmoTicket = await this.storage.createTicket(projectId, {
        ...input,
        description: mirrorDescription,
        metadata: {
          ...input.metadata,
          'external_source': 'notion',
          'external_id': page.id,
          'external_key': page.id,
          'external_url': page.url,
        },
      })

      // Create mapping record for sync operations
      const mapper = new NotionMapper(this.db)
      mapper.createOrUpdateMapping(pmoTicket.id, page.id, databaseId)

      return { success: true, provider: 'notion', ticket: pmoTicket }
    } catch (error) {
      return {
        success: false,
        provider: 'notion',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async getTicket(ticketId: string): Promise<ProviderGetResult> {
    // Use local PMO mirror to avoid unnecessary API calls (same pattern as Linear/Trello)
    try {
      const ticket = await this.storage.getTicket(ticketId)
      return { success: true, provider: 'notion', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'notion',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async updateTicket(ticketId: string, input: UpdateTicketInput): Promise<ProviderUpdateResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'notion', error: 'Notion credentials not configured' }
    }

    // Look up Notion mapping for this PMO ticket
    const mapper = new NotionMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)

    if (mapping) {
      // Build Notion update payload from input fields
      const properties: Record<string, unknown> = {}
      if (input.title !== undefined) {
        properties['Name'] = { title: [{ text: { content: input.title } }] }
      }
      if (input.description !== undefined) {
        properties['Description'] = {
          rich_text: [{ text: { content: input.description ?? '' } }],
        }
      }

      // Only call Notion API if there are Notion-relevant fields
      if (Object.keys(properties).length > 0) {
        const client = new NotionClient(apiKey)
        try {
          await client.updatePage(mapping.notionPageId, properties)
        } catch (error) {
          return {
            success: false,
            provider: 'notion',
            error: `Failed to update Notion page: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }

      // Update sync timestamp (best-effort)
      try {
        mapper.updateSyncTimestamp(ticketId)
      } catch {
        // Non-fatal
      }
    }

    // Also update local PMO mirror
    try {
      const ticket = await this.storage.updateTicket(ticketId, input as Partial<Ticket>)
      return { success: true, provider: 'notion', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'notion',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async assignTicket(ticketId: string, assignee: string): Promise<ProviderAssignResult> {
    // Notion assignee is via People property — best-effort on Notion side,
    // always update local PMO mirror
    try {
      await this.storage.updateTicket(ticketId, { assignee } as Partial<Ticket>)
      return { success: true, provider: 'notion' }
    } catch (error) {
      return {
        success: false,
        provider: 'notion',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Find the Status property name on a Notion page.
 * Looks for a property with type 'status'.
 */
function findStatusPropertyName(page: NotionPage): string | null {
  for (const [name, prop] of Object.entries(page.properties)) {
    if (prop.type === 'status') {
      return name
    }
  }
  return null
}

/**
 * Extract the title from a Notion page's properties.
 */
function extractTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'title' && prop.title.length > 0) {
      return prop.title.map(t => t.plain_text).join('')
    }
  }
  return 'Untitled'
}

/**
 * Extract a rich text property value.
 */
function extractRichText(prop: NotionPropertyValue | undefined): string | undefined {
  if (!prop || prop.type !== 'rich_text') return undefined
  if (prop.rich_text.length === 0) return undefined
  return prop.rich_text.map(t => t.plain_text).join('')
}

/**
 * Extract the status name from a Notion page.
 */
function extractStatus(page: NotionPage): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'status' && prop.status) {
      return prop.status.name
    }
  }
  return 'Unknown'
}

/**
 * Extract labels from multi_select properties.
 */
function extractLabels(page: NotionPage): string[] {
  const labels: string[] = []
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'multi_select') {
      for (const item of prop.multi_select) {
        labels.push(item.name)
      }
    }
  }
  return labels
}

/**
 * Extract the assignee from People properties.
 */
function extractAssignee(page: NotionPage): string | undefined {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'people' && prop.people.length > 0) {
      return prop.people[0].name || undefined
    }
  }
  return undefined
}

/**
 * Convert a Notion page to a Ticket shape for listing.
 */
function notionPageToTicket(page: NotionPage, databaseId: string): Ticket {
  const title = extractTitle(page)
  const status = extractStatus(page)
  const labels = extractLabels(page)
  const assignee = extractAssignee(page)
  const description = extractRichText(page.properties['Description'])

  return {
    id: page.id,
    title,
    description,
    projectId: databaseId,
    projectName: databaseId,
    statusId: status,
    statusName: status,
    owner: assignee,
    assignee,
    subtasks: [],
    labels,
    metadata: {
      external_source: 'notion',
      external_key: page.id,
      external_id: page.id,
      external_url: page.url,
    },
    createdAt: new Date(page.created_time),
    updatedAt: new Date(page.last_edited_time),
  }
}

/**
 * Find the best matching Notion status for a target state name.
 * Uses case-insensitive exact match first, then substring match.
 */
export function findMatchingNotionStatus(
  statuses: Array<{ id: string; name: string }>,
  targetState: string,
): { id: string; name: string } | null {
  const lower = targetState.toLowerCase()

  // 1. Exact match (case-insensitive)
  const exact = statuses.find(s => s.name.toLowerCase() === lower)
  if (exact) return exact

  // 2. Status name contains the target state
  const contains = statuses.find(s => s.name.toLowerCase().includes(lower))
  if (contains) return contains

  // 3. Target state contains the status name
  const reverseContains = statuses.find(s => lower.includes(s.name.toLowerCase()))
  if (reverseContains) return reverseContains

  return null
}
