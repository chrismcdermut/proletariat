/**
 * Helper functions for converting database rows to domain types.
 *
 * PRLT-1299: Removed rowToTicket, rowToSpec, rowToStatus, getAcceptanceCriteriaSync
 * which referenced dead tables (pmoSubtasks, pmoWorkflowStatuses, pmoTicketAcceptanceCriteria, etc.).
 * Only wrapSqliteError and SQLite error helpers remain (still used by projects.ts, templates.ts, actions.ts).
 */

import {
  PMOError,
} from '../types.js'

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
