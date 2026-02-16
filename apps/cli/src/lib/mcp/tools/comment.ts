/**
 * MCP Comment Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, successResponse, strictTool } from '../helpers.js'

export function registerCommentTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'ticket_add_comment',
    'Add a comment to a ticket. Use for implementation notes, review feedback, agent handoffs, or system status updates.',
    {
      ticket_id: z.string().describe('Ticket ID'),
      body: z.string().describe('Comment text'),
      author: z.string().optional().describe('Author name (agent name or human identifier)'),
      author_type: z.enum(['human', 'agent', 'system']).optional().describe('Author type (default: human)'),
      parent_id: z.string().optional().describe('Parent comment ID for threaded replies'),
    },
    async (params) => {
      try {
        const comment = await ctx.storage.addComment(params.ticket_id, params.body, {
          author: params.author,
          authorType: params.author_type,
          parentId: params.parent_id,
        })
        return successResponse({
          comment: {
            id: comment.id,
            ticketId: comment.ticketId,
            author: comment.author,
            authorType: comment.authorType,
            body: comment.body,
            parentId: comment.parentId,
            createdAt: comment.createdAt.toISOString(),
            updatedAt: comment.updatedAt.toISOString(),
          },
        })
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'ticket_list_comments',
    'List all comments on a ticket, ordered by creation time',
    {
      ticket_id: z.string().describe('Ticket ID'),
    },
    async (params) => {
      try {
        const comments = await ctx.storage.listComments(params.ticket_id)
        return successResponse({
          count: comments.length,
          comments: comments.map((c) => ({
            id: c.id,
            ticketId: c.ticketId,
            author: c.author,
            authorType: c.authorType,
            body: c.body,
            parentId: c.parentId,
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
          })),
        })
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'ticket_delete_comment',
    'Delete a comment from a ticket',
    {
      comment_id: z.string().describe('Comment ID to delete'),
    },
    async (params) => {
      try {
        await ctx.storage.deleteComment(params.comment_id)
        return successResponse({ message: 'Comment deleted' })
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
