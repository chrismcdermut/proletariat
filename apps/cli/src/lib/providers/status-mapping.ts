/**
 * Provider Status Mapping
 *
 * Configurable mapping between provider-specific status names and
 * canonical workflow statuses. Each provider (Linear, Jira, Shortcut,
 * Asana, etc.) may use different status vocabularies. This module
 * translates between them.
 *
 * Example mappings:
 *   linear: "In Review" → canonical: "Review"
 *   jira: "Code Review" → canonical: "Review"
 *   asana: "QA" → canonical: "Review"
 *
 * When no mapping is configured, the system falls back to:
 * 1. Exact name match
 * 2. Category-based matching (e.g., 'started' category)
 */

import type Database from 'better-sqlite3'
import type { StateCategory } from '../pmo/types.js'
import type { TicketProviderName } from './types.js'

export interface StatusMapping {
  provider: string
  providerStatus: string
  canonicalStatus: string
  canonicalCategory: StateCategory | null
}

/**
 * ProviderStatusMappingStore manages the pmo_provider_status_map table.
 * Provides CRUD operations for status mappings per provider.
 */
export class ProviderStatusMappingStore {
  constructor(private db: Database.Database) {}

  /**
   * Get the canonical status for a provider-specific status.
   * Returns null if no mapping is configured.
   */
  getCanonicalStatus(provider: string, providerStatus: string): StatusMapping | null {
    try {
      const row = this.db.prepare(`
        SELECT provider, provider_status, canonical_status, canonical_category
        FROM pmo_provider_status_map
        WHERE provider = ? AND LOWER(provider_status) = LOWER(?)
      `).get(provider, providerStatus) as {
        provider: string
        provider_status: string
        canonical_status: string
        canonical_category: string | null
      } | undefined

      if (!row) return null

      return {
        provider: row.provider,
        providerStatus: row.provider_status,
        canonicalStatus: row.canonical_status,
        canonicalCategory: row.canonical_category as StateCategory | null,
      }
    } catch {
      return null
    }
  }

  /**
   * Get the provider-specific status for a canonical status.
   * Returns null if no mapping is configured.
   */
  getProviderStatus(provider: string, canonicalStatus: string): StatusMapping | null {
    try {
      const row = this.db.prepare(`
        SELECT provider, provider_status, canonical_status, canonical_category
        FROM pmo_provider_status_map
        WHERE provider = ? AND LOWER(canonical_status) = LOWER(?)
      `).get(provider, canonicalStatus) as {
        provider: string
        provider_status: string
        canonical_status: string
        canonical_category: string | null
      } | undefined

      if (!row) return null

      return {
        provider: row.provider,
        providerStatus: row.provider_status,
        canonicalStatus: row.canonical_status,
        canonicalCategory: row.canonical_category as StateCategory | null,
      }
    } catch {
      return null
    }
  }

  /**
   * List all status mappings for a provider.
   */
  listMappings(provider: string): StatusMapping[] {
    try {
      const rows = this.db.prepare(`
        SELECT provider, provider_status, canonical_status, canonical_category
        FROM pmo_provider_status_map
        WHERE provider = ?
        ORDER BY canonical_status
      `).all(provider) as Array<{
        provider: string
        provider_status: string
        canonical_status: string
        canonical_category: string | null
      }>

      return rows.map(row => ({
        provider: row.provider,
        providerStatus: row.provider_status,
        canonicalStatus: row.canonical_status,
        canonicalCategory: row.canonical_category as StateCategory | null,
      }))
    } catch {
      return []
    }
  }

  /**
   * Add or update a status mapping for a provider.
   */
  upsertMapping(mapping: StatusMapping): void {
    this.db.prepare(`
      INSERT INTO pmo_provider_status_map (provider, provider_status, canonical_status, canonical_category)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(provider, provider_status) DO UPDATE SET
        canonical_status = excluded.canonical_status,
        canonical_category = excluded.canonical_category
    `).run(
      mapping.provider,
      mapping.providerStatus,
      mapping.canonicalStatus,
      mapping.canonicalCategory,
    )
  }

  /**
   * Remove a specific status mapping.
   */
  removeMapping(provider: string, providerStatus: string): void {
    this.db.prepare(`
      DELETE FROM pmo_provider_status_map
      WHERE provider = ? AND provider_status = ?
    `).run(provider, providerStatus)
  }

  /**
   * Remove all status mappings for a provider.
   */
  clearMappings(provider: string): void {
    this.db.prepare(`
      DELETE FROM pmo_provider_status_map
      WHERE provider = ?
    `).run(provider)
  }

  /**
   * Resolve a status name from a provider to its canonical equivalent.
   * Falls back to the original name if no mapping is found.
   */
  resolveStatus(provider: string, statusName: string): string {
    const mapping = this.getCanonicalStatus(provider, statusName)
    return mapping?.canonicalStatus ?? statusName
  }
}
