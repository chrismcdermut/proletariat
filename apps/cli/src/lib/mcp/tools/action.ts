/**
 * MCP Action Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { WorkAction, ReviewGateMode } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'
import { getReviewGateSetting, setReviewGateSetting } from '../../work-lifecycle/settings.js'

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
                reviewGate: a.reviewGate,
                modifiesCode: a.modifiesCode,
                isBuiltin: a.isBuiltin,
                validFrom: a.validFrom,
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
      review_gate: z.enum(['required', 'auto', 'post']).optional().describe('Review gate mode override (default: use workspace setting)'),
      modifies_code: z.boolean().optional(),
      valid_from: z.array(z.string()).optional().describe('Intent names this action can be invoked from (empty = any state)'),
    },
    async (params) => {
      try {
        const action = await ctx.storage.createAction({
          name: params.name,
          prompt: params.prompt,
          description: params.description,
          endPrompt: params.end_prompt,
          reviewGate: params.review_gate as ReviewGateMode | undefined,
          modifiesCode: params.modifies_code ?? true,
          validFrom: params.valid_from,
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

  strictTool(server,
    'review_gate_get',
    'Get workspace review gate setting (required | auto | post)',
    {},
    async () => {
      try {
        const db = ctx.storage.getDatabase()
        const mode = getReviewGateSetting(db)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, review_gate: mode }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'review_gate_set',
    'Set workspace review gate default (required | auto | post)',
    { mode: z.enum(['required', 'auto', 'post']).describe('Review gate mode') },
    async (params) => {
      try {
        const db = ctx.storage.getDatabase()
        setReviewGateSetting(db, params.mode)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, review_gate: params.mode, message: `Workspace review gate set to: ${params.mode}` }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
