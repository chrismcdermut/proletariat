/**
 * PMO Utility Functions
 */

/**
 * Convert a string to a URL-safe slug
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars (except spaces and hyphens)
    .replace(/[\s_]+/g, '-')   // Replace spaces and underscores with hyphens
    .replace(/-+/g, '-')       // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, '')   // Remove leading/trailing hyphens
    .substring(0, 100)         // Limit length
}

/**
 * Format a date as ISO string (date only)
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * Format a date as ISO timestamp
 */
export function formatTimestamp(date: Date): string {
  return date.toISOString()
}

/**
 * Parse an ISO date string
 */
export function parseDate(str: string): Date {
  return new Date(str)
}

/**
 * Entity type prefixes for ID generation
 */
export const ENTITY_PREFIXES = {
  ticket: 'TKT',
  epic: 'EPIC',
  spec: 'SPEC',
  project: 'PROJ',
} as const;

export type EntityType = keyof typeof ENTITY_PREFIXES;

/**
 * Entity type to table name mapping for self-healing ID generation
 */
const ENTITY_TABLES = {
  ticket: 'pmo_tickets',
  epic: 'pmo_epics',
  spec: 'pmo_specs',
  project: 'pmo_projects',
} as const;

/**
 * Database interface for ID generation (compatible with better-sqlite3)
 */
interface DatabaseLike {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
}

/**
 * Generate a sequential ID for an entity.
 *
 * Format: TKT-001, EPIC-001, SPEC-001, PROJ-001
 *
 * Uses pmo_settings table to track the next ID for each entity type.
 * IDs are zero-padded to 3 digits (001-999), then expand (1000+).
 *
 * Self-healing: If counter is behind MAX(id) in the table, auto-corrects.
 *
 * @param db - Database instance with prepare method
 * @param entityType - Type of entity (ticket, epic, spec, project)
 * @returns Generated ID like "TKT-001"
 */
export function generateEntityId(
  db: DatabaseLike,
  entityType: EntityType
): string {
  const typePrefix = ENTITY_PREFIXES[entityType];
  const tableName = ENTITY_TABLES[entityType];
  const settingKey = `next_${entityType}_id`;

  // Get MAX(id) from the entity table for self-healing
  // Extract numeric part: TKT-001 → 1, EPIC-042 → 42
  const prefixLen = typePrefix.length + 1; // e.g., "TKT-" = 4 chars
  const maxResult = db.prepare(
    `SELECT MAX(CAST(SUBSTR(id, ${prefixLen + 1}) AS INTEGER)) as max_num FROM ${tableName}`
  ).get() as { max_num: number | null } | undefined;
  const maxExistingId = maxResult?.max_num || 0;

  // Get current counter
  const row = db.prepare(
    `SELECT value FROM pmo_settings WHERE key = ?`
  ).get(settingKey) as { value: string } | undefined;

  let nextNum = row ? parseInt(row.value, 10) : 1;

  // Self-healing: if counter is behind existing IDs, fix it
  if (nextNum <= maxExistingId) {
    nextNum = maxExistingId + 1;
  }

  // Update counter
  db.prepare(`
    INSERT INTO pmo_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?
  `).run(settingKey, String(nextNum + 1), String(nextNum + 1));

  // Format ID with zero-padding (3 digits minimum)
  const numStr = nextNum.toString().padStart(3, '0');

  return `${typePrefix}-${numStr}`;
}

/**
 * Parsed entity ID components
 */
export interface ParsedEntityId {
  entityType: string;
  number: number;
  raw: string;
}

/**
 * Parse an entity ID into its components.
 *
 * Format: TKT-001 → { entityType: 'TKT', number: 1 }
 *
 * @param id - Entity ID to parse
 * @returns Parsed components, or null if invalid format
 */
export function parseEntityId(id: string): ParsedEntityId | null {
  if (!id) return null;

  const match = id.match(/^([A-Z]+)-(\d+)$/);
  if (match) {
    return {
      entityType: match[1],
      number: parseInt(match[2], 10),
      raw: id,
    };
  }

  return null;
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// =============================================================================
// Work Column Settings
// =============================================================================

/**
 * Default column names for work commands (Linear-style workflow)
 *
 * Linear-style: Backlog → Planned → In Progress → Review → Done
 * - planned: Move tickets here when scheduled/assigned
 * - in_progress: Move tickets here when work starts
 * - review: Move tickets here when work is ready for review
 * - done: Move tickets here when work is complete (reviewed/merged)
 */
export const DEFAULT_WORK_COLUMNS = {
  planned: 'Planned',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
} as const;

export type WorkColumnType = keyof typeof DEFAULT_WORK_COLUMNS;

/**
 * Get a work column setting from pmo_settings with fallback to default.
 * Column matching is case-insensitive.
 *
 * Settings keys:
 * - column_in_progress: Column to move tickets to when work starts
 * - column_review: Column to move tickets to when work is ready for review
 * - column_done: Column to move tickets to when work is complete
 *
 * @param db - Database instance
 * @param columnType - Type of column (in_progress, review, done)
 * @returns The configured column name, or the default if not set
 */
export function getWorkColumnSetting(
  db: DatabaseLike,
  columnType: WorkColumnType
): string {
  const settingKey = `column_${columnType}`;

  const row = db.prepare(
    `SELECT value FROM pmo_settings WHERE key = ?`
  ).get(settingKey) as { value: string } | undefined;

  return row?.value || DEFAULT_WORK_COLUMNS[columnType];
}

/**
 * Set a work column setting in pmo_settings.
 *
 * @param db - Database instance
 * @param columnType - Type of column (in_progress, review, done)
 * @param columnName - Name of the column to use
 */
export function setWorkColumnSetting(
  db: DatabaseLike,
  columnType: WorkColumnType,
  columnName: string
): void {
  const settingKey = `column_${columnType}`;

  db.prepare(`
    INSERT INTO pmo_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?
  `).run(settingKey, columnName, columnName);
}

/**
 * Find a column by configured name (case-insensitive match).
 * Returns the actual column name from the board if found, null otherwise.
 *
 * @param columnNames - Array of column names from the board
 * @param targetColumn - The column name to find (from settings or default)
 * @returns The matching column name, or null if not found
 */
export function findColumnByName(
  columnNames: string[],
  targetColumn: string
): string | null {
  const targetLower = targetColumn.toLowerCase();

  // First try exact match (case-insensitive)
  const exactMatch = columnNames.find(
    col => col.toLowerCase() === targetLower
  );
  if (exactMatch) return exactMatch;

  // Then try partial match (contains)
  const partialMatch = columnNames.find(
    col => col.toLowerCase().includes(targetLower) ||
           targetLower.includes(col.toLowerCase())
  );

  return partialMatch || null;
}

/**
 * Check if two arrays have the same elements (order-independent)
 */
export function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((val, idx) => val === sortedB[idx])
}

// =============================================================================
// Workspace Priority Settings
// =============================================================================

/**
 * Default priority scale (backwards compatible with hardcoded P0-P3).
 */
export const DEFAULT_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const

/**
 * Settings key for storing workspace priorities.
 */
const PRIORITIES_SETTING_KEY = 'priorities'

/**
 * Get the workspace priority scale from pmo_settings.
 * Returns the user-defined priority scale, or DEFAULT_PRIORITIES if not set.
 *
 * Priority values are ordered strings - position in array determines sort order.
 * Index 0 is highest priority.
 *
 * @param db - Database instance
 * @returns Array of priority strings ordered from highest to lowest
 */
export function getWorkspacePriorities(db: DatabaseLike): string[] {
  const row = db.prepare(
    `SELECT value FROM pmo_settings WHERE key = ?`
  ).get(PRIORITIES_SETTING_KEY) as { value: string } | undefined

  if (!row) return [...DEFAULT_PRIORITIES]

  try {
    const parsed = JSON.parse(row.value)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((p: unknown) => typeof p === 'string')) {
      return parsed
    }
    return [...DEFAULT_PRIORITIES]
  } catch {
    return [...DEFAULT_PRIORITIES]
  }
}

/**
 * Set the workspace priority scale in pmo_settings.
 *
 * @param db - Database instance
 * @param priorities - Array of priority strings ordered from highest to lowest
 */
export function setWorkspacePriorities(db: DatabaseLike, priorities: string[]): void {
  const value = JSON.stringify(priorities)

  db.prepare(`
    INSERT INTO pmo_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?
  `).run(PRIORITIES_SETTING_KEY, value, value)
}

/**
 * Check if a value is a valid priority for the workspace.
 *
 * @param db - Database instance
 * @param value - Value to check
 * @returns true if the value is in the workspace priority scale
 */
export function isValidWorkspacePriority(db: DatabaseLike, value: string): boolean {
  const priorities = getWorkspacePriorities(db)
  return priorities.includes(value)
}

/**
 * Get the sort index for a priority value.
 * Returns the position in the priority array (0 = highest priority).
 * Returns Infinity for unknown priorities (sorts last).
 *
 * @param db - Database instance
 * @param value - Priority value
 * @returns Sort index (lower = higher priority)
 */
export function getPrioritySortIndex(db: DatabaseLike, value: string | undefined | null): number {
  if (!value) return Infinity
  const priorities = getWorkspacePriorities(db)
  const index = priorities.indexOf(value)
  return index !== -1 ? index : Infinity
}

// =============================================================================
// Review Gate Settings
// =============================================================================

import type { ReviewGateMode } from './types.js'

/**
 * Valid review gate modes.
 */
export const REVIEW_GATE_MODES: readonly ReviewGateMode[] = ['required', 'auto', 'post'] as const

/**
 * Default review gate mode for workspace.
 */
export const DEFAULT_REVIEW_GATE: ReviewGateMode = 'required'

/**
 * Settings key for workspace-level review gate default.
 */
const REVIEW_GATE_SETTING_KEY = 'review_gate'

/**
 * Get the workspace review gate default from pmo_settings.
 * Returns the configured mode, or 'required' if not set.
 *
 * @param db - Database instance
 * @returns The configured review gate mode
 */
export function getReviewGateSetting(db: DatabaseLike): ReviewGateMode {
  const row = db.prepare(
    `SELECT value FROM pmo_settings WHERE key = ?`
  ).get(REVIEW_GATE_SETTING_KEY) as { value: string } | undefined

  const value = row?.value
  if (value === 'required' || value === 'auto' || value === 'post') {
    return value
  }
  return DEFAULT_REVIEW_GATE
}

/**
 * Set the workspace review gate default in pmo_settings.
 *
 * @param db - Database instance
 * @param mode - Review gate mode to set
 */
export function setReviewGateSetting(db: DatabaseLike, mode: ReviewGateMode): void {
  db.prepare(`
    INSERT INTO pmo_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?
  `).run(REVIEW_GATE_SETTING_KEY, mode, mode)
}

/**
 * Check if a value is a valid review gate mode.
 */
export function isValidReviewGateMode(value: string): value is ReviewGateMode {
  return REVIEW_GATE_MODES.includes(value as ReviewGateMode)
}

/**
 * Resolve the effective review gate mode given the hierarchy of overrides.
 * Most specific wins: per-spawn > per-action > workspace default.
 *
 * @param spawnOverride - Value from --review-gate flag on `prlt work start`
 * @param actionOverride - Value from the action's review_gate column
 * @param db - Database instance for workspace default lookup
 * @returns The resolved review gate mode
 */
export function resolveReviewGate(
  spawnOverride: ReviewGateMode | undefined,
  actionOverride: ReviewGateMode | undefined,
  db: DatabaseLike,
): ReviewGateMode {
  if (spawnOverride) return spawnOverride
  if (actionOverride) return actionOverride
  return getReviewGateSetting(db)
}

// =============================================================================
// External Metadata Helpers
// =============================================================================

/**
 * Extract external issue metadata from a ticket's metadata field.
 * Returns the external source, key (e.g. PRLT-1065), id, and url.
 */
export function getTicketExternalMetadata(ticket: { id: string; metadata?: Record<string, string> | null }): {
  source?: string
  key?: string
  id?: string
  url?: string
} {
  const metadata = (typeof ticket === 'object'
    && ticket !== null
    && 'metadata' in ticket
    && typeof ticket.metadata === 'object'
    && ticket.metadata !== null
    ? ticket.metadata
    : {}) as Record<string, unknown>

  return {
    source: typeof metadata.external_source === 'string' ? metadata.external_source : undefined,
    key: typeof metadata.external_key === 'string' ? metadata.external_key : undefined,
    id: typeof metadata.external_id === 'string' ? metadata.external_id : undefined,
    url: typeof metadata.external_url === 'string' ? metadata.external_url : undefined,
  }
}

/**
 * Resolve the display/branch ticket ID. When a ticket was imported from an
 * external provider (e.g. Linear), the external key (PRLT-xxx) is preferred
 * over the internal PMO ID (TKT-xxx).
 */
export function resolveExternalTicketId(ticket: { id: string; metadata?: Record<string, string> | null }): string {
  const external = getTicketExternalMetadata(ticket)
  return external.key || ticket.id
}

