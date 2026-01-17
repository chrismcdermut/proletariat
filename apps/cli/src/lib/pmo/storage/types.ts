/**
 * Internal types for storage modules.
 * These types are shared between storage modules but not exported publicly.
 */

import Database from 'better-sqlite3'

/**
 * Base context passed to all storage modules.
 * Contains the database connection only - project ID is passed explicitly to operations.
 */
export interface StorageContext {
  /** Database connection */
  db: Database.Database
  /** Update the board timestamp for a project */
  updateBoardTimestamp: (projectId: string) => void
}

/**
 * Row types for database queries.
 * These mirror the database schema columns.
 */

export interface TicketRow {
  id: string
  project_id: string
  title: string
  description: string | null
  priority: string | null
  category: string | null
  status_id: string
  owner: string | null
  assignee: string | null
  branch: string | null
  spec_id: string | null
  epic_id: string | null
  labels: string | null
  column_id: string | null
  column_name: string | null
  project_name: string | null
  position: number | null
  created_at: string
  updated_at: string
  last_synced_from_spec: string | null
  last_synced_from_board: string | null
}

export interface StatusRow {
  id: string
  project_id: string
  name: string
  category: string
  position: number
  color: string | null
  description: string | null
  is_default: number
  created_at: string
}

export interface SpecRow {
  id: string
  title: string
  status: string
  type: string | null
  tags: string | null
  depends_on: string | null
  problem: string | null
  solution: string | null
  decisions: string | null
  not_now: string | null
  ui_ux: string | null
  acceptance_criteria: string | null
  open_questions: string | null
  requirements_functional: string | null
  requirements_technical: string | null
  context: string | null
  created_at: string
  updated_at: string
}

export interface EpicRow {
  id: string
  project_id: string
  title: string
  description: string | null
  status: string
  position: number
  file_path: string | null
  spec_id: string | null
  created_at: string
  updated_at: string
}

export interface ProjectRow {
  id: string
  name: string
  template: string | null
  description: string | null
  status: string
  phase_id: string | null
  is_archived: number
  target_date: string | null
  initiative_id: string | null
  created_at: string
  updated_at: string
}

export interface ColumnRow {
  id: string
  project_id: string
  name: string
  position: number
  created_at: string
}

export interface SubtaskRow {
  id: string
  ticket_id: string
  title: string
  done: number
  position: number
}

export interface AcceptanceCriterionRow {
  id: string
  ticket_id: string
  criterion: string
  verifiable: number
  verified: number
  verified_at: string | null
  verified_by: string | null
  position: number
}

export interface WorkflowTemplateRow {
  id: string
  name: string
  description: string | null
  is_builtin: number
  statuses: string
  created_at: string
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
  default_category: string | null
  is_builtin: number
  position: number
  created_at: string
}

export interface BoardViewRow {
  id: string
  project_id: string
  name: string
  description: string | null
  is_default: number
  filters: string | null
  group_by: string | null
  sort_by: string | null
  columns: string | null
  created_at: string
  updated_at: string
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
