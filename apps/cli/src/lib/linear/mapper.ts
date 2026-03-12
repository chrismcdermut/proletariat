/**
 * Linear Issue ↔ PMO Ticket Mapper
 *
 * Converts Linear issues to PMO tickets and manages the mapping table.
 * Handles import (Linear → PMO) and reverse lookup for sync operations.
 */

import Database from 'better-sqlite3'
import { PMO_TABLES } from '../pmo/schema.js'
import { ExternalExecutionMappingStore } from '../external-issues/mapping-store.js'
import type { ExternalExecutionMapping } from '../external-issues/types.js'
import type { CreateTicketInput, PMOStorage, WorkflowStatus } from '../pmo/types.js'
import type {
  LinearIssue,
  LinearIssueMap,
  LinearSyncResult,
} from './types.js'
import {
  LINEAR_STATE_TO_PMO_CATEGORY,
  LINEAR_PRIORITY_TO_PMO,
} from './types.js'

export class LinearMapper {
  private externalMappingStore: ExternalExecutionMappingStore

  constructor(private db: Database.Database) {
    this.externalMappingStore = new ExternalExecutionMappingStore(db)
    this.ensureTable()
  }

  /**
   * Ensure the linear_issue_map table exists.
   * Uses CREATE TABLE IF NOT EXISTS to match the schema defined in schema.ts.
   */
  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${PMO_TABLES.linear_issue_map} (
        pmo_ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
        linear_issue_id TEXT NOT NULL,
        linear_identifier TEXT NOT NULL,
        linear_team_key TEXT NOT NULL,
        linear_url TEXT NOT NULL,
        sync_direction TEXT NOT NULL DEFAULT 'inbound',
        last_synced_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (pmo_ticket_id),
        UNIQUE (linear_issue_id)
      )
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pmo_linear_issue_map_linear_id
        ON ${PMO_TABLES.linear_issue_map}(linear_issue_id)
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pmo_linear_issue_map_identifier
        ON ${PMO_TABLES.linear_issue_map}(linear_identifier)
    `)
  }

  /**
   * Convert a Linear issue to a PMO ticket creation input.
   * Maps all available Linear fields into the PMO ticket schema:
   *   - title, description, priority, labels, status
   *   - assignee (when available)
   *   - estimate and dueDate (persisted in metadata)
   */
  issueToTicketInput(
    issue: LinearIssue,
    statuses: WorkflowStatus[],
  ): CreateTicketInput {
    // Map Linear state type to PMO state category
    const pmoCategory = LINEAR_STATE_TO_PMO_CATEGORY[issue.state.type] ?? 'backlog'

    // Find matching status by category
    const matchingStatus = statuses.find((s) => s.category === pmoCategory)
    const fallbackStatus = statuses.find((s) => s.isDefault) ?? statuses[0]
    const targetStatus = matchingStatus ?? fallbackStatus

    // Map priority
    const pmoPriority = LINEAR_PRIORITY_TO_PMO[issue.priority] ?? 'P2'

    // Build description with Linear reference
    const descriptionParts: string[] = []
    if (issue.description) {
      descriptionParts.push(issue.description)
    }
    descriptionParts.push('')
    descriptionParts.push(`---`)
    descriptionParts.push(`_Imported from Linear: [${issue.identifier}](${issue.url})_`)

    // Map labels
    const labels = issue.labels.map((l) => l.name)

    // Build metadata with all external references
    const metadata: Record<string, string> = {
      'linear.issue_id': issue.id,
      'linear.identifier': issue.identifier,
      'linear.url': issue.url,
      'linear.team': issue.team.key,
      'linear.state': issue.state.name,
    }

    // Persist estimate in metadata when available
    if (issue.estimate !== undefined) {
      metadata['linear.estimate'] = String(issue.estimate)
    }

    // Persist due date in metadata when available
    if (issue.dueDate) {
      metadata['linear.due_date'] = issue.dueDate
    }

    // Persist assignee info in metadata when available
    if (issue.assignee) {
      metadata['linear.assignee'] = issue.assignee.name
      metadata['linear.assignee_email'] = issue.assignee.email
    }

    return {
      title: issue.title,
      description: descriptionParts.join('\n'),
      priority: pmoPriority,
      statusId: targetStatus?.id,
      assignee: issue.assignee?.name,
      labels,
      metadata,
    }
  }

  /**
   * Import a single Linear issue into PMO as a ticket.
   * Idempotent by external issue ID: creates on first import, updates on subsequent imports.
   * Returns the PMO ticket ID and whether the ticket was created or updated.
   */
  async importIssue(
    issue: LinearIssue,
    projectId: string,
    storage: PMOStorage,
    statuses: WorkflowStatus[],
  ): Promise<{ ticketId: string; created: boolean; updated: boolean }> {
    // Check if already mapped (idempotent by Linear issue ID)
    const existing = this.getByLinearId(issue.id)
    if (existing) {
      // Update the existing PMO ticket with fresh Linear data
      const ticketInput = this.issueToTicketInput(issue, statuses)
      await storage.updateTicket(existing.pmoTicketId, {
        title: ticketInput.title,
        description: ticketInput.description,
        priority: ticketInput.priority,
        assignee: ticketInput.assignee,
        labels: ticketInput.labels ?? [],
        metadata: ticketInput.metadata ?? {},
      })

      // Update sync timestamp
      this.updateSyncTimestamp(existing.pmoTicketId)

      return { ticketId: existing.pmoTicketId, created: false, updated: true }
    }

    // Convert to ticket input
    const ticketInput = this.issueToTicketInput(issue, statuses)

    // Create the PMO ticket
    const ticket = await storage.createTicket(projectId, ticketInput)

    // Record the mapping
    this.createMapping({
      pmoTicketId: ticket.id,
      linearIssueId: issue.id,
      linearIdentifier: issue.identifier,
      linearTeamKey: issue.team.key,
      linearUrl: issue.url,
      syncDirection: 'inbound',
      createdAt: new Date(),
    })

    return { ticketId: ticket.id, created: true, updated: false }
  }

  /**
   * Batch import multiple Linear issues into PMO.
   * Creates new tickets for unmapped issues, updates existing mapped tickets.
   */
  async importIssues(
    issues: LinearIssue[],
    projectId: string,
    storage: PMOStorage,
    statuses: WorkflowStatus[],
  ): Promise<LinearSyncResult> {
    const result: LinearSyncResult = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    }

    for (const issue of issues) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { created, updated } = await this.importIssue(issue, projectId, storage, statuses)
        if (created) {
          result.imported++
        } else if (updated) {
          result.updated++
        } else {
          result.skipped++
        }
      } catch (error) {
        result.errors.push({
          identifier: issue.identifier,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return result
  }

  // ===========================================================================
  // Mapping CRUD
  // ===========================================================================

  /**
   * Create a mapping record.
   */
  createMapping(map: Omit<LinearIssueMap, 'lastSyncedAt'>): void {
    this.db.prepare(`
      INSERT INTO ${PMO_TABLES.linear_issue_map}
        (pmo_ticket_id, linear_issue_id, linear_identifier, linear_team_key, linear_url, sync_direction, last_synced_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      map.pmoTicketId,
      map.linearIssueId,
      map.linearIdentifier,
      map.linearTeamKey,
      map.linearUrl,
      map.syncDirection,
    )

    this.externalMappingStore.upsertMapping({
      provider: 'linear',
      externalId: map.linearIssueId,
      externalKey: map.linearIdentifier,
      canonicalUrl: map.linearUrl,
      latestStateSnapshot: {
        pmoTicketId: map.pmoTicketId,
        linearTeamKey: map.linearTeamKey,
        syncDirection: map.syncDirection,
      },
      lastSyncedAt: new Date(),
    })
  }

  /**
   * Get a mapping by PMO ticket ID.
   */
  getByTicketId(ticketId: string): LinearIssueMap | null {
    const row = this.db.prepare(`
      SELECT * FROM ${PMO_TABLES.linear_issue_map} WHERE pmo_ticket_id = ?
    `).get(ticketId) as Record<string, unknown> | undefined

    return row ? this.rowToMap(row) : null
  }

  /**
   * Get a mapping by Linear issue ID.
   */
  getByLinearId(linearIssueId: string): LinearIssueMap | null {
    const row = this.db.prepare(`
      SELECT * FROM ${PMO_TABLES.linear_issue_map} WHERE linear_issue_id = ?
    `).get(linearIssueId) as Record<string, unknown> | undefined

    if (row) {
      return this.rowToMap(row)
    }

    const mapping = this.externalMappingStore.getByExternalId('linear', linearIssueId)
    return mapping ? this.externalMappingToLinearMap(mapping) : null
  }

  /**
   * Get a mapping by Linear identifier (e.g., "ENG-123").
   */
  getByIdentifier(identifier: string): LinearIssueMap | null {
    const row = this.db.prepare(`
      SELECT * FROM ${PMO_TABLES.linear_issue_map} WHERE linear_identifier = ?
    `).get(identifier) as Record<string, unknown> | undefined

    if (row) {
      return this.rowToMap(row)
    }

    const mapping = this.externalMappingStore.getByExternalKey('linear', identifier)
    return mapping ? this.externalMappingToLinearMap(mapping) : null
  }

  /**
   * List all mappings.
   */
  listMappings(): LinearIssueMap[] {
    const rows = this.db.prepare(`
      SELECT * FROM ${PMO_TABLES.linear_issue_map} ORDER BY created_at DESC
    `).all() as Record<string, unknown>[]

    return rows.map((row) => this.rowToMap(row))
  }

  /**
   * Update the last synced timestamp for a mapping.
   */
  updateSyncTimestamp(pmoTicketId: string): void {
    this.db.prepare(`
      UPDATE ${PMO_TABLES.linear_issue_map}
      SET last_synced_at = CURRENT_TIMESTAMP
      WHERE pmo_ticket_id = ?
    `).run(pmoTicketId)

    const map = this.getByTicketId(pmoTicketId)
    if (map) {
      this.externalMappingStore.upsertMapping({
        provider: 'linear',
        externalId: map.linearIssueId,
        externalKey: map.linearIdentifier,
        canonicalUrl: map.linearUrl,
        latestStateSnapshot: {
          pmoTicketId: map.pmoTicketId,
          linearTeamKey: map.linearTeamKey,
          syncDirection: map.syncDirection,
        },
        lastSyncedAt: new Date(),
      })
    }
  }

  /**
   * Delete a mapping by PMO ticket ID.
   */
  deleteMapping(pmoTicketId: string): void {
    this.db.prepare(`
      DELETE FROM ${PMO_TABLES.linear_issue_map} WHERE pmo_ticket_id = ?
    `).run(pmoTicketId)
  }

  /**
   * Convert a database row to a LinearIssueMap.
   */
  private rowToMap(row: Record<string, unknown>): LinearIssueMap {
    return {
      pmoTicketId: row.pmo_ticket_id as string,
      linearIssueId: row.linear_issue_id as string,
      linearIdentifier: row.linear_identifier as string,
      linearTeamKey: row.linear_team_key as string,
      linearUrl: row.linear_url as string,
      syncDirection: row.sync_direction as LinearIssueMap['syncDirection'],
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
    }
  }

  private externalMappingToLinearMap(row: ExternalExecutionMapping): LinearIssueMap | null {
    const snapshot = row.latestStateSnapshot ?? {}
    const ticketId = typeof snapshot['pmoTicketId'] === 'string' ? snapshot['pmoTicketId'] : null
    if (!ticketId) {
      return null
    }

    const teamKey = typeof snapshot['linearTeamKey'] === 'string'
      ? snapshot['linearTeamKey']
      : (typeof snapshot['teamKey'] === 'string' ? snapshot['teamKey'] : null)
    const resolvedTeamKey = teamKey
      ? teamKey
      : (row.externalKey?.split('-')[0] ?? 'UNKNOWN')
    const syncDirection = typeof snapshot['syncDirection'] === 'string'
      ? snapshot['syncDirection']
      : 'inbound'

    return {
      pmoTicketId: ticketId,
      linearIssueId: row.externalId,
      linearIdentifier: row.externalKey ?? row.externalId,
      linearTeamKey: resolvedTeamKey,
      linearUrl: row.canonicalUrl ?? '',
      syncDirection: syncDirection as LinearIssueMap['syncDirection'],
      lastSyncedAt: row.lastSyncedAt ?? undefined,
      createdAt: row.createdAt,
    }
  }
}
