/**
 * Text and general-purpose utility functions.
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

/**
 * Check if two arrays have the same elements (order-independent)
 */
export function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((val, idx) => val === sortedB[idx])
}
