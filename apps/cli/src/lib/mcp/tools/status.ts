/**
 * MCP Status Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { WorkflowStatus } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'

export function registerStatusTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'status_list',
    'List statuses in a workflow',
    { workflow_id: z.string().describe('Workflow ID') },
    async (params) => {
      try {
        const statuses = await ctx.storage.listStatuses(params.workflow_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              statuses: statuses.map((s: WorkflowStatus) => ({
                id: s.id,
                name: s.name,
                category: s.category,
                position: s.position,
                isDefault: s.isDefault,
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
    'status_create',
    'Create a status in a workflow',
    {
      workflow_id: z.string().describe('Workflow ID'),
      name: z.string().describe('Status name'),
      category: z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']).describe('Category'),
      position: z.number().optional(),
      is_default: z.boolean().optional(),
    },
    async (params) => {
      try {
        const status = await ctx.storage.createStatus(params.workflow_id, {
          name: params.name,
          category: params.category,
          position: params.position,
          isDefault: params.is_default,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, status: { id: status.id, name: status.name, category: status.category } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'status_update',
    'Update a status',
    {
      id: z.string().describe('Status ID'),
      name: z.string().optional(),
      category: z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']).optional(),
    },
    async (params) => {
      try {
        const changes: Partial<WorkflowStatus> = {}
        if (params.name) changes.name = params.name
        if (params.category) changes.category = params.category
        const status = await ctx.storage.updateStatus(params.id, changes)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, status: { id: status.id, name: status.name } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'status_reorder',
    'Reorder a status',
    {
      id: z.string().describe('Status ID'),
      position: z.number().describe('New position'),
    },
    async (params) => {
      try {
        const status = await ctx.storage.reorderStatus(params.id, params.position)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, status: { id: status.id, position: status.position } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'status_delete',
    'Delete a status',
    { id: z.string().describe('Status ID') },
    async (params) => {
      try {
        await ctx.storage.deleteStatus(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Status deleted' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
