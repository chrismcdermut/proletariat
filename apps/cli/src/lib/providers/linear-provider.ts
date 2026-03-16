/**
 * Linear Ticket Provider
 *
 * Writes ticket state changes directly to Linear via API,
 * then updates local PMO to keep it in sync.
 *
 * Emits work:status_changed with source='linear' so the outbound sync
 * handler skips Linear (avoiding double-write).
 */

import type Database from 'better-sqlite3'
import { LinearClient } from '../linear/client.js'
import { LinearMapper } from '../linear/mapper.js'
import { getLinearApiKey } from '../linear/config.js'
import { findMatchingLinearState } from '../external-issues/outbound-sync.js'
import type { PostExecutionStorage } from '../work-lifecycle/post-execution.js'
import type { TicketProvider, ProviderMoveResult } from './types.js'

export class LinearTicketProvider implements TicketProvider {
  readonly name = 'linear' as const

  constructor(
    private db: Database.Database,
    private storage: PostExecutionStorage,
    private projectId: string,
    private ticketStatusCategory: string | null,
  ) {}

  async moveTicket(ticketId: string, newState: string): Promise<ProviderMoveResult> {
    // 1. Get Linear API key
    const apiKey = getLinearApiKey(this.db)
    if (!apiKey) {
      return { success: false, provider: 'linear', error: 'Linear API key not configured' }
    }

    // 2. Look up Linear mapping for this PMO ticket
    const mapper = new LinearMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)
    if (!mapping) {
      return { success: false, provider: 'linear', error: `No Linear mapping for ticket ${ticketId}` }
    }

    // 3. Get Linear team's workflow states
    const client = new LinearClient(apiKey)

    let team: { id: string; key: string; name: string } | null
    try {
      team = await client.getTeamByKey(mapping.linearTeamKey)
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: `Failed to get Linear team: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    if (!team) {
      return { success: false, provider: 'linear', error: `Linear team not found: ${mapping.linearTeamKey}` }
    }

    let states: Array<{ id: string; name: string; type: string }>
    try {
      states = await client.listStates(team.id)
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: `Failed to list Linear states: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // 4. Find the matching Linear state for the target PMO state
    // Map PMO status category to Linear state type for category matching
    const categoryType = mapPMOStateToLinearType(newState)
    const matchingState = findMatchingLinearState(states, newState, categoryType)

    if (!matchingState) {
      return {
        success: false,
        provider: 'linear',
        error: `No matching Linear state for "${newState}" (category: ${categoryType})`,
      }
    }

    // 5. Update the issue state on Linear
    try {
      await client.updateIssueState(mapping.linearIssueId, matchingState.id)
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: `Failed to update Linear issue: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // 6. Also update local PMO to keep it in sync
    try {
      await this.storage.moveTicket(this.projectId, ticketId, newState)
    } catch {
      // Non-fatal: Linear is the source of truth, local PMO is best-effort
    }

    // 7. Post a comment about the status change
    try {
      await client.addComment(
        mapping.linearIssueId,
        `Status updated to **${newState}** (via prlt post-execution transition)`,
      )
    } catch {
      // Non-fatal: comment is informational
    }

    // 8. Update sync timestamp
    try {
      mapper.updateSyncTimestamp(ticketId)
    } catch {
      // Non-fatal
    }

    return { success: true, provider: 'linear' }
  }
}

/**
 * Map a PMO status name to the most likely Linear state type.
 * Used as a fallback when exact name matching fails.
 */
function mapPMOStateToLinearType(stateName: string): string {
  const lower = stateName.toLowerCase()
  if (lower.includes('review') || lower.includes('in progress') || lower.includes('started')) {
    return 'started'
  }
  if (lower.includes('done') || lower.includes('complete') || lower.includes('merged')) {
    return 'completed'
  }
  if (lower.includes('backlog')) {
    return 'backlog'
  }
  if (lower.includes('cancel')) {
    return 'canceled'
  }
  if (lower.includes('triage')) {
    return 'triage'
  }
  // Default to started for unknown states (most post-execution transitions go forward)
  return 'started'
}
