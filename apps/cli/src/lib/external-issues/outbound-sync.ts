/**
 * Outbound Sync Handler
 *
 * Listens for work-lifecycle domain events on the EventBus and pushes
 * changes to external issue trackers (Linear, Shortcut, etc.) via their
 * respective adapters.
 *
 * Subscribes to work:* events (provider-agnostic), NOT ticket:* events.
 * The work-lifecycle adapter layer translates provider-specific events
 * into these domain events, keeping PMO as just another provider.
 */

import Database from 'better-sqlite3'
import { getEventBus } from '../events/event-bus.js'
import type { WorkStatusChangedEvent, WorkPRCreatedEvent, WorkPRMergedEvent } from '../work-lifecycle/events.js'
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
 * OutboundSyncHandler subscribes to work-lifecycle domain events and
 * pushes changes to mapped external providers. It is fire-and-forget:
 * sync failures are logged but never block the caller.
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
   * Start listening for work-lifecycle events on the global EventBus.
   * Subscribes to work:* domain events, not provider-specific ticket:* events.
   * Call `stop()` to unsubscribe.
   */
  start(): void {
    const bus = getEventBus()

    this.unsubscribers.push(
      bus.on('work:status_changed', (event) => {
        void this.handleStatusChanged(event)
      }),
    )

    this.unsubscribers.push(
      bus.on('work:pr_created', (event) => {
        void this.handlePRLinked(event)
      }),
    )

    this.unsubscribers.push(
      bus.on('work:pr_merged', (event) => {
        void this.handlePRMerged(event)
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
   * Handle a work status change by syncing to all mapped external providers.
   * Skips syncing back to the source provider to avoid loops.
   */
  private async handleStatusChanged(event: WorkStatusChangedEvent): Promise<OutboundSyncResult[]> {
    const results: OutboundSyncResult[] = []

    // Try Linear sync (via Linear-specific mapping table)
    // Skip if the event originated from Linear to avoid loops
    if (event.source !== 'linear') {
      try {
        const linearResult = await this.syncStatusToLinear(event)
        if (linearResult) {
          results.push(linearResult)
        }
      } catch {
        // Sync errors are non-fatal
      }
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
   * Handle a PR creation by syncing to all mapped external providers.
   * Skips syncing back to the source provider to avoid loops.
   */
  private async handlePRLinked(event: WorkPRCreatedEvent): Promise<OutboundSyncResult[]> {
    const results: OutboundSyncResult[] = []

    // Try Linear sync (skip if event came from Linear)
    if (event.source !== 'linear') {
      try {
        const linearResult = await this.syncPRToLinear(event)
        if (linearResult) {
          results.push(linearResult)
        }
      } catch {
        // Sync errors are non-fatal
      }
    }

    // Update provider-agnostic mapping with PR URL
    try {
      this.recordPRInMappings(event)
    } catch {
      // Non-fatal
    }

    return results
  }

  /**
   * Handle a PR merge by syncing to all mapped external providers.
   * Transitions the linked external issue to a completed state.
   */
  private async handlePRMerged(event: WorkPRMergedEvent): Promise<OutboundSyncResult[]> {
    const results: OutboundSyncResult[] = []

    // Try Linear sync (skip if event came from Linear)
    if (event.source !== 'linear') {
      try {
        const linearResult = await this.syncMergeToLinear(event)
        if (linearResult) {
          results.push(linearResult)
        }
      } catch {
        // Sync errors are non-fatal
      }
    }

    // Update provider-agnostic mappings with merged state
    try {
      this.recordMergeInMappings(event)
    } catch {
      // Non-fatal
    }

    return results
  }

  // ===========================================================================
  // Linear Sync
  // ===========================================================================

  /**
   * Sync a status change to Linear if the work item has a Linear mapping.
   */
  private async syncStatusToLinear(event: WorkStatusChangedEvent): Promise<OutboundSyncResult | null> {
    if (!isLinearConfigured(this.db)) return null

    const config = loadLinearConfig(this.db)
    if (!config) return null

    const mapper = new LinearMapper(this.db)
    const mapping = mapper.getByTicketId(event.workItemId)
    if (!mapping) return null

    // Only sync outbound or bidirectional mappings
    if (mapping.syncDirection === 'inbound') return null

    const category = event.newCategory
    if (!category) {
      return { provider: 'linear', success: false, error: 'No status category on work item' }
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
      if (event.newStatus) {
        await client.addComment(
          mapping.linearIssueId,
          `Status updated to **${event.newStatus}** (via prlt)`,
        )
      }

      mapper.updateSyncTimestamp(event.workItemId)
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
   * Sync a PR link to Linear if the work item has a Linear mapping.
   */
  private async syncPRToLinear(event: WorkPRCreatedEvent): Promise<OutboundSyncResult | null> {
    if (!isLinearConfigured(this.db)) return null

    const config = loadLinearConfig(this.db)
    if (!config) return null

    const mapper = new LinearMapper(this.db)
    const mapping = mapper.getByTicketId(event.workItemId)
    if (!mapping) return null

    // Only sync outbound or bidirectional mappings
    if (mapping.syncDirection === 'inbound') return null

    try {
      const client = new LinearClient(config.apiKey)
      const sync = new LinearSync(client, mapper)
      const success = await sync.syncPRLink(
        event.workItemId,
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

  /**
   * Sync a PR merge to Linear if the work item has a Linear mapping.
   * Transitions the issue to "completed" state and posts a merge comment.
   */
  private async syncMergeToLinear(event: WorkPRMergedEvent): Promise<OutboundSyncResult | null> {
    if (!isLinearConfigured(this.db)) return null

    const config = loadLinearConfig(this.db)
    if (!config) return null

    const mapper = new LinearMapper(this.db)
    const mapping = mapper.getByTicketId(event.workItemId)
    if (!mapping) return null

    // Only sync outbound or bidirectional mappings
    if (mapping.syncDirection === 'inbound') return null

    try {
      const client = new LinearClient(config.apiKey)

      // Get Linear team's workflow states
      const team = await client.getTeamByKey(mapping.linearTeamKey)
      if (!team) {
        return { provider: 'linear', success: false, error: `Team not found: ${mapping.linearTeamKey}` }
      }

      const states = await client.listStates(team.id)
      const sync = new LinearSync(client, mapper)
      const success = await sync.syncPRMerge(
        event.workItemId,
        states,
        event.prTitle,
        event.prUrl,
        event.mergeMethod,
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
   * Skips the source provider to avoid sync loops.
   */
  private async syncStatusToMappedProviders(event: WorkStatusChangedEvent): Promise<OutboundSyncResult[]> {
    const results: OutboundSyncResult[] = []

    // Find all external mappings that reference this work item
    const mappings = this.findMappingsForWorkItem(event.workItemId)

    for (const mapping of mappings) {
      // Skip Linear here (handled separately above with its full API integration)
      if (mapping.provider === 'linear') continue
      // Skip the source provider to avoid sync loops
      if (mapping.provider === event.source) continue

      try {
        // Update the state snapshot to reflect the new status
        this.mappingStore.upsertMapping({
          provider: mapping.provider,
          externalId: mapping.externalId,
          latestStateSnapshot: {
            ...((mapping.latestStateSnapshot as Record<string, unknown>) ?? {}),
            ticketStatus: event.newStatus,
            ticketCategory: event.newCategory,
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
   * Record a PR URL in all external mappings for a work item.
   */
  private recordPRInMappings(event: WorkPRCreatedEvent): void {
    const mappings = this.findMappingsForWorkItem(event.workItemId)

    for (const mapping of mappings) {
      // Skip the source provider to avoid sync loops
      if (mapping.provider === event.source) continue

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
   * Record a PR merge in all external mappings for a work item.
   */
  private recordMergeInMappings(event: WorkPRMergedEvent): void {
    const mappings = this.findMappingsForWorkItem(event.workItemId)

    for (const mapping of mappings) {
      // Skip the source provider to avoid sync loops
      if (mapping.provider === event.source) continue

      try {
        this.mappingStore.upsertMapping({
          provider: mapping.provider,
          externalId: mapping.externalId,
          latestStateSnapshot: {
            ...((mapping.latestStateSnapshot as Record<string, unknown>) ?? {}),
            prMerged: true,
            prMergeMethod: event.mergeMethod,
            lastOutboundSync: new Date().toISOString(),
          },
          lastSyncedAt: new Date(),
        })
      } catch {
        // Non-fatal
      }
    }
  }

  /**
   * Find external execution mappings associated with a work item.
   * Checks the latest_state_snapshot for work item ID references.
   */
  private findMappingsForWorkItem(workItemId: string): Array<{
    provider: ExternalMappingProvider
    externalId: string
    latestStateSnapshot: Record<string, unknown> | null
  }> {
    // Query external_execution_map where latest_state_snapshot contains the work item ID
    const rows = this.db.prepare(`
      SELECT provider, external_id, latest_state_snapshot
      FROM pmo_external_execution_map
      WHERE latest_state_snapshot LIKE ?
    `).all(`%${workItemId}%`) as Array<{
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
