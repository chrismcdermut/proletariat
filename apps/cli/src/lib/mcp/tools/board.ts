/**
 * MCP Board Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Column, Ticket } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'

export function registerBoardTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'board_show',
    'Show the kanban board',
    { project: z.string().optional().describe('Project ID') },
    async (params) => {
      try {
        let projectId = params.project
        if (!projectId) {
          const projects = await ctx.storage.listProjects()
          if (projects.length === 0) throw new Error('No projects found')
          projectId = projects[0].id
        }
        const board = await ctx.storage.getBoard(projectId)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              board: {
                id: board.id,
                name: board.name,
                columns: board.columns.map((col: Column) => ({
                  name: col.name,
                  position: col.position,
                  ticketCount: col.tickets.length,
                  tickets: col.tickets.map((t: Ticket) => ({
                    id: t.id,
                    title: t.title,
                    priority: t.priority,
                    assignee: t.assignee,
                  })),
                })),
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
