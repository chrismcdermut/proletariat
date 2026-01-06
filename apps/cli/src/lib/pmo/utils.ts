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

// =============================================================================
// Conventional Commit Settings
// =============================================================================

/**
 * Standard conventional commit types with descriptions.
 */
export const CONVENTIONAL_COMMIT_TYPES = {
  feat: 'New feature or functionality',
  fix: 'Bug fix',
  docs: 'Documentation changes',
  style: 'Code style changes (formatting, whitespace)',
  refactor: 'Code refactoring (no functional change)',
  perf: 'Performance improvements',
  test: 'Test additions or corrections',
  build: 'Build system or dependency changes',
  ci: 'CI/CD configuration changes',
  chore: 'Maintenance tasks',
  revert: 'Revert a previous commit',
} as const;

export type ConventionalCommitType = keyof typeof CONVENTIONAL_COMMIT_TYPES;

/**
 * Default conventional commit configuration.
 *
 * - types: Allowed commit types (comma-separated or 'all')
 * - requireScope: Whether scope is required in commits
 * - scopeFormat: What to use as scope ('agent', 'ticket', 'none')
 * - requireBody: Whether commit body is required
 * - enforced: Whether to enforce conventional commits
 */
export const DEFAULT_COMMIT_CONFIG = {
  types: 'feat,fix,docs,refactor,test,chore',
  requireScope: false,
  scopeFormat: 'none' as 'agent' | 'ticket' | 'none',
  enforced: true,
} as const;

export type CommitConfigKey = 'types' | 'requireScope' | 'scopeFormat' | 'enforced';

/**
 * Get a commit config setting from pmo_settings with fallback to default.
 *
 * Settings keys:
 * - commit_types: Allowed types (comma-separated, e.g., "feat,fix,docs")
 * - commit_require_scope: Whether scope is required (true/false)
 * - commit_scope_format: Scope format ('agent', 'ticket', 'none')
 * - commit_enforced: Whether conventional commits are enforced (true/false)
 *
 * @param db - Database instance
 * @param configKey - Key of the config option
 * @returns The configured value, or the default if not set
 */
export function getCommitConfigSetting(
  db: DatabaseLike,
  configKey: CommitConfigKey
): string | boolean {
  const keyMap: Record<CommitConfigKey, string> = {
    types: 'commit_types',
    requireScope: 'commit_require_scope',
    scopeFormat: 'commit_scope_format',
    enforced: 'commit_enforced',
  };

  const settingKey = keyMap[configKey];
  const row = db.prepare(
    `SELECT value FROM pmo_settings WHERE key = ?`
  ).get(settingKey) as { value: string } | undefined;

  if (!row) {
    return DEFAULT_COMMIT_CONFIG[configKey];
  }

  // Parse boolean values
  if (configKey === 'requireScope' || configKey === 'enforced') {
    return row.value === 'true';
  }

  return row.value;
}

/**
 * Set a commit config setting in pmo_settings.
 *
 * @param db - Database instance
 * @param configKey - Key of the config option
 * @param value - Value to set
 */
export function setCommitConfigSetting(
  db: DatabaseLike,
  configKey: CommitConfigKey,
  value: string | boolean
): void {
  const keyMap: Record<CommitConfigKey, string> = {
    types: 'commit_types',
    requireScope: 'commit_require_scope',
    scopeFormat: 'commit_scope_format',
    enforced: 'commit_enforced',
  };

  const settingKey = keyMap[configKey];
  const valueStr = String(value);

  db.prepare(`
    INSERT INTO pmo_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?
  `).run(settingKey, valueStr, valueStr);
}

/**
 * Get all commit config settings as an object.
 *
 * @param db - Database instance
 * @returns Object with all commit config settings
 */
export function getAllCommitConfigSettings(db: DatabaseLike): {
  types: string[];
  requireScope: boolean;
  scopeFormat: 'agent' | 'ticket' | 'none';
  enforced: boolean;
} {
  const typesStr = getCommitConfigSetting(db, 'types') as string;
  const types = typesStr === 'all'
    ? Object.keys(CONVENTIONAL_COMMIT_TYPES)
    : typesStr.split(',').map(t => t.trim()).filter(Boolean);

  return {
    types,
    requireScope: getCommitConfigSetting(db, 'requireScope') as boolean,
    scopeFormat: getCommitConfigSetting(db, 'scopeFormat') as 'agent' | 'ticket' | 'none',
    enforced: getCommitConfigSetting(db, 'enforced') as boolean,
  };
}

/**
 * Get the allowed commit types as an array.
 *
 * @param db - Database instance
 * @returns Array of allowed commit type strings
 */
export function getAllowedCommitTypes(db: DatabaseLike): string[] {
  const typesStr = getCommitConfigSetting(db, 'types') as string;
  if (typesStr === 'all') {
    return Object.keys(CONVENTIONAL_COMMIT_TYPES);
  }
  return typesStr.split(',').map(t => t.trim()).filter(Boolean);
}

/**
 * Format commit types with descriptions for display.
 *
 * @param types - Array of commit type strings
 * @returns Formatted string with types and descriptions
 */
export function formatCommitTypesForPrompt(types: string[]): string {
  return types.map(type => {
    const desc = CONVENTIONAL_COMMIT_TYPES[type as ConventionalCommitType];
    return desc ? `- ${type}: ${desc}` : `- ${type}`;
  }).join('\n');
}
