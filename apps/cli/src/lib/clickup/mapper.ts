/**
 * ClickUp Task ↔ PMO Ticket Mapper
 *
 * Converts ClickUp tasks to PMO tickets and manages the mapping table.
 * Handles import (ClickUp → PMO) and reverse lookup for sync operations.
 */

import Database from 'better-sqlite3'
import { ExternalExecutionMappingStore } from '../external-issues/mapping-store.js'
import type { ExternalExecutionMapping } from '../external-issues/types.js'
import type { CreateTicketInput, PMOStorage, WorkflowStatus } from '../pmo/types.js'
import type { ClickUpTask, ClickUpTaskMap } from './types.js'
import { CLICKUP_PRIORITY_TO_PMO, CLICKUP_STATUS_TYPE_TO_PMO_CATEGORY } from './types.js'

const CLICKUP_TASK_MAP_TABLE = 'pmo_clickup_task_map'

export class ClickUpMapper {
  private externalMappingStore: ExternalExecutionMappingStore

  constructor(private db: Database.Database) {
    this.externalMappingStore = new ExternalExecutionMappingStore(db)
    this.ensureTable()
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${CLICKUP_TASK_MAP_TABLE} (
        pmo_ticket_id TEXT NOT NULL,
        clickup_task_id TEXT NOT NULL,
        clickup_list_id TEXT NOT NULL,
        clickup_space_id TEXT,
        sync_direction TEXT NOT NULL DEFAULT 'inbound',
        last_synced_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (pmo_ticket_id),
        UNIQUE (clickup_task_id)
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pmo_clickup_task_map_task_id
        ON ${CLICKUP_TASK_MAP_TABLE}(clickup_task_id)
    `)
  }

  /**
   * Convert a ClickUp task to a PMO ticket creation input.
   */
  taskToTicketInput(
    task: ClickUpTask,
    statuses: WorkflowStatus[],
  ): CreateTicketInput {
    // Map ClickUp status type to PMO state category
    const pmoCategory = CLICKUP_STATUS_TYPE_TO_PMO_CATEGORY[task.status.type] ?? 'backlog'

    // Find matching status by category
    const matchingStatus = statuses.find((s) => s.category === pmoCategory)
    const fallbackStatus = statuses.find((s) => s.isDefault) ?? statuses[0]
    const targetStatus = matchingStatus ?? fallbackStatus

    // Map priority
    const pmoPriority = task.priority
      ? (CLICKUP_PRIORITY_TO_PMO[task.priority.id] ?? 'P2')
      : 'P3'

    // Build description with ClickUp reference
    const descriptionParts: string[] = []
    if (task.description) {
      descriptionParts.push(task.description)
    }
    descriptionParts.push('')
    descriptionParts.push('---')
    descriptionParts.push(`_Imported from ClickUp: [${task.name}](${task.url})_`)

    // Map tags to labels
    const labels = task.tags.map((t) => t.name)

    // Build metadata
    const metadata: Record<string, string> = {
      'clickup.task_id': task.id,
      'clickup.url': task.url,
      'clickup.list_id': task.list.id,
      'clickup.list_name': task.list.name,
      'clickup.status': task.status.status,
    }

    if (task.custom_id) {
      metadata['clickup.custom_id'] = task.custom_id
    }

    if (task.due_date) {
      metadata['clickup.due_date'] = task.due_date
    }

    return {
      title: task.name,
      description: descriptionParts.join('\n'),
      priority: pmoPriority,
      statusId: targetStatus?.id,
      assignee: task.assignees[0]?.username,
      labels,
      metadata,
    }
  }

  /**
   * Import a single ClickUp task into PMO as a ticket.
   */
  async importTask(
    task: ClickUpTask,
    projectId: string,
    storage: PMOStorage,
    statuses: WorkflowStatus[],
  ): Promise<{ ticketId: string; created: boolean; updated: boolean }> {
    // Check if already mapped
    const existing = this.getByClickUpId(task.id)
    if (existing) {
      const ticketInput = this.taskToTicketInput(task, statuses)
      await storage.updateTicket(existing.pmoTicketId, {
        title: ticketInput.title,
        description: ticketInput.description,
        priority: ticketInput.priority,
        assignee: ticketInput.assignee,
        labels: ticketInput.labels ?? [],
        metadata: ticketInput.metadata ?? {},
      })
      this.updateSyncTimestamp(existing.pmoTicketId)
      return { ticketId: existing.pmoTicketId, created: false, updated: true }
    }

    // Convert to ticket input and create
    const ticketInput = this.taskToTicketInput(task, statuses)
    const ticket = await storage.createTicket(projectId, ticketInput)

    // Record the mapping
    this.createMapping({
      pmoTicketId: ticket.id,
      clickupTaskId: task.id,
      clickupListId: task.list.id,
      clickupSpaceId: task.space.id,
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    return { ticketId: ticket.id, created: true, updated: false }
  }

  // ===========================================================================
  // Mapping CRUD
  // ===========================================================================

  createMapping(map: Omit<ClickUpTaskMap, 'lastSyncedAt'>): void {
    this.db.prepare(`
      INSERT INTO ${CLICKUP_TASK_MAP_TABLE}
        (pmo_ticket_id, clickup_task_id, clickup_list_id, clickup_space_id, sync_direction, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      map.pmoTicketId,
      map.clickupTaskId,
      map.clickupListId,
      map.clickupSpaceId ?? null,
      map.syncDirection,
    )

    this.externalMappingStore.upsertMapping({
      provider: 'clickup',
      externalId: map.clickupTaskId,
      externalKey: map.clickupTaskId,
      canonicalUrl: '',
      latestStateSnapshot: {
        pmoTicketId: map.pmoTicketId,
        clickupListId: map.clickupListId,
        clickupSpaceId: map.clickupSpaceId,
        syncDirection: map.syncDirection,
      },
      lastSyncedAt: new Date(),
    })
  }

  getByTicketId(ticketId: string): ClickUpTaskMap | null {
    const row = this.db.prepare(`
      SELECT * FROM ${CLICKUP_TASK_MAP_TABLE} WHERE pmo_ticket_id = ?
    `).get(ticketId) as Record<string, unknown> | undefined

    return row ? this.rowToMap(row) : null
  }

  getByClickUpId(clickupTaskId: string): ClickUpTaskMap | null {
    const row = this.db.prepare(`
      SELECT * FROM ${CLICKUP_TASK_MAP_TABLE} WHERE clickup_task_id = ?
    `).get(clickupTaskId) as Record<string, unknown> | undefined

    if (row) {
      return this.rowToMap(row)
    }

    const mapping = this.externalMappingStore.getByExternalId('clickup', clickupTaskId)
    return mapping ? this.externalMappingToClickUpMap(mapping) : null
  }

  listMappings(): ClickUpTaskMap[] {
    const rows = this.db.prepare(`
      SELECT * FROM ${CLICKUP_TASK_MAP_TABLE} ORDER BY created_at DESC
    `).all() as Record<string, unknown>[]

    return rows.map((row) => this.rowToMap(row))
  }

  updateSyncTimestamp(pmoTicketId: string): void {
    this.db.prepare(`
      UPDATE ${CLICKUP_TASK_MAP_TABLE} SET last_synced_at = CURRENT_TIMESTAMP WHERE pmo_ticket_id = ?
    `).run(pmoTicketId)

    const map = this.getByTicketId(pmoTicketId)
    if (map) {
      this.externalMappingStore.upsertMapping({
        provider: 'clickup',
        externalId: map.clickupTaskId,
        externalKey: map.clickupTaskId,
        canonicalUrl: '',
        latestStateSnapshot: {
          pmoTicketId: map.pmoTicketId,
          clickupListId: map.clickupListId,
          clickupSpaceId: map.clickupSpaceId,
          syncDirection: map.syncDirection,
        },
        lastSyncedAt: new Date(),
      })
    }
  }

  deleteMapping(pmoTicketId: string): void {
    this.db.prepare(`
      DELETE FROM ${CLICKUP_TASK_MAP_TABLE} WHERE pmo_ticket_id = ?
    `).run(pmoTicketId)
  }

  private rowToMap(row: Record<string, unknown>): ClickUpTaskMap {
    return {
      pmoTicketId: row.pmo_ticket_id as string,
      clickupTaskId: row.clickup_task_id as string,
      clickupListId: row.clickup_list_id as string,
      clickupSpaceId: (row.clickup_space_id as string) || undefined,
      syncDirection: row.sync_direction as ClickUpTaskMap['syncDirection'],
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
    }
  }

  private externalMappingToClickUpMap(mapping: ExternalExecutionMapping): ClickUpTaskMap | null {
    const snapshot = mapping.latestStateSnapshot ?? {}
    const ticketId = typeof snapshot['pmoTicketId'] === 'string' ? snapshot['pmoTicketId'] : null
    if (!ticketId) return null

    return {
      pmoTicketId: ticketId,
      clickupTaskId: mapping.externalId,
      clickupListId: typeof snapshot['clickupListId'] === 'string' ? snapshot['clickupListId'] : '',
      clickupSpaceId: typeof snapshot['clickupSpaceId'] === 'string' ? snapshot['clickupSpaceId'] : undefined,
      syncDirection: (typeof snapshot['syncDirection'] === 'string'
        ? snapshot['syncDirection']
        : 'inbound') as ClickUpTaskMap['syncDirection'],
      lastSyncedAt: mapping.lastSyncedAt ?? undefined,
      createdAt: mapping.createdAt,
    }
  }
}
