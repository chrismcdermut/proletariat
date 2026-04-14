/**
 * Internal types for storage modules.
 * These types are shared between storage modules but not exported publicly.
 *
 * PRLT-1299: Dead row types removed (tickets, subtasks, specs, epics,
 * workflows, columns, board views, roadmaps, etc.)
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
  workflow_id: string | null
  is_archived: number
  target_date: string | null
  initiative_id: string | null
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

// NOTE: WorkActionRow, WorkflowRuleRow, and TicketTemplateRow were removed in PRLT-1302.
// Those storage modules now use Drizzle ORM's inferred types from drizzle-schema.ts.

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
