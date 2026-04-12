/**
 * Transition Map Store
 *
 * Manages the pmo_transition_map table, which stores intent-to-provider-state
 * mappings. Each work primitive (start, ready, ship, stop, drop) has a
 * canonical intent, and this store resolves that intent to whatever state
 * name exists on the connected board.
 *
 * Resolution order (in state-resolution.ts):
 * 1. pmo_transition_map (this store) — explicit user-confirmed mappings
 * 2. state-map.{intent} config override
 * 3. Built-in semantic intent aliases
 * 4. LLM fallback
 * 5. Skip (no match)
 */

import type Database from 'better-sqlite3'
import type { TransitionIntent } from './state-intents.js'

export interface TransitionMapping {
  provider: string
  intent: TransitionIntent
  providerStateName: string
  providerStateId?: string | null
}

/**
 * CRUD operations for the pmo_transition_map table.
 */
export class TransitionMapStore {
  constructor(private db: Database.Database) {}

  /**
   * Get the provider state name mapped to a transition intent.
   * Returns null if no mapping exists.
   */
  getMapping(provider: string, intent: string): TransitionMapping | null {
    try {
      const row = this.db.prepare(`
        SELECT provider, intent, provider_state_name, provider_state_id
        FROM pmo_transition_map
        WHERE provider = ? AND intent = ?
      `).get(provider, intent) as {
        provider: string
        intent: string
        provider_state_name: string
        provider_state_id: string | null
      } | undefined

      if (!row) return null

      return {
        provider: row.provider,
        intent: row.intent as TransitionIntent,
        providerStateName: row.provider_state_name,
        providerStateId: row.provider_state_id,
      }
    } catch {
      return null
    }
  }

  /**
   * Add or update a transition mapping.
   */
  upsertMapping(mapping: TransitionMapping): void {
    this.db.prepare(`
      INSERT INTO pmo_transition_map (provider, intent, provider_state_name, provider_state_id, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(provider, intent) DO UPDATE SET
        provider_state_name = excluded.provider_state_name,
        provider_state_id = excluded.provider_state_id,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      mapping.provider,
      mapping.intent,
      mapping.providerStateName,
      mapping.providerStateId ?? null,
    )
  }

  /**
   * List all transition mappings for a provider.
   */
  listMappings(provider: string): TransitionMapping[] {
    try {
      const rows = this.db.prepare(`
        SELECT provider, intent, provider_state_name, provider_state_id
        FROM pmo_transition_map
        WHERE provider = ?
        ORDER BY intent
      `).all(provider) as Array<{
        provider: string
        intent: string
        provider_state_name: string
        provider_state_id: string | null
      }>

      return rows.map(row => ({
        provider: row.provider,
        intent: row.intent as TransitionIntent,
        providerStateName: row.provider_state_name,
        providerStateId: row.provider_state_id,
      }))
    } catch {
      return []
    }
  }

  /**
   * Remove a specific transition mapping.
   */
  removeMapping(provider: string, intent: string): void {
    this.db.prepare(`
      DELETE FROM pmo_transition_map
      WHERE provider = ? AND intent = ?
    `).run(provider, intent)
  }

  /**
   * Remove all transition mappings for a provider.
   */
  clearMappings(provider: string): void {
    this.db.prepare(`
      DELETE FROM pmo_transition_map
      WHERE provider = ?
    `).run(provider)
  }

  /**
   * Resolve a transition intent to a provider state name.
   * Returns the mapped state name, or null if no mapping exists.
   *
   * This is the primary resolution method called by work commands.
   * If this returns null, the caller should fall through to alias/LLM resolution.
   */
  resolveIntent(provider: string, intent: string): string | null {
    const mapping = this.getMapping(provider, intent)
    return mapping?.providerStateName ?? null
  }
}

/**
 * Result of validating transition map against provider states.
 */
export interface TransitionMapValidation {
  valid: TransitionMapping[]
  missing: TransitionMapping[]
  unmappedIntents: string[]
}

/**
 * Canonical intents that should have mappings for a fully-configured provider.
 */
const EXPECTED_INTENTS: TransitionIntent[] = ['backlog', 'ready', 'started', 'needs_review', 'completed']

/**
 * Validate transition_map entries against the actual provider states.
 * Returns which mappings are valid, which point to missing states,
 * and which intents have no mapping at all.
 *
 * Called on `prlt connect` to flag configuration drift.
 */
export function validateTransitionMap(
  db: Database.Database,
  provider: string,
  providerStateNames: string[],
): TransitionMapValidation {
  const store = new TransitionMapStore(db)
  const mappings = store.listMappings(provider)

  const stateNameSet = new Set(providerStateNames.map(n => n.toLowerCase()))
  const valid: TransitionMapping[] = []
  const missing: TransitionMapping[] = []

  for (const mapping of mappings) {
    if (stateNameSet.has(mapping.providerStateName.toLowerCase())) {
      valid.push(mapping)
    } else {
      missing.push(mapping)
    }
  }

  const mappedIntents = new Set(mappings.map(m => m.intent))
  const unmappedIntents = EXPECTED_INTENTS.filter(i => !mappedIntents.has(i))

  return { valid, missing, unmappedIntents }
}
