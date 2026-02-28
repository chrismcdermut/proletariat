/**
 * Linear Issue ↔ PMO Ticket Mapper
 *
 * Converts Linear issues to PMO tickets and manages the mapping table.
 * Handles import (Linear → PMO) and reverse lookup for sync operations.
 */

import Database from 'better-sqlite3'
import { PMO_TABLES } from '../pmo/schema.js'
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
  constructor(private db: Database.Database) {
    this.ensureTable()
  }

  /**
   * Ensure the linear_issue_map table exists.
   */
  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${PMO_TABLES.linear_issue_map} (
        pmo_ticket_id TEXT NOT NULL,
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
   * Finds the matching workflow status in the project's workflow.
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

    return {
      title: issue.title,
      description: descriptionParts.join('\n'),
      priority: pmoPriority,
      statusId: targetStatus?.id,
      labels,
      metadata: {
        'linear.issue_id': issue.id,
        'linear.identifier': issue.identifier,
        'linear.url': issue.url,
        'linear.team': issue.team.key,
        'linear.state': issue.state.name,
      },
    }
  }

  /**
   * Import a single Linear issue into PMO as a ticket.
   * Returns the PMO ticket ID if created, null if already mapped.
   */
  async importIssue(
    issue: LinearIssue,
    projectId: string,
    storage: PMOStorage,
    statuses: WorkflowStatus[],
  ): Promise<{ ticketId: string; created: boolean }> {
    // Check if already mapped
    const existing = this.getByLinearId(issue.id)
    if (existing) {
      return { ticketId: existing.pmoTicketId, created: false }
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

    return { ticketId: ticket.id, created: true }
  }

  /**
   * Batch import multiple Linear issues into PMO.
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
        const { created } = await this.importIssue(issue, projectId, storage, statuses)
        if (created) {
          result.imported++
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

    return row ? this.rowToMap(row) : null
  }

  /**
   * Get a mapping by Linear identifier (e.g., "ENG-123").
   */
  getByIdentifier(identifier: string): LinearIssueMap | null {
    const row = this.db.prepare(`
      SELECT * FROM ${PMO_TABLES.linear_issue_map} WHERE linear_identifier = ?
    `).get(identifier) as Record<string, unknown> | undefined

    return row ? this.rowToMap(row) : null
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
}
