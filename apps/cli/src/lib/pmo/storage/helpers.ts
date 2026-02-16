/**
 * Helper functions for converting database rows to domain types.
 */

import Database from 'better-sqlite3'
import { PMO_TABLES } from '../schema.js'
import {
  AcceptanceCriterion,
  Comment,
  PMOError,
  Spec,
  StateCategory,
  Ticket,
  normalizePriority,
} from '../types.js'
import {
  AcceptanceCriterionRow,
  CommentRow,
  SpecRow,
  TicketRow,
  WorkflowStatusRow,
} from './types.js'

/**
 * SQLite error with optional code property.
 */
interface SqliteError extends Error {
  code?: string
}

/**
 * Check if an error is a SQLite UNIQUE constraint violation.
 */
function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const sqliteErr = err as SqliteError
  return (
    sqliteErr.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    sqliteErr.message.includes('UNIQUE constraint failed')
  )
}

/**
 * Check if an error is a SQLite FOREIGN KEY constraint violation.
 */
function isForeignKeyConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const sqliteErr = err as SqliteError
  return (
    sqliteErr.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
    sqliteErr.message.includes('FOREIGN KEY constraint failed')
  )
}

/**
 * Check if an error is a SQLite CHECK constraint violation.
 */
function isCheckConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const sqliteErr = err as SqliteError
  return (
    sqliteErr.code === 'SQLITE_CONSTRAINT_CHECK' ||
    sqliteErr.message.includes('CHECK constraint failed')
  )
}

/**
 * Wrap SQLite constraint errors with user-friendly messages.
 * This function always throws - it never returns.
 *
 * @param entityType - The type of entity being operated on (e.g., 'Ticket', 'Spec', 'Project')
 * @param operation - The operation being performed ('create', 'update', 'delete')
 * @param err - The error thrown by SQLite
 * @throws {PMOError} Always throws a user-friendly PMOError
 */
export function wrapSqliteError(
  entityType: string,
  operation: 'create' | 'update' | 'delete',
  err: unknown
): never {
  if (isUniqueConstraintError(err)) {
    if (operation === 'create') {
      throw new PMOError('CONFLICT', `${entityType} with this ID already exists`)
    }
    throw new PMOError('CONFLICT', `${entityType} already exists with that value`)
  }

  if (isForeignKeyConstraintError(err)) {
    if (operation === 'delete') {
      throw new PMOError(
        'CONFLICT',
        `Cannot delete ${entityType.toLowerCase()}: it has dependencies. Remove them first.`
      )
    }
    throw new PMOError(
      'INVALID',
      `Cannot ${operation} ${entityType.toLowerCase()}: referenced entity does not exist`
    )
  }

  if (isCheckConstraintError(err)) {
    throw new PMOError('INVALID', `Invalid ${entityType.toLowerCase()} data: constraint check failed`)
  }

  // Re-throw unknown errors
  throw err
}

const T = PMO_TABLES

/**
 * Convert a database row to a Ticket object.
 * Fetches related data (subtasks, metadata, status info).
 */
export async function rowToTicket(
  db: Database.Database,
  row: TicketRow
): Promise<Ticket> {
  // Get subtasks
  const subtasks = db
    .prepare(`SELECT * FROM ${T.subtasks} WHERE ticket_id = ? ORDER BY position`)
    .all(row.id) as Array<{
    id: string
    title: string
    done: number
  }>

  // Get metadata
  const metaRows = db
    .prepare(`SELECT key, value FROM ${T.ticket_metadata} WHERE ticket_id = ?`)
    .all(row.id) as Array<{ key: string; value: string }>
  const metadata: Record<string, string> = {}
  for (const m of metaRows) {
    metadata[m.key] = m.value
  }

  // Get status info from workflow_statuses
  let statusName: string | undefined
  let statusCategory: StateCategory | undefined
  if (row.status_id) {
    const statusRow = db
      .prepare(`SELECT name, category FROM ${T.workflow_statuses} WHERE id = ?`)
      .get(row.status_id) as { name: string; category: StateCategory } | undefined
    if (statusRow) {
      statusName = statusRow.name
      statusCategory = statusRow.category
    }
  }

  // Map category to deprecated status enum for backward compat
  const categoryToStatus: Record<StateCategory, string> = {
    triage: 'triage',
    backlog: 'backlog',
    unstarted: 'planned',
    started: 'in_progress',
    completed: 'done',
    canceled: 'canceled',
  }
  const status = statusCategory ? categoryToStatus[statusCategory] : 'backlog'

  // Parse labels from JSON
  let labels: string[] = []
  try {
    labels = row.labels ? JSON.parse(row.labels) : []
  } catch {
    labels = []
  }

  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name || undefined,
    title: row.title,
    description: row.description || undefined,
    priority: normalizePriority(row.priority),
    category: row.category || undefined,
    statusId: row.status_id,
    statusName,
    statusCategory,
    status,
    owner: row.owner || undefined,
    assignee: row.assignee || undefined,
    branch: row.branch || undefined,
    specId: row.spec_id || undefined,
    epicId: row.epic_id || undefined,
    subtasks: subtasks.map((st) => ({
      id: st.id,
      title: st.title,
      done: st.done === 1,
    })),
    labels,
    metadata,
    acceptanceCriteria: getAcceptanceCriteriaSync(db, row.id),
    comments: getCommentsSync(db, row.id),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lastSyncedFromSpec: row.last_synced_from_spec
      ? new Date(row.last_synced_from_spec)
      : undefined,
    lastSyncedFromBoard: row.last_synced_from_board
      ? new Date(row.last_synced_from_board)
      : undefined,
    position: row.position !== null ? row.position : undefined,
  }
}

/**
 * Get acceptance criteria for a ticket (sync version).
 */
export function getAcceptanceCriteriaSync(
  db: Database.Database,
  ticketId: string
): AcceptanceCriterion[] {
  const rows = db
    .prepare(
      `SELECT * FROM ${T.ticket_acceptance_criteria} WHERE ticket_id = ? ORDER BY position`
    )
    .all(ticketId) as AcceptanceCriterionRow[]

  return rows.map((row) => ({
    id: row.id,
    ticketId: row.ticket_id,
    criterion: row.criterion,
    verifiable: row.verifiable === 1,
    verified: row.verified === 1,
    verifiedAt: row.verified_at ? new Date(row.verified_at) : undefined,
    verifiedBy: row.verified_by || undefined,
    position: row.position,
  }))
}

/**
 * Convert a database row to a Spec object.
 */
export function rowToSpec(row: SpecRow): Spec {
  return {
    id: row.id,
    title: row.title,
    status: row.status as 'draft' | 'active' | 'implemented',
    type: row.type as 'product' | 'platform' | 'infra' | 'integration' | undefined,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    // Note: dependsOn is now handled via spec_dependencies table, not inline column
    dependsOn: undefined,
    problem: row.problem || undefined,
    solution: row.solution || undefined,
    decisions: row.decisions || undefined,
    notNow: row.not_now || undefined,
    uiUx: row.ui_ux || undefined,
    acceptanceCriteria: row.acceptance_criteria || undefined,
    openQuestions: row.open_questions || undefined,
    requirementsFunctional: row.requirements_functional || undefined,
    requirementsTechnical: row.requirements_technical || undefined,
    context: row.context || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

/**
 * Get comments for a ticket (sync version).
 */
export function getCommentsSync(
  db: Database.Database,
  ticketId: string
): Comment[] {
  try {
    const rows = db
      .prepare(
        `SELECT * FROM ${T.comments} WHERE ticket_id = ? ORDER BY created_at ASC`
      )
      .all(ticketId) as CommentRow[]

    return rows.map((row) => ({
      id: row.id,
      ticketId: row.ticket_id,
      author: row.author || undefined,
      authorType: (row.author_type as 'human' | 'agent' | 'system') || 'human',
      body: row.body,
      parentId: row.parent_id || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }))
  } catch {
    // Table may not exist in older databases during migration
    return []
  }
}

/**
 * Convert a workflow status database row to WorkflowStatus.
 */
export function rowToStatus(row: WorkflowStatusRow) {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    name: row.name,
    category: row.category as StateCategory,
    position: row.position,
    color: row.color || undefined,
    description: row.description || undefined,
    isDefault: row.is_default === 1,
    createdAt: new Date(row.created_at),
  }
}
