/**
 * MCP Board Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Column, Ticket } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { formatTicketCompact, errorResponse, strictTool } from '../helpers.js'

/** Status categories considered "done" and excluded by default */
const DONE_CATEGORIES = new Set(['completed', 'canceled'])

export function registerBoardTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'board_view',
    'Show the kanban board. Returns compact ticket format by default (id, title, priority, category, assignee, statusName). Use ticket_show for full details. Excludes Done/Canceled columns by default.',
    {
      project: z.string().optional().describe('Project ID'),
      summary: z.boolean().optional().describe('Summary mode: return only column names and ticket counts, no ticket details'),
      column: z.string().optional().describe('Filter to a specific column by name (case-insensitive partial match)'),
      include_done: z.boolean().optional().describe('Include completed/canceled columns (excluded by default)'),
      limit: z.number().optional().describe('Max tickets to return per column'),
      offset: z.number().optional().describe('Number of tickets to skip per column (for pagination)'),
    },
    async (params) => {
      try {
        let projectId = params.project
        if (!projectId) {
          const projects = await ctx.storage.listProjects()
          if (projects.length === 0) throw new Error('No projects found')
          projectId = projects[0].id
        }
        const board = await ctx.storage.getBoard(projectId)

        // Filter out done columns unless explicitly requested
        let columns = board.columns
        if (!params.include_done) {
          columns = columns.filter((col: Column) => !DONE_CATEGORIES.has(col.status || ''))
        }

        // Filter to specific column by name (case-insensitive partial match)
        if (params.column) {
          const columnFilter = params.column.toLowerCase()
          columns = columns.filter((col: Column) =>
            col.name.toLowerCase().includes(columnFilter)
          )
        }

        // Summary mode: just column names and ticket counts
        if (params.summary) {
          const totalTickets = columns.reduce((sum, col: Column) => sum + col.tickets.length, 0)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                board: {
                  id: board.id,
                  name: board.name,
                  totalTickets,
                  columns: columns.map((col: Column) => ({
                    name: col.name,
                    position: col.position,
                    ticketCount: col.tickets.length,
                  })),
                  updatedAt: board.updatedAt.toISOString(),
                },
              }, null, 2),
            }],
          }
        }

        // Compact format (default): return compact ticket objects with pagination
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              board: {
                id: board.id,
                name: board.name,
                columns: columns.map((col: Column) => {
                  const total = col.tickets.length
                  let tickets = col.tickets
                  const offset = params.offset || 0
                  if (offset > 0) {
                    tickets = tickets.slice(offset)
                  }
                  if (params.limit !== undefined) {
                    tickets = tickets.slice(0, params.limit)
                  }
                  return {
                    name: col.name,
                    position: col.position,
                    ticketCount: total,
                    ...(offset > 0 || params.limit !== undefined ? { showing: tickets.length, offset } : {}),
                    tickets: tickets.map((t: Ticket) => formatTicketCompact(t)),
                  }
                }),
                updatedAt: board.updatedAt.toISOString(),
              },
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'board_columns',
    'Get column names for a project',
    { project: z.string().optional().describe('Project ID') },
    async (params) => {
      try {
        let projectId = params.project
        if (!projectId) {
          const projects = await ctx.storage.listProjects()
          if (projects.length === 0) throw new Error('No projects found')
          projectId = projects[0].id
        }
        const columns = ctx.storage.getColumnNames(projectId)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, projectId, columns }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'board_create_column',
    'Add a new column to the board',
    {
      project: z.string().describe('Project ID'),
      name: z.string().describe('Column name'),
      position: z.number().optional().describe('Position'),
    },
    async (params) => {
      try {
        const column = await ctx.storage.createColumn(params.project, params.name, params.position)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, column: { id: column.id, name: column.name, position: column.position } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'board_rename_column',
    'Rename a column',
    {
      project: z.string().describe('Project ID'),
      column_id: z.string().describe('Column ID'),
      name: z.string().describe('New name'),
    },
    async (params) => {
      try {
        const column = await ctx.storage.renameColumn(params.project, params.column_id, params.name)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, column: { id: column.id, name: column.name } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'board_move_column',
    'Reorder a column',
    {
      project: z.string().describe('Project ID'),
      column_id: z.string().describe('Column ID'),
      position: z.number().describe('New position'),
    },
    async (params) => {
      try {
        const column = await ctx.storage.moveColumn(params.project, params.column_id, params.position)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, column: { id: column.id, name: column.name, position: column.position } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'board_delete_column',
    'Delete a column',
    {
      project: z.string().describe('Project ID'),
      column_id: z.string().describe('Column ID'),
      cascade: z.boolean().optional().describe('Delete tickets in column'),
    },
    async (params) => {
      try {
        await ctx.storage.deleteColumn(params.project, params.column_id, params.cascade)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Column deleted' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
