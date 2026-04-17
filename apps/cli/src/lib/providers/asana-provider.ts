/**
 * Asana Ticket Provider
 *
 * Writes ticket operations directly to Asana via REST API,
 * then updates local PMO to keep it in sync.
 *
 * Asana is the source of truth, PMO is best-effort mirror.
 * Board sections map to kanban columns / prlt intents.
 */

import type Database from 'better-sqlite3'
import { AsanaClient } from '../asana/client.js'
import { AsanaMapper } from '../asana/mapper.js'
import { getAsanaAccessToken, loadAsanaConfig } from '../asana/config.js'
import type { AsanaTask } from '../asana/types.js'
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

export class AsanaTicketProvider implements TicketProvider {
  readonly name: TicketProviderName = 'asana'

  constructor(
    private db: Database.Database,
    _storage: ProviderStorage,
    private projectId: string,
  ) {
    // storage param kept for interface compatibility — local PMO mirror
    // removed in PRLT-1327; Asana is the sole source of truth.
    void _storage
  }

  private getAccessTokenOrFail(): string {
    const token = getAsanaAccessToken(this.db)
    if (!token) throw new Error('Asana access token not configured')
    return token
  }

  async moveTicket(ticketId: string, newState: string): Promise<ProviderMoveResult> {
    let token: string
    try {
      token = this.getAccessTokenOrFail()
    } catch {
      return { success: false, provider: 'asana', error: 'Asana access token not configured' }
    }

    // Look up Asana task GID from mapper
    const mapper = new AsanaMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)
    if (!mapping) {
      return { success: false, provider: 'asana', error: `No Asana mapping for ticket ${ticketId}` }
    }

    const client = new AsanaClient(token)

    // Get the task to find its project membership
    const task = await client.getTask(mapping.asanaTaskGid)
    if (!task) {
      return { success: false, provider: 'asana', error: `Asana task ${mapping.asanaTaskGid} not found` }
    }

    // Get the project GID from the mapping or task memberships
    const projectGid = mapping.asanaProjectGid || task.memberships?.[0]?.project?.gid
    if (!projectGid) {
      return { success: false, provider: 'asana', error: 'Cannot determine Asana project for section lookup' }
    }

    // Get project sections and find the matching one for the target state
    let sections: Array<{ gid: string; name: string }>
    try {
      sections = await client.listSections(projectGid)
    } catch (error) {
      return {
        success: false,
        provider: 'asana',
        error: `Failed to list Asana sections: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    const targetSection = findMatchingSection(sections, newState)
    if (!targetSection) {
      return {
        success: false,
        provider: 'asana',
        error: `No matching Asana section for state "${newState}". Available sections: ${sections.map(s => s.name).join(', ')}`,
      }
    }

    // Move the task to the target section
    try {
      await client.addTaskToSection(targetSection.gid, mapping.asanaTaskGid)
    } catch (error) {
      return {
        success: false,
        provider: 'asana',
        error: `Failed to move Asana task to section: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // If the target state looks like a "done" state, mark the task as completed
    if (isCompletedState(newState)) {
      try {
        await client.updateTask(mapping.asanaTaskGid, { name: task.name, completed: true })
      } catch {
        // Non-fatal: section move is the primary action
      }
    }

    // Local PMO mirror removed (PRLT-1327) — Asana is the source of truth

    // Update sync timestamp (best-effort)
    try {
      mapper.updateSyncTimestamp(ticketId)
    } catch {
      // Non-fatal
    }

    return { success: true, provider: 'asana' }
  }

  async deleteTicket(ticketId: string): Promise<ProviderDeleteResult> {
    let token: string
    try {
      token = this.getAccessTokenOrFail()
    } catch {
      return { success: false, provider: 'asana', error: 'Asana access token not configured' }
    }

    // Look up Asana task GID from mapper
    const mapper = new AsanaMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)

    if (mapping) {
      const client = new AsanaClient(token)
      try {
        await client.deleteTask(mapping.asanaTaskGid)
      } catch (error) {
        return {
          success: false,
          provider: 'asana',
          error: `Failed to delete Asana task: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    // Local PMO mirror removed (PRLT-1327) — Asana is the source of truth
    return { success: true, provider: 'asana' }
  }

  async listTickets(_projectId?: string, filter?: TicketFilter): Promise<ProviderListResult> {
    let token: string
    try {
      token = this.getAccessTokenOrFail()
    } catch {
      return { success: false, provider: 'asana', tickets: [], error: 'Asana access token not configured' }
    }

    const asanaConfig = loadAsanaConfig(this.db)
    const projectGid = asanaConfig?.projectGid || process.env.PRLT_ASANA_PROJECT_GID

    if (!projectGid) {
      return { success: false, provider: 'asana', tickets: [], error: 'Asana project GID is required. Run "prlt asana connect" or set PRLT_ASANA_PROJECT_GID.' }
    }

    try {
      const client = new AsanaClient(token)
      const tasks = await client.listTasks(projectGid)

      let tickets: Ticket[] = tasks.map(task => asanaTaskToTicket(task))

      // Apply client-side filters
      if (filter?.priority) {
        tickets = tickets.filter(t => t.priority === filter.priority)
      }
      if (filter?.column) {
        tickets = tickets.filter(t => t.statusName === filter.column)
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

      return { success: true, provider: 'asana', tickets }
    } catch (error) {
      return {
        success: false,
        provider: 'asana',
        tickets: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async createTicket(projectId: string, input: CreateTicketInput): Promise<ProviderCreateResult> {
    let token: string
    try {
      token = this.getAccessTokenOrFail()
    } catch {
      return { success: false, provider: 'asana', error: 'Asana access token not configured' }
    }

    const asanaConfig = loadAsanaConfig(this.db)
    const asanaProjectGid = asanaConfig?.projectGid || process.env.PRLT_ASANA_PROJECT_GID

    if (!asanaProjectGid) {
      return { success: false, provider: 'asana', error: 'Asana project GID is required. Run "prlt asana connect" or set PRLT_ASANA_PROJECT_GID.' }
    }

    try {
      const client = new AsanaClient(token)

      // Create the task in Asana
      const task = await client.createTask({
        name: input.title,
        notes: input.description || undefined,
        projects: [asanaProjectGid],
      })

      // Build a ticket from the Asana response (no local PMO mirror — PRLT-1327)
      const ticket: Ticket = {
        id: task.gid,
        title: task.name,
        description: input.description || undefined,
        projectId: projectId,
        projectName: asanaConfig?.projectName || 'Asana',
        statusId: 'open',
        statusName: 'Open',
        statusCategory: 'unstarted',
        subtasks: [],
        labels: input.labels || [],
        metadata: {
          ...input.metadata,
          'external_source': 'asana',
          'external_id': task.gid,
          'external_key': task.gid,
          'external_url': task.permalink_url || `https://app.asana.com/0/0/${task.gid}`,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Create mapping record for sync operations
      const mapper = new AsanaMapper(this.db)
      mapper.createOrUpdateMapping(ticket.id, task.gid, asanaProjectGid)

      return { success: true, provider: 'asana', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'asana',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async getTicket(ticketId: string): Promise<ProviderGetResult> {
    let token: string
    try {
      token = this.getAccessTokenOrFail()
    } catch {
      return { success: false, provider: 'asana', error: 'Asana access token not configured' }
    }

    // Look up the Asana task GID — it may be the ticketId itself or in the mapper
    const mapper = new AsanaMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)
    const taskGid = mapping?.asanaTaskGid || ticketId

    try {
      const client = new AsanaClient(token)
      const task = await client.getTask(taskGid)
      if (!task) {
        return { success: true, provider: 'asana', ticket: null }
      }
      return { success: true, provider: 'asana', ticket: asanaTaskToTicket(task) }
    } catch (error) {
      return {
        success: false,
        provider: 'asana',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async updateTicket(ticketId: string, input: UpdateTicketInput): Promise<ProviderUpdateResult> {
    let token: string
    try {
      token = this.getAccessTokenOrFail()
    } catch {
      return { success: false, provider: 'asana', error: 'Asana access token not configured' }
    }

    // Look up Asana task GID from mapper
    const mapper = new AsanaMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)
    const taskGid = mapping?.asanaTaskGid || ticketId

    // Build Asana update payload from input fields
    const asanaInput: { name?: string; notes?: string } = {}
    if (input.title !== undefined) asanaInput.name = input.title
    if (input.description !== undefined) asanaInput.notes = input.description ?? undefined

    const client = new AsanaClient(token)

    // Only call Asana API if there are Asana-relevant fields
    if (Object.keys(asanaInput).length > 0) {
      try {
        await client.updateTask(taskGid, asanaInput as { name: string })
      } catch (error) {
        return {
          success: false,
          provider: 'asana',
          error: `Failed to update Asana task: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    // Update sync timestamp (best-effort)
    if (mapping) {
      try {
        mapper.updateSyncTimestamp(ticketId)
      } catch {
        // Non-fatal
      }
    }

    // Return a ticket built from the current Asana state (no local PMO mirror — PRLT-1327)
    try {
      const task = await client.getTask(taskGid)
      if (task) {
        return { success: true, provider: 'asana', ticket: asanaTaskToTicket(task) }
      }
    } catch {
      // Fall through to synthetic ticket
    }

    // Fallback: construct a minimal ticket from the update input
    const ticket: Ticket = {
      id: ticketId,
      title: input.title || ticketId,
      description: input.description ?? undefined,
      projectId: this.projectId,
      projectName: 'Asana',
      statusId: 'open',
      statusName: 'Open',
      statusCategory: 'unstarted',
      subtasks: [],
      labels: input.labels || [],
      metadata: {
        external_source: 'asana',
        external_key: taskGid,
        external_id: taskGid,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    return { success: true, provider: 'asana', ticket }
  }

  async assignTicket(_ticketId: string, _assignee: string): Promise<ProviderAssignResult> {
    // Asana assignment requires a user GID which we don't have.
    // Local PMO mirror is dead (PRLT-1327). Return success — Asana
    // assignment can be done from the Asana UI.
    return { success: true, provider: 'asana' }
  }
}

/**
 * Convert an Asana task to a normalized PMO Ticket.
 */
function asanaTaskToTicket(task: AsanaTask): Ticket {
  const sectionName = task.memberships?.[0]?.section?.name
  const statusName = task.completed ? 'Completed' : (sectionName || 'Open')
  const statusCategory = task.completed ? 'completed' : deriveStatusCategory(sectionName)
  const projectName = task.memberships?.[0]?.project?.name
  const projectGid = task.memberships?.[0]?.project?.gid

  return {
    id: task.gid,
    title: task.name,
    description: task.notes || undefined,
    projectId: projectGid || '',
    projectName: projectName || 'Asana',
    statusId: sectionName || (task.completed ? 'completed' : 'open'),
    statusName,
    statusCategory: statusCategory as Ticket['statusCategory'],
    owner: task.assignee?.name || undefined,
    assignee: task.assignee?.name || undefined,
    subtasks: [],
    labels: (task.tags ?? []).map(t => t.name),
    metadata: {
      external_source: 'asana',
      external_key: task.gid,
      external_id: task.gid,
      external_url: task.permalink_url || `https://app.asana.com/0/0/${task.gid}`,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

/**
 * Derive a PMO status category from an Asana section name.
 * Uses heuristic matching against common section naming patterns.
 */
function deriveStatusCategory(sectionName?: string | null): string {
  if (!sectionName) return 'unstarted'

  const lower = sectionName.toLowerCase()

  // Completed states
  if (lower.includes('done') || lower.includes('complete') || lower.includes('shipped') || lower.includes('closed')) {
    return 'completed'
  }

  // Canceled states
  if (lower.includes('cancel') || lower.includes('won\'t do') || lower.includes('wont do')) {
    return 'canceled'
  }

  // Started states
  if (lower.includes('progress') || lower.includes('doing') || lower.includes('active') || lower.includes('review') || lower.includes('testing')) {
    return 'started'
  }

  // Backlog / unstarted
  if (lower.includes('backlog') || lower.includes('todo') || lower.includes('to do') || lower.includes('icebox') || lower.includes('later')) {
    return 'unstarted'
  }

  // Default to started for unknown section names
  return 'started'
}

/**
 * Find the best matching Asana section for a target state name.
 * Uses case-insensitive exact match first, then substring match.
 */
function findMatchingSection(
  sections: Array<{ gid: string; name: string }>,
  targetState: string,
): { gid: string; name: string } | null {
  const lower = targetState.toLowerCase()

  // 1. Exact match (case-insensitive)
  const exact = sections.find(s => s.name.toLowerCase() === lower)
  if (exact) return exact

  // 2. Section name contains the target state
  const contains = sections.find(s => s.name.toLowerCase().includes(lower))
  if (contains) return contains

  // 3. Target state contains the section name
  const reverseContains = sections.find(s => lower.includes(s.name.toLowerCase()))
  if (reverseContains) return reverseContains

  return null
}

/**
 * Check if a state name represents a completed/done state.
 */
function isCompletedState(stateName: string): boolean {
  const lower = stateName.toLowerCase()
  return lower.includes('done') || lower.includes('complete') || lower.includes('shipped') || lower.includes('closed')
}
