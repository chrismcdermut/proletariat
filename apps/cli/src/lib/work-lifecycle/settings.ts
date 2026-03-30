/**
 * Work lifecycle settings — column, priority, and review gate configuration.
 */

import type { ReviewGateMode } from '../pmo/types.js'

/**
 * Database interface for settings access (compatible with better-sqlite3)
 */
interface DatabaseLike {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
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
  backlog: 'Backlog',
} as const;

export type WorkColumnType = keyof typeof DEFAULT_WORK_COLUMNS;

/**
 * Full workflow configuration — the resolved column names for each lifecycle stage.
 * Read from pmo_settings with fallback to DEFAULT_WORK_COLUMNS.
 */
export interface WorkflowConfig {
  planned: string
  in_progress: string
  review: string
  done: string
  backlog: string
}

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
 * Read the full workflow configuration from pmo_settings.
 * Returns configured column names for each lifecycle stage, falling back
 * to DEFAULT_WORK_COLUMNS for any that aren't set.
 *
 * @param db - Database instance
 * @returns WorkflowConfig with resolved column names
 */
export function getWorkflowConfig(db: DatabaseLike): WorkflowConfig {
  return {
    planned: getWorkColumnSetting(db, 'planned'),
    in_progress: getWorkColumnSetting(db, 'in_progress'),
    review: getWorkColumnSetting(db, 'review'),
    done: getWorkColumnSetting(db, 'done'),
    backlog: getWorkColumnSetting(db, 'backlog'),
  }
}

/**
 * Save a full workflow configuration to pmo_settings.
 *
 * @param db - Database instance
 * @param config - Partial workflow config — only provided keys are saved
 */
export function setWorkflowConfig(
  db: DatabaseLike,
  config: Partial<WorkflowConfig>,
): void {
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) {
      setWorkColumnSetting(db, key as WorkColumnType, value)
    }
  }
}

/**
 * Map from short target names (used in presets/actions) to WorkColumnType.
 * Allows presets to use human-friendly names like 'done' or 'review'
 * that resolve to the user's actual column names.
 */
const TARGET_TO_COLUMN_TYPE: Record<string, WorkColumnType> = {
  'done': 'done',
  'review': 'review',
  'in-progress': 'in_progress',
  'in_progress': 'in_progress',
  'ready': 'planned',
  'planned': 'planned',
  'backlog': 'backlog',
}

/**
 * Resolve a workflow target name to the configured column name.
 *
 * Used by the move-ticket action to translate intent-like targets
 * (e.g. 'done', 'review') into the actual column name configured
 * for the workspace (e.g. 'Shipped', 'QA').
 *
 * If the target is not a known intent, returns it unchanged.
 *
 * @param db - Database instance
 * @param target - Target name from preset/action config
 * @returns Resolved column name
 */
export function resolveWorkflowTarget(db: DatabaseLike, target: string): string {
  const columnType = TARGET_TO_COLUMN_TYPE[target.toLowerCase()]
  if (columnType) {
    return getWorkColumnSetting(db, columnType)
  }
  return target
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
