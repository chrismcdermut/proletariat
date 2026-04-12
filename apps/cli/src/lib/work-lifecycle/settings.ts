/**
 * Workflow Settings — Configuration types and readers for workflow column mapping.
 *
 * Delegates to pmo/utils.ts for actual DB reads; this module adds the
 * WorkflowConfig aggregate type used by the reconciler and other callers
 * that need all column names at once.
 */

import { getWorkColumnSetting } from '../pmo/utils.js'

/**
 * Minimal database interface compatible with SqliteDatabase.
 */
interface DatabaseLike {
  prepare(sql: string): {
    get(...params: unknown[]): unknown
    run(...params: unknown[]): unknown
  }
}

/**
 * Full workflow configuration — the resolved column names for each lifecycle stage.
 * Read from pmo_settings with fallback to DEFAULT_WORK_COLUMNS.
 */
export interface WorkflowConfig {
  planned: string
  in_progress: string
  review: string
  done: string
}

/**
 * Read the full workflow configuration from pmo_settings.
 * Returns configured column names for each lifecycle stage, falling back
 * to DEFAULT_WORK_COLUMNS for any that aren't set.
 */
export function getWorkflowConfig(db: DatabaseLike): WorkflowConfig {
  return {
    planned: getWorkColumnSetting(db, 'planned'),
    in_progress: getWorkColumnSetting(db, 'in_progress'),
    review: getWorkColumnSetting(db, 'review'),
    done: getWorkColumnSetting(db, 'done'),
  }
}
