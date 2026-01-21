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
 * With workstream prefix: PLT-TKT-001, PLT-EPIC-001
 * Without prefix (legacy): TKT-001, EPIC-001
 *
 * Uses pmo_settings table to track the next ID for each entity type.
 * IDs are zero-padded to 3 digits (001-999), then expand (1000+).
 *
 * @param db - Database instance with prepare method
 * @param entityType - Type of entity (ticket, epic, spec, project)
 * @param workstreamPrefix - Optional workstream prefix (e.g., 'PLT')
 * @returns Generated ID like "PLT-TKT-001" or "TKT-001" (legacy)
 */
export function generateEntityId(
  db: DatabaseLike,
  entityType: EntityType,
  workstreamPrefix?: string
): string {
  const typePrefix = ENTITY_PREFIXES[entityType];
  const settingKey = `next_${entityType}_id`;

  // Get current counter
  const row = db.prepare(
    `SELECT value FROM pmo_settings WHERE key = ?`
  ).get(settingKey) as { value: string } | undefined;

  const nextNum = row ? parseInt(row.value, 10) : 1;

  // Update counter
  db.prepare(`
    INSERT INTO pmo_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?
  `).run(settingKey, String(nextNum + 1), String(nextNum + 1));

  // Format ID with zero-padding (3 digits minimum)
  const numStr = nextNum.toString().padStart(3, '0');

  // Include workstream prefix if provided
  if (workstreamPrefix) {
    return `${workstreamPrefix}-${typePrefix}-${numStr}`;
  }
  return `${typePrefix}-${numStr}`;
}

/**
 * Parsed entity ID components
 */
export interface ParsedEntityId {
  workstreamPrefix?: string;
  entityType: string;
  number: number;
  raw: string;
}

/**
 * Parse an entity ID into its components.
 *
 * Handles both formats:
 * - With workstream prefix: PLT-TKT-001 → { workstreamPrefix: 'PLT', entityType: 'TKT', number: 1 }
 * - Legacy format: TKT-001 → { entityType: 'TKT', number: 1 }
 *
 * @param id - Entity ID to parse
 * @returns Parsed components, or null if invalid format
 */
export function parseEntityId(id: string): ParsedEntityId | null {
  if (!id) return null;

  // Try PLT-TKT-001 format first (with workstream prefix)
  const fullMatch = id.match(/^([A-Z]{2,4})-([A-Z]+)-(\d+)$/);
  if (fullMatch) {
    return {
      workstreamPrefix: fullMatch[1],
      entityType: fullMatch[2],
      number: parseInt(fullMatch[3], 10),
      raw: id,
    };
  }

  // Fall back to TKT-001 format (legacy, no prefix)
  const shortMatch = id.match(/^([A-Z]+)-(\d+)$/);
  if (shortMatch) {
    return {
      entityType: shortMatch[1],
      number: parseInt(shortMatch[2], 10),
      raw: id,
    };
  }

  return null;
}

/**
 * Format entity ID for display.
 *
 * In single-workstream context, strips the workstream prefix for cleaner display.
 * In cross-workstream context (or when showFull is true), shows the full ID.
 *
 * @param id - Full entity ID (e.g., PLT-TKT-001)
 * @param currentWorkstreamPrefix - Current workstream prefix (to determine if we can strip it)
 * @param showFull - Force showing full ID even in single-workstream context
 * @returns Display-friendly ID (e.g., TKT-001 or PLT-TKT-001)
 */
export function formatEntityIdForDisplay(
  id: string,
  currentWorkstreamPrefix?: string,
  showFull: boolean = false
): string {
  if (showFull || !currentWorkstreamPrefix) return id;

  const parsed = parseEntityId(id);
  if (!parsed) return id;

  // Strip prefix if it matches the current workstream
  if (parsed.workstreamPrefix?.toUpperCase() === currentWorkstreamPrefix.toUpperCase()) {
    const numStr = parsed.number.toString().padStart(3, '0');
    return `${parsed.entityType}-${numStr}`;
  }

  return id;
}

/**
 * Check if an ID has a workstream prefix.
 */
export function hasWorkstreamPrefix(id: string): boolean {
  const parsed = parseEntityId(id);
  return parsed?.workstreamPrefix !== undefined;
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
 * Linear-style: Backlog → Planned → In Progress → Done
 * - planned: Move tickets here when scheduled/assigned
 * - in_progress: Move tickets here when work starts
 * - done: Move tickets here when work is complete (includes review/merged)
 */
export const DEFAULT_WORK_COLUMNS = {
  planned: 'Planned',
  in_progress: 'In Progress',
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

