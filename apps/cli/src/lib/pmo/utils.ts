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
 * Generate a sequential ID for an entity (e.g., TKT-001, EPIC-001)
 *
 * Uses pmo_settings table to track the next ID for each entity type.
 * IDs are zero-padded to 3 digits (001-999), then expand (1000+).
 *
 * @param db - Database instance with prepare method
 * @param entityType - Type of entity (ticket, epic, spec, project)
 * @returns Generated ID like "TKT-001" or "EPIC-042"
 */
export function generateEntityId(
  db: DatabaseLike,
  entityType: EntityType
): string {
  const prefix = ENTITY_PREFIXES[entityType];
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
  return `${prefix}-${numStr}`;
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
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
