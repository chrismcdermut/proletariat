/**
 * PMO-internal utility functions.
 *
 * Shared utilities have been relocated:
 * - Text/general: lib/utils/text.ts
 * - Work column/priority/review gate settings: lib/work-lifecycle/settings.ts
 * - External issue metadata: lib/external-issues/utils.ts
 */

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
