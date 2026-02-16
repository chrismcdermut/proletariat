/**
 * Comment operations for tickets.
 * Supports agent handoffs, review feedback, and Linear comment sync.
 */

import { randomUUID } from 'node:crypto'
import { PMO_TABLES } from '../schema.js'
import { PMOError, Comment } from '../types.js'
import { StorageContext, CommentRow } from './types.js'
import { wrapSqliteError } from './helpers.js'

const T = PMO_TABLES

export class CommentStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Add a comment to a ticket.
   */
  async addComment(
    ticketId: string,
    body: string,
    opts?: { author?: string; authorType?: 'human' | 'agent' | 'system'; parentId?: string }
  ): Promise<Comment> {
    // Verify ticket exists and get project_id
    const ticket = this.ctx.db.prepare(`
      SELECT id, project_id FROM ${T.tickets} WHERE id = ?
    `).get(ticketId) as { id: string; project_id: string } | undefined

    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    // If parentId provided, verify the parent comment exists and belongs to this ticket
    if (opts?.parentId) {
      const parent = this.ctx.db.prepare(`
        SELECT id FROM ${T.comments} WHERE id = ? AND ticket_id = ?
      `).get(opts.parentId, ticketId) as { id: string } | undefined

      if (!parent) {
        throw new PMOError('NOT_FOUND', `Parent comment not found: ${opts.parentId}`)
      }
    }

    const id = `cmt-${randomUUID()}`
    const now = new Date().toISOString()
    const authorType = opts?.authorType || 'human'

    try {
      this.ctx.db.prepare(`
        INSERT INTO ${T.comments} (id, ticket_id, author, author_type, body, parent_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ticketId, opts?.author || null, authorType, body, opts?.parentId || null, now, now)
    } catch (err) {
      wrapSqliteError('Comment', 'create', err)
    }

    // Update ticket timestamp
    this.ctx.db.prepare(`
      UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?
    `).run(now, ticketId)

    this.ctx.updateBoardTimestamp(ticket.project_id)

    return {
      id,
      ticketId,
      author: opts?.author,
      authorType,
      body,
      parentId: opts?.parentId,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  }

  /**
   * List all comments on a ticket, ordered by creation time.
   */
  async listComments(ticketId: string): Promise<Comment[]> {
    // Verify ticket exists
    const ticket = this.ctx.db.prepare(`
      SELECT id FROM ${T.tickets} WHERE id = ?
    `).get(ticketId) as { id: string } | undefined

    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    const rows = this.ctx.db.prepare(`
      SELECT * FROM ${T.comments} WHERE ticket_id = ? ORDER BY created_at ASC
    `).all(ticketId) as CommentRow[]

    return rows.map((row) => rowToComment(row))
  }

  /**
   * Delete a comment.
   */
  async deleteComment(commentId: string): Promise<void> {
    // Get comment to find ticket_id for timestamp update
    const comment = this.ctx.db.prepare(`
      SELECT ticket_id FROM ${T.comments} WHERE id = ?
    `).get(commentId) as { ticket_id: string } | undefined

    if (!comment) {
      throw new PMOError('NOT_FOUND', `Comment not found: ${commentId}`)
    }

    // Get ticket's project_id for board timestamp update
    const ticket = this.ctx.db.prepare(`
      SELECT project_id FROM ${T.tickets} WHERE id = ?
    `).get(comment.ticket_id) as { project_id: string } | undefined

    const result = this.ctx.db.prepare(`
      DELETE FROM ${T.comments} WHERE id = ?
    `).run(commentId)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Comment not found: ${commentId}`)
    }

    // Update ticket timestamp
    this.ctx.db.prepare(`
      UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), comment.ticket_id)

    if (ticket) {
      this.ctx.updateBoardTimestamp(ticket.project_id)
    }
  }
}

/**
 * Convert a database row to a Comment object.
 */
function rowToComment(row: CommentRow): Comment {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    author: row.author || undefined,
    authorType: (row.author_type as 'human' | 'agent' | 'system') || 'human',
    body: row.body,
    parentId: row.parent_id || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

/**
 * Get comments for a ticket (sync version for use in rowToTicket).
 */
export function getCommentsSync(
  db: import('better-sqlite3').Database,
  ticketId: string
): Comment[] {
  const rows = db
    .prepare(`SELECT * FROM ${T.comments} WHERE ticket_id = ? ORDER BY created_at ASC`)
    .all(ticketId) as CommentRow[]

  return rows.map((row) => rowToComment(row))
}
