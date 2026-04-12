/**
 * Internal types for storage modules.
 * These types are shared between storage modules but not exported publicly.
 */

import type Database from 'better-sqlite3'
import { DrizzleDB } from '../../database/drizzle.js'
import type { DatabaseDriver } from '../../database/driver.js'

/**
 * Base context passed to all storage modules.
 */
export interface StorageContext {
  /** Raw better-sqlite3 database connection (for legacy queries) */
  db: Database.Database
  /** DatabaseDriver abstraction (preferred over raw db for new code) */
  driver: DatabaseDriver
  /** Drizzle ORM database connection (for type-safe queries) */
  drizzle: DrizzleDB
}

/**
 * Row types for database queries.
 */

export interface ProjectRow {
  id: string
  name: string
  template: string | null
  description: string | null
  status: string
  is_archived: number
  target_date: string | null
  created_at: string
  updated_at: string
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
