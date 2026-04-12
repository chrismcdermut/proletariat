/**
 * Internal types for storage modules.
 * These types are shared between storage modules but not exported publicly.
 *
 * Dead row types (TicketRow, StatusRow, SpecRow, EpicRow, etc.) were removed
 * in PRLT-1299. The provider is now the source of truth for those entities.
 */

import type Database from 'better-sqlite3'
import { DrizzleDB } from '../../database/drizzle.js'
import type { DatabaseDriver } from '../../database/driver.js'

/**
 * Base context passed to all storage modules.
 * Contains both raw SQLite and Drizzle connections for gradual migration.
 * Project ID is passed explicitly to operations.
 */
export interface StorageContext {
  /** Raw better-sqlite3 database connection (for legacy queries) */
  db: Database.Database
  /** DatabaseDriver abstraction (preferred over raw db for new code) */
  driver: DatabaseDriver
  /** Drizzle ORM database connection (for type-safe queries) */
  drizzle: DrizzleDB
  /** Update the board timestamp for a project */
  updateBoardTimestamp: (projectId: string) => void
}

/**
 * Row types for database queries.
 * These mirror the database schema columns.
 */

export interface ProjectRow {
  id: string
  name: string
  template: string | null
  description: string | null
  status: string
  phase_id: string | null
  is_archived: number
  target_date: string | null
  created_at: string
  updated_at: string
}

export interface PhaseRow {
  id: string
  name: string
  category: string
  position: number
  color: string | null
  description: string | null
  is_default: number
  created_at: string
}

export interface PhaseTemplateRow {
  id: string
  name: string
  description: string | null
  is_builtin: number
  phases: string
  created_at: string
}

export interface WorkActionRow {
  id: string
  name: string
  description: string | null
  prompt: string
  end_prompt: string | null
  from_state: string | null
  to_state: string | null
  executor: string | null
  environment: string | null
  permission_mode: string | null
  timeout: number | null
  model: string | null
  review_gate: string | null
  network_allowlist: string | null
  modifies_code: number
  is_default: number
  is_builtin: number
  position: number
  created_at: string
  updated_at: string | null
}

export interface WorkflowRuleRow {
  id: string
  from_state: string | null
  to_state: string
  action_id: string
  trigger: string
  enabled: number
  created_at: string
  updated_at: string | null
}

export interface TicketTemplateRow {
  id: string
  name: string
  description: string | null
  default_title: string | null
  default_description: string | null
  default_priority: string | null
  default_category: string | null
  default_status_id: string | null
  default_assignee: string | null
  default_owner: string | null
  default_labels: string
  suggested_subtasks: string | null
  is_builtin: number
  created_at: string
}

export interface CategoryRow {
  id: string
  name: string
  type: string
  description: string | null
  color: string | null
  position: number
  is_builtin: number
  created_at: string
}

export interface LabelGroupRow {
  id: string
  name: string
  description: string | null
  is_exclusive: number
  is_required: number
  position: number
  created_at: string
}

export interface LabelRow {
  id: string
  name: string
  color: string | null
  description: string | null
  group_id: string | null
  group_name?: string | null
  position: number
  is_builtin: number
  created_at: string
}
