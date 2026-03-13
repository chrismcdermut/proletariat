/**
 * Outbound Sync Handler
 *
 * Listens for ticket state changes on the EventBus and pushes them
 * to external issue trackers (Linear, Shortcut, etc.) via their
 * respective adapters.
 *
 * The handler is provider-agnostic: it resolves which external provider
 * a ticket is mapped to, then dispatches to the correct sync implementation.
 */

import Database from 'better-sqlite3'
import { getEventBus } from '../events/event-bus.js'
import type { TicketStatusChangedEvent, TicketPRLinkedEvent } from '../events/events.js'
import { LinearClient } from '../linear/client.js'
import { LinearMapper } from '../linear/mapper.js'
import { LinearSync } from '../linear/sync.js'
import { loadLinearConfig, isLinearConfigured } from '../linear/config.js'
import { ExternalExecutionMappingStore } from './mapping-store.js'
import type { ExternalMappingProvider } from './types.js'

/**
 * Result of an outbound sync attempt for a single event.
 */
export interface OutboundSyncResult {
  provider: ExternalMappingProvider
  success: boolean
  error?: string
}

/**
 * OutboundSyncHandler subscribes to ticket events and pushes changes
 * to mapped external providers. It is fire-and-forget: sync failures
 * are logged but never block the caller.
 */
export class OutboundSyncHandler {
  private unsubscribers: Array<() => void> = []
  private db: Database.Database
  private mappingStore: ExternalExecutionMappingStore

  constructor(db: Database.Database) {
    this.db = db
    this.mappingStore = new ExternalExecutionMappingStore(db)
  }

  /**
   * Start listening for ticket events on the global EventBus.
   * Call `stop()` to unsubscribe.
   */
  start(): void {
    const bus = getEventBus()

    this.unsubscribers.push(
      bus.on('ticket:status_changed', (event) => {
        void this.handleStatusChanged(event)
      }),
    )

    this.unsubscribers.push(
      bus.on('ticket:pr_linked', (event) => {
        void this.handlePRLinked(event)
      }),
    )
  }

  /**
   * Stop listening for events and clean up.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
  }

  /**
   * Handle a ticket status change by syncing to all mapped external providers.
   */
  private async handleStatusChanged(event: TicketStatusChangedEvent): Promise<OutboundSyncResult[]> {
    const results: OutboundSyncResult[] = []

    // Try Linear sync (via Linear-specific mapping table)
    try {
      const linearResult = await this.syncStatusToLinear(event)
      if (linearResult) {
        results.push(linearResult)
      }
    } catch {
      // Sync errors are non-fatal
    }

    // Try provider-agnostic sync via external_execution_map
    try {
      const genericResults = await this.syncStatusToMappedProviders(event)
      results.push(...genericResults)
    } catch {
      // Sync errors are non-fatal
    }

    return results
  }

  /**
   * Handle a PR link by syncing to all mapped external providers.
   */
  private async handlePRLinked(event: TicketPRLinkedEvent): Promise<OutboundSyncResult[]> {
    const results: OutboundSyncResult[] = []

    // Try Linear sync
    try {
      const linearResult = await this.syncPRToLinear(event)
      if (linearResult) {
        results.push(linearResult)
      }
    } catch {
      // Sync errors are non-fatal
    }

    // Update provider-agnostic mapping with PR URL
    try {
      this.recordPRInMappings(event)
    } catch {
      // Non-fatal
    }

    return results
  }

  // ===========================================================================
  // Linear Sync
  // ===========================================================================

  /**
   * Sync a status change to Linear if the ticket has a Linear mapping.
   */
  private async syncStatusToLinear(event: TicketStatusChangedEvent): Promise<OutboundSyncResult | null> {
    if (!isLinearConfigured(this.db)) return null

    const config = loadLinearConfig(this.db)
    if (!config) return null

    const mapper = new LinearMapper(this.db)
    const mapping = mapper.getByTicketId(event.ticketId)
    if (!mapping) return null

    // Only sync outbound or bidirectional mappings
    if (mapping.syncDirection === 'inbound') return null

    const category = event.newStatusCategory
    if (!category) {
      return { provider: 'linear', success: false, error: 'No status category on ticket' }
    }

    try {
      const client = new LinearClient(config.apiKey)

      // Get Linear team's workflow states
      const team = await client.getTeamByKey(mapping.linearTeamKey)
      if (!team) {
        return { provider: 'linear', success: false, error: `Team not found: ${mapping.linearTeamKey}` }
      }

      const states = await client.listStates(team.id)
      const matchingState = states.find((s) => s.type === category)

      if (!matchingState) {
        return { provider: 'linear', success: false, error: `No Linear state for category: ${category}` }
      }

      await client.updateIssueState(mapping.linearIssueId, matchingState.id)

      // Post a comment about the status change
      if (event.newStatusName) {
        await client.addComment(
          mapping.linearIssueId,
          `Status updated to **${event.newStatusName}** (via prlt)`,
        )
      }

      mapper.updateSyncTimestamp(event.ticketId)
      return { provider: 'linear', success: true }
    } catch (err) {
      return {
        provider: 'linear',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Sync a PR link to Linear if the ticket has a Linear mapping.
   */
  private async syncPRToLinear(event: TicketPRLinkedEvent): Promise<OutboundSyncResult | null> {
    if (!isLinearConfigured(this.db)) return null

    const config = loadLinearConfig(this.db)
    if (!config) return null

    const mapper = new LinearMapper(this.db)
    const mapping = mapper.getByTicketId(event.ticketId)
    if (!mapping) return null

    // Only sync outbound or bidirectional mappings
    if (mapping.syncDirection === 'inbound') return null

    try {
      const client = new LinearClient(config.apiKey)
      const sync = new LinearSync(client, mapper)
      const success = await sync.syncPRLink(
        event.ticketId,
        event.prUrl,
        event.prTitle ?? 'Pull Request',
      )

      return { provider: 'linear', success }
    } catch (err) {
      return {
        provider: 'linear',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // ===========================================================================
  // Provider-Agnostic Sync
  // ===========================================================================

  /**
   * Sync status changes to providers tracked via the external_execution_map table.
   * Updates the state snapshot so that future inbound syncs can detect drift.
   */
  private async syncStatusToMappedProviders(event: TicketStatusChangedEvent): Promise<OutboundSyncResult[]> {
    const results: OutboundSyncResult[] = []

    // Find all external mappings that reference this ticket via execution links
    // or via the latest_state_snapshot containing the ticketId
    const mappings = this.findMappingsForTicket(event.ticketId)

    for (const mapping of mappings) {
      // Skip Linear here (handled separately above with its full API integration)
      if (mapping.provider === 'linear') continue

      try {
        // Update the state snapshot to reflect the new status
        this.mappingStore.upsertMapping({
          provider: mapping.provider,
          externalId: mapping.externalId,
          latestStateSnapshot: {
            ...((mapping.latestStateSnapshot as Record<string, unknown>) ?? {}),
            ticketStatus: event.newStatusName,
            ticketCategory: event.newStatusCategory,
            lastOutboundSync: new Date().toISOString(),
          },
          lastSyncedAt: new Date(),
        })

        results.push({ provider: mapping.provider, success: true })
      } catch (err) {
        results.push({
          provider: mapping.provider,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return results
  }

  /**
   * Record a PR URL in all external mappings for a ticket.
   */
  private recordPRInMappings(event: TicketPRLinkedEvent): void {
    const mappings = this.findMappingsForTicket(event.ticketId)

    for (const mapping of mappings) {
      try {
        this.mappingStore.upsertMapping({
          provider: mapping.provider,
          externalId: mapping.externalId,
          prUrl: event.prUrl,
          lastSyncedAt: new Date(),
        })
      } catch {
        // Non-fatal
      }
    }
  }

  /**
   * Find external execution mappings associated with a ticket.
   * Checks the latest_state_snapshot for pmoTicketId references.
   */
  private findMappingsForTicket(ticketId: string): Array<{
    provider: ExternalMappingProvider
    externalId: string
    latestStateSnapshot: Record<string, unknown> | null
  }> {
    // Query external_execution_map where latest_state_snapshot contains the ticketId
    const rows = this.db.prepare(`
      SELECT provider, external_id, latest_state_snapshot
      FROM pmo_external_execution_map
      WHERE latest_state_snapshot LIKE ?
    `).all(`%${ticketId}%`) as Array<{
      provider: ExternalMappingProvider
      external_id: string
      latest_state_snapshot: string | null
    }>

    return rows.map((row) => ({
      provider: row.provider,
      externalId: row.external_id,
      latestStateSnapshot: row.latest_state_snapshot ? parseSnapshot(row.latest_state_snapshot) : null,
    }))
  }
}

function parseSnapshot(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore
  }
  return null
}

// =============================================================================
// Singleton
// =============================================================================

let _handler: OutboundSyncHandler | undefined

/**
 * Initialize and start the outbound sync handler.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initOutboundSync(db: Database.Database): OutboundSyncHandler {
  if (!_handler) {
    _handler = new OutboundSyncHandler(db)
    _handler.start()
  }
  return _handler
}

/**
 * Stop the outbound sync handler (primarily for testing).
 */
export function stopOutboundSync(): void {
  if (_handler) {
    _handler.stop()
    _handler = undefined
  }
}
