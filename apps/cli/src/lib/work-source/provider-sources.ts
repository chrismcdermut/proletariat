/**
 * Multi-Source Provider Configuration
 *
 * Allows a workspace to have multiple external ticket providers configured
 * simultaneously (e.g. Linear for engineering, Asana for product, Shortcut
 * for design). Each source entry includes a provider type, API key reference,
 * team/project ID, and an identifier prefix used for routing ticket keys to
 * the correct provider.
 *
 * Stored as a JSON array in workspace_settings under the key
 * `work.provider_sources`.
 */

import Database from 'better-sqlite3'
import type { WorkSourceProvider } from './config.js'
import { WORK_SOURCE_PROVIDERS, isWorkSourceProvider } from './config.js'

const SETTINGS_TABLE = 'workspace_settings'
const PROVIDER_SOURCES_KEY = 'work.provider_sources'

// =============================================================================
// Types
// =============================================================================

/**
 * A single provider source entry in the multi-source configuration.
 *
 * Example: { id: 'eng-linear', provider: 'linear', apiKeyRef: 'linear.api_key',
 *            teamProjectId: 'ENG', prefix: 'ENG-', label: 'Engineering' }
 */
export interface ProviderSourceEntry {
  /** Unique identifier for this source config (user-chosen, slug-like) */
  id: string

  /** Provider type (linear, jira, asana, shortcut, trello, monday, clickup) */
  provider: WorkSourceProvider

  /**
   * Reference to the API key. Can be:
   * - A workspace_settings key (e.g. 'linear.api_key')
   * - An environment variable name (e.g. 'PRLT_LINEAR_API_KEY')
   */
  apiKeyRef: string

  /**
   * Team or project identifier in the external system.
   * e.g. Linear team key 'ENG', Jira project key 'PROJ', Asana project GID.
   */
  teamProjectId: string

  /**
   * Prefix used for routing ticket keys to this provider.
   * e.g. 'ENG-' means ticket keys starting with 'ENG-' route to this source.
   * Must end with a separator character (typically '-').
   */
  prefix: string

  /** Optional human-readable label for display purposes */
  label?: string
}

// =============================================================================
// Validation
// =============================================================================

export interface ProviderSourceValidationError {
  field: string
  message: string
}

export function validateProviderSourceEntry(
  entry: Partial<ProviderSourceEntry>,
): ProviderSourceValidationError[] {
  const errors: ProviderSourceValidationError[] = []

  if (!entry.id || entry.id.trim().length === 0) {
    errors.push({ field: 'id', message: 'id is required' })
  } else if (!/^[a-z0-9][a-z0-9_-]*$/.test(entry.id)) {
    errors.push({
      field: 'id',
      message: 'id must be lowercase alphanumeric with hyphens/underscores, starting with a letter or digit',
    })
  }

  if (!entry.provider) {
    errors.push({ field: 'provider', message: 'provider is required' })
  } else if (!isWorkSourceProvider(entry.provider)) {
    errors.push({
      field: 'provider',
      message: `provider must be one of: ${WORK_SOURCE_PROVIDERS.join(', ')}`,
    })
  }

  if (!entry.apiKeyRef || entry.apiKeyRef.trim().length === 0) {
    errors.push({ field: 'apiKeyRef', message: 'apiKeyRef is required' })
  }

  if (!entry.teamProjectId || entry.teamProjectId.trim().length === 0) {
    errors.push({ field: 'teamProjectId', message: 'teamProjectId is required' })
  }

  if (!entry.prefix || entry.prefix.trim().length === 0) {
    errors.push({ field: 'prefix', message: 'prefix is required' })
  }

  return errors
}

// =============================================================================
// Persistence
// =============================================================================

function getRawSetting(db: Database.Database, key: string): string | null {
  const row = db
    .prepare(`SELECT value FROM ${SETTINGS_TABLE} WHERE key = ?`)
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

function setRawSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO ${SETTINGS_TABLE} (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

function deleteRawSetting(db: Database.Database, key: string): void {
  db.prepare(`DELETE FROM ${SETTINGS_TABLE} WHERE key = ?`).run(key)
}

/**
 * Load all provider source entries from the database.
 * Returns an empty array if none are configured.
 */
export function loadProviderSources(db: Database.Database): ProviderSourceEntry[] {
  const raw = getRawSetting(db, PROVIDER_SOURCES_KEY)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as ProviderSourceEntry).id === 'string' &&
        typeof (entry as ProviderSourceEntry).provider === 'string',
    ) as ProviderSourceEntry[]
  } catch {
    return []
  }
}

/**
 * Save the full list of provider source entries to the database.
 */
export function saveProviderSources(db: Database.Database, sources: ProviderSourceEntry[]): void {
  if (sources.length === 0) {
    deleteRawSetting(db, PROVIDER_SOURCES_KEY)
    return
  }
  setRawSetting(db, PROVIDER_SOURCES_KEY, JSON.stringify(sources))
}

/**
 * Add a new provider source entry. Returns validation errors if invalid,
 * or throws if an entry with the same id already exists.
 */
export function addProviderSource(
  db: Database.Database,
  entry: ProviderSourceEntry,
): ProviderSourceValidationError[] {
  const errors = validateProviderSourceEntry(entry)
  if (errors.length > 0) return errors

  const existing = loadProviderSources(db)

  if (existing.some((e) => e.id === entry.id)) {
    return [{ field: 'id', message: `A provider source with id "${entry.id}" already exists` }]
  }

  if (existing.some((e) => e.prefix.toUpperCase() === entry.prefix.toUpperCase())) {
    return [{ field: 'prefix', message: `A provider source with prefix "${entry.prefix}" already exists` }]
  }

  existing.push(entry)
  saveProviderSources(db, existing)
  return []
}

/**
 * Update an existing provider source entry by id.
 * Returns validation errors if the update is invalid, or if the entry is not found.
 */
export function updateProviderSource(
  db: Database.Database,
  id: string,
  updates: Partial<Omit<ProviderSourceEntry, 'id'>>,
): ProviderSourceValidationError[] {
  const sources = loadProviderSources(db)
  const index = sources.findIndex((e) => e.id === id)

  if (index === -1) {
    return [{ field: 'id', message: `No provider source found with id "${id}"` }]
  }

  const merged = { ...sources[index], ...updates }
  const errors = validateProviderSourceEntry(merged)
  if (errors.length > 0) return errors

  // Check prefix uniqueness against other entries
  if (
    updates.prefix &&
    sources.some((e, i) => i !== index && e.prefix.toUpperCase() === updates.prefix!.toUpperCase())
  ) {
    return [{ field: 'prefix', message: `A provider source with prefix "${updates.prefix}" already exists` }]
  }

  sources[index] = merged
  saveProviderSources(db, sources)
  return []
}

/**
 * Remove a provider source entry by id.
 * Returns true if removed, false if not found.
 */
export function removeProviderSource(db: Database.Database, id: string): boolean {
  const sources = loadProviderSources(db)
  const filtered = sources.filter((e) => e.id !== id)

  if (filtered.length === sources.length) return false

  saveProviderSources(db, filtered)
  return true
}

/**
 * Get a single provider source entry by id.
 */
export function getProviderSourceById(
  db: Database.Database,
  id: string,
): ProviderSourceEntry | null {
  const sources = loadProviderSources(db)
  return sources.find((e) => e.id === id) ?? null
}

// =============================================================================
// Prefix-Based Routing
// =============================================================================

/**
 * Resolve which provider source should handle a given ticket key based on
 * its prefix. Matching is case-insensitive and selects the longest matching
 * prefix (most specific match wins).
 *
 * Example: given sources with prefixes ['ENG-', 'PROD-', 'DES-'],
 *   resolveProviderByPrefix(db, 'ENG-123') → source with prefix 'ENG-'
 *   resolveProviderByPrefix(db, 'PROD-456') → source with prefix 'PROD-'
 *   resolveProviderByPrefix(db, 'UNKNOWN-789') → null
 */
export function resolveProviderByPrefix(
  db: Database.Database,
  ticketKey: string,
): ProviderSourceEntry | null {
  const sources = loadProviderSources(db)
  return resolveProviderByPrefixFromList(sources, ticketKey)
}

/**
 * Pure function variant that operates on an in-memory list of sources.
 * Useful for testing and batch operations.
 */
export function resolveProviderByPrefixFromList(
  sources: ProviderSourceEntry[],
  ticketKey: string,
): ProviderSourceEntry | null {
  const upperKey = ticketKey.toUpperCase()
  let bestMatch: ProviderSourceEntry | null = null
  let bestLength = 0

  for (const source of sources) {
    const upperPrefix = source.prefix.toUpperCase()
    if (upperKey.startsWith(upperPrefix) && upperPrefix.length > bestLength) {
      bestMatch = source
      bestLength = upperPrefix.length
    }
  }

  return bestMatch
}

/**
 * Get all configured prefixes and their provider mappings.
 * Useful for displaying the routing table to the user.
 */
export function getRoutingTable(
  db: Database.Database,
): Array<{ prefix: string; provider: WorkSourceProvider; label: string; id: string }> {
  const sources = loadProviderSources(db)
  return sources.map((s) => ({
    prefix: s.prefix,
    provider: s.provider,
    label: s.label ?? s.id,
    id: s.id,
  }))
}

// =============================================================================
// Upsert (for connect commands)
// =============================================================================

/**
 * Create or update a provider source entry by id.
 * Used by connect commands to register the provider as a source after authentication.
 * If an entry with the same id exists, it is replaced. Otherwise a new entry is added.
 */
export function upsertProviderSource(
  db: Database.Database,
  entry: ProviderSourceEntry,
): ProviderSourceValidationError[] {
  const errors = validateProviderSourceEntry(entry)
  if (errors.length > 0) return errors

  const existing = loadProviderSources(db)
  const index = existing.findIndex((e) => e.id === entry.id)

  if (index !== -1) {
    // Check prefix uniqueness against other entries
    if (existing.some((e, i) => i !== index && e.prefix.toUpperCase() === entry.prefix.toUpperCase())) {
      return [{ field: 'prefix', message: `A provider source with prefix "${entry.prefix}" already exists` }]
    }
    existing[index] = entry
    saveProviderSources(db, existing)
    return []
  }

  // New entry – delegate to addProviderSource for uniqueness checks
  return addProviderSource(db, entry)
}

/**
 * Remove all provider source entries for a given provider type.
 * Used by connect --disconnect to clean up provider sources.
 * Returns the number of entries removed.
 */
export function removeProviderSourcesByProvider(
  db: Database.Database,
  provider: WorkSourceProvider,
): number {
  const sources = loadProviderSources(db)
  const filtered = sources.filter((e) => e.provider !== provider)
  const removedCount = sources.length - filtered.length
  saveProviderSources(db, filtered)
  return removedCount
}

// =============================================================================
// API Key Resolution
// =============================================================================

/**
 * Resolve the actual API key value from a ProviderSourceEntry's apiKeyRef.
 *
 * Resolution order:
 * 1. If apiKeyRef matches an environment variable name, use its value
 * 2. If apiKeyRef matches a workspace_settings key, use its value
 * 3. Return null if neither resolves
 */
export function resolveApiKey(
  db: Database.Database,
  entry: ProviderSourceEntry,
): string | null {
  // Try environment variable first
  const envValue = process.env[entry.apiKeyRef]
  if (envValue) return envValue

  // Try workspace_settings key
  const dbValue = getRawSetting(db, entry.apiKeyRef)
  if (dbValue) return dbValue

  return null
}
