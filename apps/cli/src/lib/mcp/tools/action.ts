/**
 * MCP Action Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { WorkAction } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'

export function registerActionTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'action_list',
    'List work actions',
    { include_builtin: z.boolean().optional() },
    async (params) => {
      try {
        const actions = await ctx.storage.listActions({
          isBuiltin: params.include_builtin ? undefined : false,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              actions: actions.map((a: WorkAction) => ({
                id: a.id,
                name: a.name,
                description: a.description,
                modifiesCode: a.modifiesCode,
                isBuiltin: a.isBuiltin,
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
    'action_show',
    'Get action details',
    { id: z.string().describe('Action ID') },
    async (params) => {
      try {
        const action = await ctx.storage.getAction(params.id)
        if (!action) throw new Error(`Action not found: ${params.id}`)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, action }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'action_create',
    'Create a work action',
    {
      name: z.string().describe('Action name'),
      prompt: z.string().describe('Start prompt'),
      description: z.string().optional(),
      end_prompt: z.string().optional(),
      modifies_code: z.boolean().optional(),
    },
    async (params) => {
      try {
        const action = await ctx.storage.createAction({
          name: params.name,
          prompt: params.prompt,
          description: params.description,
          endPrompt: params.end_prompt,
          modifiesCode: params.modifies_code ?? true,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, action: { id: action.id, name: action.name } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'action_delete',
    'Delete an action',
    { id: z.string().describe('Action ID') },
    async (params) => {
      try {
        await ctx.storage.deleteAction(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Action deleted' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
