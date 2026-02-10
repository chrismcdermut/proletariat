/**
 * MCP Workflow Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Workflow, WorkflowStatus } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'

export function registerWorkflowTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'workflow_list',
    'List all workflows',
    { include_builtin: z.boolean().optional() },
    async (params) => {
      try {
        const workflows = await ctx.storage.listWorkflows({
          isBuiltin: params.include_builtin ? undefined : false,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              workflows: workflows.map((w: Workflow) => ({
                id: w.id,
                name: w.name,
                description: w.description,
                isBuiltin: w.isBuiltin,
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
    'workflow_show',
    'Get workflow details with statuses',
    { id: z.string().describe('Workflow ID') },
    async (params) => {
      try {
        const workflow = await ctx.storage.getWorkflow(params.id)
        if (!workflow) throw new Error(`Workflow not found: ${params.id}`)
        const statuses = await ctx.storage.listStatuses(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              workflow: {
                ...workflow,
                statuses: statuses.map((s: WorkflowStatus) => ({
                  id: s.id,
                  name: s.name,
                  category: s.category,
                  position: s.position,
                  isDefault: s.isDefault,
                })),
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
    'workflow_create',
    'Create a new workflow',
    {
      name: z.string().describe('Workflow name'),
      description: z.string().optional(),
      statuses: z.array(z.string()).optional().describe('Status names'),
    },
    async (params) => {
      try {
        const workflow = await ctx.storage.createWorkflow({
          name: params.name,
          description: params.description,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, workflow: { id: workflow.id, name: workflow.name } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'workflow_delete',
    'Delete a workflow',
    { id: z.string().describe('Workflow ID') },
    async (params) => {
      try {
        await ctx.storage.deleteWorkflow(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: `Deleted workflow ${params.id}` }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
