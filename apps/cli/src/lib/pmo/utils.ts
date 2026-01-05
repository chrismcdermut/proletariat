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
// Commit Namespace Settings
// =============================================================================

/**
 * Default commit namespace configuration.
 *
 * - namespace: The prefix to add to commit messages (e.g., "[prlt]")
 * - includeAgent: Whether to include the agent name in the namespace (e.g., "[prlt:altman]")
 * - format: Template for formatting commit messages with namespace
 * - enabled: Whether to apply the namespace prefix to commits
 */
export const DEFAULT_COMMIT_NAMESPACE_CONFIG = {
  namespace: '[prlt]',
  includeAgent: false,
  format: '{namespace} {message}',
  enabled: true,
} as const;

export type CommitNamespaceConfigKey = keyof typeof DEFAULT_COMMIT_NAMESPACE_CONFIG;

/**
 * Get a commit namespace setting from pmo_settings with fallback to default.
 *
 * Settings keys:
 * - commit_namespace: The prefix to add to commits (e.g., "[prlt]" or "[agent]")
 * - commit_include_agent: Whether to include agent name in namespace (true/false)
 * - commit_format: Template for formatting messages (e.g., "{namespace} {message}")
 * - commit_enabled: Whether namespace prefixing is enabled (true/false)
 *
 * @param db - Database instance
 * @param configKey - Key of the config option (namespace, includeAgent, format, enabled)
 * @returns The configured value, or the default if not set
 */
export function getCommitNamespaceSetting<K extends CommitNamespaceConfigKey>(
  db: DatabaseLike,
  configKey: K
): typeof DEFAULT_COMMIT_NAMESPACE_CONFIG[K] {
  const settingKey = `commit_${configKey === 'includeAgent' ? 'include_agent' : configKey}`;

  const row = db.prepare(
    `SELECT value FROM pmo_settings WHERE key = ?`
  ).get(settingKey) as { value: string } | undefined;

  if (!row) {
    return DEFAULT_COMMIT_NAMESPACE_CONFIG[configKey];
  }

  // Parse boolean values
  if (configKey === 'includeAgent' || configKey === 'enabled') {
    return (row.value === 'true') as typeof DEFAULT_COMMIT_NAMESPACE_CONFIG[K];
  }

  return row.value as typeof DEFAULT_COMMIT_NAMESPACE_CONFIG[K];
}

/**
 * Set a commit namespace setting in pmo_settings.
 *
 * @param db - Database instance
 * @param configKey - Key of the config option (namespace, includeAgent, format, enabled)
 * @param value - Value to set
 */
export function setCommitNamespaceSetting<K extends CommitNamespaceConfigKey>(
  db: DatabaseLike,
  configKey: K,
  value: typeof DEFAULT_COMMIT_NAMESPACE_CONFIG[K]
): void {
  const settingKey = `commit_${configKey === 'includeAgent' ? 'include_agent' : configKey}`;
  const valueStr = String(value);

  db.prepare(`
    INSERT INTO pmo_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?
  `).run(settingKey, valueStr, valueStr);
}

/**
 * Get all commit namespace settings as an object.
 *
 * @param db - Database instance
 * @returns Object with all commit namespace settings
 */
export function getAllCommitNamespaceSettings(db: DatabaseLike): {
  namespace: string;
  includeAgent: boolean;
  format: string;
  enabled: boolean;
} {
  return {
    namespace: getCommitNamespaceSetting(db, 'namespace'),
    includeAgent: getCommitNamespaceSetting(db, 'includeAgent'),
    format: getCommitNamespaceSetting(db, 'format'),
    enabled: getCommitNamespaceSetting(db, 'enabled'),
  };
}

/**
 * Build a commit message with the configured namespace prefix.
 *
 * Uses the commit namespace settings to format the message:
 * - If enabled=false, returns the original message unchanged
 * - If includeAgent=true and agentName is provided, includes agent name in namespace
 * - Applies the format template to construct the final message
 *
 * @param db - Database instance
 * @param message - The original commit message
 * @param agentName - Optional agent name to include in namespace
 * @returns The formatted commit message with namespace prefix
 *
 * @example
 * // With namespace="[prlt]", includeAgent=false, format="{namespace} {message}"
 * buildCommitMessage(db, "feat: add login") // "[prlt] feat: add login"
 *
 * @example
 * // With namespace="[prlt]", includeAgent=true, format="{namespace} {message}"
 * buildCommitMessage(db, "feat: add login", "altman") // "[prlt:altman] feat: add login"
 */
export function buildCommitMessage(
  db: DatabaseLike,
  message: string,
  agentName?: string
): string {
  const settings = getAllCommitNamespaceSettings(db);

  // If namespace is disabled, return original message
  if (!settings.enabled) {
    return message;
  }

  // Build the namespace prefix
  let namespace = settings.namespace;
  if (settings.includeAgent && agentName) {
    // Insert agent name into namespace, e.g., "[prlt]" -> "[prlt:altman]"
    // Handle different namespace formats
    if (namespace.endsWith(']')) {
      namespace = namespace.slice(0, -1) + ':' + agentName + ']';
    } else if (namespace.endsWith(')')) {
      namespace = namespace.slice(0, -1) + ':' + agentName + ')';
    } else {
      namespace = namespace + ':' + agentName;
    }
  }

  // Apply the format template
  return settings.format
    .replace('{namespace}', namespace)
    .replace('{message}', message);
}
