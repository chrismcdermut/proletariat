/**
 * Auto-Mapping — heuristic status mapping generator
 *
 * Given a list of provider statuses (e.g., Trello lists, Linear workflow states,
 * ClickUp statuses), auto-generates mappings to prlt canonical statuses and
 * categories.
 *
 * Canonical statuses (7):
 *   unstarted: Triage, Backlog, Ready
 *   started:   In Progress, Review
 *   completed: Done, Canceled
 *
 * Auto-mapping uses alias matching (case-insensitive, exact then substring)
 * to find the best canonical match for each provider status.
 */

import type { StatusMapping } from './status-mapping.js'
import type { TicketProviderName } from './types.js'
import { ProviderStatusMappingStore } from './status-mapping.js'
import type Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Canonical Status Definitions
// ---------------------------------------------------------------------------

export type StatusCategory = 'unstarted' | 'started' | 'completed'

export interface CanonicalStatusDef {
  name: string
  category: StatusCategory
  aliases: string[]
}

/**
 * Canonical statuses with common aliases across PM tools.
 * Order matters — first match wins when a provider status matches multiple.
 */
export const CANONICAL_STATUSES: CanonicalStatusDef[] = [
  {
    name: 'Triage',
    category: 'unstarted',
    aliases: [
      'triage',
      'new',
      'open',
      'new issues',
      'new functionality requests',
      'unassigned',
      'inbox',
    ],
  },
  {
    name: 'Backlog',
    category: 'unstarted',
    aliases: [
      'backlog',
      'to do',
      'todo',
      'queued',
      'planned',
      'not working on',
      'icebox',
    ],
  },
  {
    name: 'Ready',
    category: 'unstarted',
    aliases: [
      'ready',
      'development ready',
      'ready for dev',
      'selected for development',
      'up next',
      'selected',
      'sprint',
    ],
  },
  {
    name: 'In Progress',
    category: 'started',
    aliases: [
      'in progress',
      'working on',
      'doing',
      'in development',
      'started',
      'active',
      'developing',
      'in work',
      'current',
    ],
  },
  {
    name: 'Review',
    category: 'started',
    aliases: [
      'review',
      'in review',
      'needs review',
      'awaiting review',
      'awaiting feedback',
      'code review',
      'qa',
      'ready for review',
      'pending review',
      'awaiting client feedback',
    ],
  },
  {
    name: 'Done',
    category: 'completed',
    aliases: [
      'done',
      'complete',
      'closed',
      'shipped',
      'merged',
      'resolved',
      'finished',
      'released',
    ],
  },
  {
    name: 'Canceled',
    category: 'completed',
    aliases: [
      'canceled',
      'cancelled',
      "won't do",
      "won't fix",
      'rejected',
      'duplicate',
    ],
  },
]

/**
 * Map from Linear/ClickUp state type to canonical status category.
 * These providers expose a type field on each state.
 */
const STATE_TYPE_TO_CATEGORY: Record<string, StatusCategory> = {
  triage: 'unstarted',
  backlog: 'unstarted',
  unstarted: 'unstarted',
  started: 'started',
  completed: 'completed',
  canceled: 'completed',
  cancelled: 'completed',
  done: 'completed',
  active: 'started',
  closed: 'completed',
  custom: 'started', // Custom states in ClickUp are usually active
}

/**
 * Map from state type to a default canonical status name (fallback).
 */
const STATE_TYPE_TO_DEFAULT_CANONICAL: Record<string, string> = {
  triage: 'Triage',
  backlog: 'Backlog',
  unstarted: 'Backlog',
  started: 'In Progress',
  completed: 'Done',
  canceled: 'Canceled',
  cancelled: 'Canceled',
  done: 'Done',
  active: 'In Progress',
  closed: 'Done',
}

// ---------------------------------------------------------------------------
// Provider Status Input
// ---------------------------------------------------------------------------

export interface ProviderStatus {
  /** The status name as it appears in the provider */
  name: string
  /** Optional state type (Linear: triage/backlog/started/completed/canceled) */
  type?: string
  /** Optional category hint from the provider */
  category?: string
}

// ---------------------------------------------------------------------------
// Auto-Mapping Logic
// ---------------------------------------------------------------------------

/**
 * Find the best canonical status match for a provider status name.
 * Uses case-insensitive exact match first, then substring match.
 *
 * @returns The matching canonical status definition, or null if no match
 */
export function findCanonicalMatch(providerStatusName: string): CanonicalStatusDef | null {
  const lower = providerStatusName.toLowerCase().trim()

  // 1. Exact alias match
  for (const canonical of CANONICAL_STATUSES) {
    if (canonical.aliases.some(a => a === lower)) {
      return canonical
    }
  }

  // 2. Provider status contains an alias
  for (const canonical of CANONICAL_STATUSES) {
    if (canonical.aliases.some(a => lower.includes(a))) {
      return canonical
    }
  }

  // 3. Alias contains the provider status
  for (const canonical of CANONICAL_STATUSES) {
    if (canonical.aliases.some(a => a.includes(lower))) {
      return canonical
    }
  }

  return null
}

/**
 * Generate auto-mappings for a list of provider statuses.
 *
 * For each provider status:
 * 1. Try alias-based matching against canonical statuses
 * 2. If the status has a type field (Linear/ClickUp), use type-based category matching
 * 3. If no match is found, the status is excluded (no mapping generated)
 *
 * @param providerName - The provider name (e.g., 'linear', 'trello', 'clickup')
 * @param statuses - The provider's statuses to map
 * @returns Array of generated StatusMapping objects
 */
export function generateAutoMappings(
  providerName: string,
  statuses: ProviderStatus[],
): StatusMapping[] {
  const mappings: StatusMapping[] = []
  // Track which canonical statuses have been assigned to avoid duplicates
  const assignedCanonicals = new Set<string>()

  // First pass: alias-based matching (high confidence)
  for (const status of statuses) {
    const match = findCanonicalMatch(status.name)
    if (match && !assignedCanonicals.has(match.name)) {
      mappings.push({
        provider: providerName,
        providerStatus: status.name,
        canonicalStatus: match.name,
        canonicalCategory: match.category,
      })
      assignedCanonicals.add(match.name)
    }
  }

  // Second pass: type-based matching for unmatched statuses
  for (const status of statuses) {
    // Skip if already matched in first pass
    if (mappings.some(m => m.providerStatus === status.name)) continue

    const statusType = status.type?.toLowerCase() || status.category?.toLowerCase()
    if (statusType && STATE_TYPE_TO_CATEGORY[statusType]) {
      const category = STATE_TYPE_TO_CATEGORY[statusType]
      const defaultCanonical = STATE_TYPE_TO_DEFAULT_CANONICAL[statusType] || 'In Progress'

      // Find the actual canonical status to use — prefer unassigned ones in the same category
      let canonicalName = defaultCanonical
      if (assignedCanonicals.has(canonicalName)) {
        // Try to find an unassigned canonical in the same category
        const alternatives = CANONICAL_STATUSES.filter(
          c => c.category === category && !assignedCanonicals.has(c.name),
        )
        if (alternatives.length > 0) {
          canonicalName = alternatives[0].name
        }
        // If all canonicals in this category are taken, still create the mapping
        // with the default canonical (multiple provider statuses can map to same canonical)
      }

      mappings.push({
        provider: providerName,
        providerStatus: status.name,
        canonicalStatus: canonicalName,
        canonicalCategory: category,
      })
      assignedCanonicals.add(canonicalName)
    }
  }

  return mappings
}

/**
 * Auto-map provider statuses and persist to the database.
 * Clears any existing mappings for the provider first.
 *
 * @param db - Database instance
 * @param providerName - The provider name
 * @param statuses - The provider's statuses to map
 * @returns The generated mappings
 */
export function autoMapAndPersist(
  db: Database.Database,
  providerName: string,
  statuses: ProviderStatus[],
): StatusMapping[] {
  const store = new ProviderStatusMappingStore(db)
  const mappings = generateAutoMappings(providerName, statuses)

  // Clear existing mappings for this provider
  store.clearMappings(providerName)

  // Persist new mappings
  for (const mapping of mappings) {
    store.upsertMapping(mapping)
  }

  return mappings
}

/**
 * Mapping from prlt intent names to canonical status names.
 * Used by the state resolution engine to look up DB mappings.
 */
export const INTENT_TO_CANONICAL: Record<string, string> = {
  active: 'In Progress',
  review: 'Review',
  done: 'Done',
  blocked: 'Backlog', // Blocked tickets go back to unstarted
  ready: 'Ready',
  groom: 'Ready',
}
