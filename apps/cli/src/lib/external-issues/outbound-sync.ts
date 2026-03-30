/**
 * Outbound Sync Utilities
 *
 * With the provider-direct architecture (PRLT-1231), providers write
 * to external APIs directly — there is no event-driven sync layer.
 *
 * This module retains:
 * - findMatchingLinearState() — used by LinearTicketProvider for state matching
 * - OutboundSyncHandler (no-op) — kept for backward compat with callers
 * - initOutboundSync/stopOutboundSync — no-ops
 */

import type Database from 'better-sqlite3'
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
 * OutboundSyncHandler — no-op stub.
 *
 * Providers now write directly to external APIs (PRLT-1231).
 * This class is retained for backward compatibility with callers
 * that construct or reference it.
 */
export class OutboundSyncHandler {
  constructor(_db: Database.Database) {}
  start(): void {}
  stop(): void {}
}

/**
 * Find the best matching Linear workflow state for a status change.
 * Prefers an exact name match (e.g. "In Progress" → "In Progress") over
 * a category-type match (e.g. 'started') to avoid ambiguity when multiple
 * states share the same category.
 */
export function findMatchingLinearState(
  states: Array<{ id: string; name: string; type: string }>,
  statusName: string | null,
  categoryType: string,
): { id: string; name: string; type: string } | undefined {
  const nameMatch = statusName ? states.find((s) => s.name === statusName) : undefined
  return nameMatch ?? states.find((s) => s.type === categoryType)
}

// =============================================================================
// Singleton (no-op — retained for backward compat)
// =============================================================================

let _handler: OutboundSyncHandler | undefined

/**
 * Initialize and start the outbound sync handler (no-op).
 * Providers write directly to external APIs — no event-driven sync needed.
 */
export function initOutboundSync(db: Database.Database): OutboundSyncHandler {
  if (!_handler) {
    _handler = new OutboundSyncHandler(db)
  }
  return _handler
}

/**
 * Stop the outbound sync handler (no-op).
 */
export function stopOutboundSync(): void {
  if (_handler) {
    _handler = undefined
  }
}
