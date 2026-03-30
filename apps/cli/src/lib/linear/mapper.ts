/**
 * Linear Issue ↔ PMO Ticket Mapper
 *
 * Converts Linear issues to PMO tickets and manages the mapping table.
 * Handles import (Linear → PMO) and reverse lookup for sync operations.
 */

import type Database from 'better-sqlite3'
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
import { type DatabaseDriver, wrapDatabase } from '../database/driver.js'

function toDriver(dbOrDriver: DatabaseDriver | Database.Database): DatabaseDriver {
  if ('prepare' in dbOrDriver && 'pragma' in dbOrDriver && !('raw' in dbOrDriver)) {
    return wrapDatabase(dbOrDriver as Database.Database)
  }
  return dbOrDriver as DatabaseDriver
}

export class LinearMapper {
  private driver: DatabaseDriver
  private externalMappingStore: ExternalExecutionMappingStore

  constructor(dbOrDriver: DatabaseDriver | Database.Database) {
    this.driver = toDriver(dbOrDriver)
    this.externalMappingStore = new ExternalExecutionMappingStore(this.driver)
    this.ensureTable()
  }

  /**
   * Ensure the external_issue_map table exists.
   * Uses CREATE TABLE IF NOT EXISTS to match the schema defined in schema.ts.
   */
  private ensureTable(): void {
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS ${PMO_TABLES.external_issue_map} (
        pmo_ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('linear', 'jira', 'shortcut', 'trello', 'github')),
        external_id TEXT NOT NULL,
        external_key TEXT NOT NULL,
        external_url TEXT NOT NULL,
        team_key TEXT NOT NULL,
        sync_direction TEXT NOT NULL DEFAULT 'inbound',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (pmo_ticket_id, provider),
        UNIQUE (provider, external_id)
      )
    `)
    this.driver.exec(`
      CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_external_id
        ON ${PMO_TABLES.external_issue_map}(provider, external_id)
    `)
    this.driver.exec(`
      CREATE INDEX IF NOT EXISTS idx_pmo_external_issue_map_external_key_eim
        ON ${PMO_TABLES.external_issue_map}(provider, external_key)
    `)
  }

  /**
   * Convert a Linear issue to a PMO ticket creation input.
   * Finds the matching workflow status in the project's workflow.
   * Maps all available fields: title, description, priority, labels,
   * assignee, estimate, and due date.
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

    // Build metadata with external references
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
   * Creates a new ticket if no mapping exists, or updates the existing
   * ticket when the issue has already been imported (idempotent by
   * external issue ID). Returns the PMO ticket ID and whether it was
   * newly created or updated.
   */
  async importIssue(
    issue: LinearIssue,
    projectId: string,
    storage: PMOStorage,
    statuses: WorkflowStatus[],
  ): Promise<{ ticketId: string; created: boolean; updated: boolean }> {
    // Check if already mapped (idempotent by external issue id)
    const existing = this.getByLinearId(issue.id)
    if (existing) {
      // Update the existing PMO ticket with latest Linear data (including status)
      const ticketInput = this.issueToTicketInput(issue, statuses)
      await storage.updateTicket(existing.pmoTicketId, {
        title: ticketInput.title,
        description: ticketInput.description,
        priority: ticketInput.priority,
        statusId: ticketInput.statusId,
        assignee: ticketInput.assignee,
        labels: ticketInput.labels ?? [],
        metadata: ticketInput.metadata ?? {},
      })
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
    this.driver.prepare(`
      INSERT INTO ${PMO_TABLES.external_issue_map}
        (pmo_ticket_id, provider, external_id, external_key, external_url, team_key, sync_direction, created_at)
      VALUES (?, 'linear', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      map.pmoTicketId,
      map.linearIssueId,
      map.linearIdentifier,
      map.linearUrl,
      map.linearTeamKey,
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
    const row = this.driver.prepare(`
      SELECT * FROM ${PMO_TABLES.external_issue_map} WHERE pmo_ticket_id = ? AND provider = 'linear'
    `).get(ticketId) as Record<string, unknown> | undefined

    return row ? this.rowToMap(row) : null
  }

  /**
   * Get a mapping by Linear issue ID.
   */
  getByLinearId(linearIssueId: string): LinearIssueMap | null {
    const row = this.driver.prepare(`
      SELECT * FROM ${PMO_TABLES.external_issue_map} WHERE provider = 'linear' AND external_id = ?
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
    const row = this.driver.prepare(`
      SELECT * FROM ${PMO_TABLES.external_issue_map} WHERE provider = 'linear' AND external_key = ?
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
    const rows = this.driver.prepare(`
      SELECT * FROM ${PMO_TABLES.external_issue_map} WHERE provider = 'linear' ORDER BY created_at DESC
    `).all() as Record<string, unknown>[]

    return rows.map((row) => this.rowToMap(row))
  }

  /**
   * Update the last synced timestamp for a mapping.
   */
  updateSyncTimestamp(pmoTicketId: string): void {
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
    this.driver.prepare(`
      DELETE FROM ${PMO_TABLES.external_issue_map} WHERE pmo_ticket_id = ? AND provider = 'linear'
    `).run(pmoTicketId)
  }

  /**
   * Convert a database row to a LinearIssueMap.
   */
  private rowToMap(row: Record<string, unknown>): LinearIssueMap {
    return {
      pmoTicketId: row.pmo_ticket_id as string,
      linearIssueId: row.external_id as string,
      linearIdentifier: row.external_key as string,
      linearTeamKey: row.team_key as string,
      linearUrl: row.external_url as string,
      syncDirection: row.sync_direction as LinearIssueMap['syncDirection'],
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
