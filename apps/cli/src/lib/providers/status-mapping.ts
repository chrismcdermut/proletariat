/**
 * Provider Status Mapping
 *
 * PRLT-1299: The pmo_provider_status_map table has been removed.
 * All methods are stubbed to return null/empty for backward compatibility.
 * Status mapping is now handled by the provider directly.
 */

import type Database from 'better-sqlite3'
import type { StateCategory } from '../pmo/types.js'

export interface StatusMapping {
  provider: string
  providerStatus: string
  canonicalStatus: string
  canonicalCategory: StateCategory | null
}

/**
 * ProviderStatusMappingStore — stub implementation (PRLT-1299).
 * The pmo_provider_status_map table has been dropped.
 * All methods return empty/null to avoid breaking callers.
 */
export class ProviderStatusMappingStore {
  constructor(_db: Database.Database) {}

  getCanonicalStatus(_provider: string, _providerStatus: string): StatusMapping | null {
    return null
  }

  getProviderStatus(_provider: string, _canonicalStatus: string): StatusMapping | null {
    return null
  }

  listMappings(_provider: string): StatusMapping[] {
    return []
  }

  upsertMapping(_mapping: StatusMapping): void {
    // No-op: table removed (PRLT-1299)
  }

  removeMapping(_provider: string, _providerStatus: string): void {
    // No-op: table removed (PRLT-1299)
  }

  clearMappings(_provider: string): void {
    // No-op: table removed (PRLT-1299)
  }

  resolveStatus(_provider: string, statusName: string): string {
    return statusName
  }
}
