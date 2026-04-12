/**
 * MCP Work Tools (Agent workflow)
 *
 * Since PRLT-1299 removed the local ticket store, work operations
 * are delegated to the `prlt` CLI which routes through the provider.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'

/** Run a prlt command and parse JSON output. */
function runPrlt(ctx: McpToolContext, cmd: string): unknown {
  const output = ctx.runCommand(cmd)
  try {
    return JSON.parse(output)
  } catch {
    return { success: true, raw: output }
  }
}

export function registerWorkTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'work_status',
    'Get current work status (in-progress tickets)',
    {},
    async () => {
      try {
        const result = runPrlt(ctx, 'prlt ticket list --json')
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'work_assign',
    'Assign a ticket to someone for work preparation',
    {
      ticket_id: z.string().describe('Ticket ID'),
      assignee: z.string().optional().describe('Who is working'),
    },
    async (params) => {
      try {
        const args: string[] = [`prlt ticket edit ${params.ticket_id} --json`]
        if (params.assignee) args.push(`--assignee "${params.assignee}"`)
        const result = runPrlt(ctx, args.join(' '))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'work_complete',
    'Mark ticket complete (moves to Done)',
    { ticket_id: z.string().describe('Ticket ID') },
    async (params) => {
      try {
        const result = runPrlt(ctx, `prlt work complete ${params.ticket_id} --json`)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'work_ready',
    'Mark ticket ready for review',
    { ticket_id: z.string().describe('Ticket ID') },
    async (params) => {
      try {
        const result = runPrlt(ctx, `prlt work ready ${params.ticket_id} --json`)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'work_start',
    'Start work on a ticket — spawns an agent via the CLI pipeline',
    {
      ticket_id: z.string().describe('Ticket ID to start work on'),
      agent: z.string().optional().describe('Agent name to assign'),
      environment: z.enum(['devcontainer', 'host']).optional().describe('Execution environment'),
      display_mode: z.enum(['background', 'terminal']).optional().describe('Display mode (default: background)'),
    },
    async (params) => {
      try {
        const args: string[] = [`prlt work spawn ${params.ticket_id} --yes --json`]
        if (params.display_mode) args.push(`--display ${params.display_mode}`)
        else args.push('--display background')
        if (params.environment === 'host') args.push('--run-on-host')
        const result = runPrlt(ctx, args.join(' '))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'work_review',
    'Evaluate the output/PR for a ticket.',
    {
      ticket_id: z.string().describe('Ticket ID to review'),
    },
    async (params) => {
      try {
        const result = runPrlt(ctx, `prlt work review ${params.ticket_id} --json`)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'work_spawn',
    'Spawn work on a ticket using the full CLI pipeline.',
    {
      ticket_id: z.string().describe('Ticket ID to spawn work for'),
      action: z.string().optional().describe('Action to perform (implement, groom, review, etc.)'),
      display_mode: z.enum(['terminal', 'background']).optional().describe('Display mode (default: background)'),
      agent: z.string().optional().describe('Agent name to use'),
      environment: z.enum(['devcontainer', 'host']).optional().describe('Execution environment'),
    },
    async (params) => {
      try {
        const args: string[] = [`prlt work spawn ${params.ticket_id} --yes`]
        if (params.action) args.push(`--action ${params.action}`)
        if (params.display_mode) args.push(`--display ${params.display_mode}`)
        else args.push('--display background')
        if (params.environment === 'host') args.push('--run-on-host')
        const result = runPrlt(ctx, args.join(' '))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
