/**
 * MCP View Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BoardView } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'

export function registerViewTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'view_list',
    'List board views for a project',
    { project: z.string().optional() },
    async (params) => {
      try {
        const views = await ctx.storage.listBoardViews({ projectId: params.project })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              views: views.map((v: BoardView) => ({
                id: v.id,
                name: v.name,
                description: v.description,
                projectId: v.projectId,
                isDefault: v.isDefault,
              })),
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'view_create',
    'Create a board view',
    {
      project: z.string().describe('Project ID'),
      name: z.string().describe('View name'),
      description: z.string().optional(),
      filters: z.object({
        assignee: z.string().optional(),
        owner: z.string().optional(),
        priority: z.string().optional(),
        epicId: z.string().optional(),
        search: z.string().optional(),
      }).optional(),
      is_default: z.boolean().optional(),
    },
    async (params) => {
      try {
        const view = await ctx.storage.createBoardView({
          projectId: params.project,
          name: params.name,
          description: params.description,
          filters: params.filters || {},
          isDefault: params.is_default,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, view: { id: view.id, name: view.name } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'view_delete',
    'Delete a board view',
    { id: z.string().describe('View ID') },
    async (params) => {
      try {
        await ctx.storage.deleteBoardView(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'View deleted' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
