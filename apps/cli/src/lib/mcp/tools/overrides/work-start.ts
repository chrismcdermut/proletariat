/**
 * MCP Work Start Override
 *
 * Since PRLT-1299 removed the local ticket store, work_start delegates
 * to the `prlt work spawn` CLI command which handles agent creation,
 * container setup, and provider-based ticket operations.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../../types.js'
import { errorResponse, strictTool } from '../../helpers.js'

/** Tool names provided by this override module. */
export const workStartOverrideNames = [
  'work_start',
]

/** Run a prlt command and parse JSON output. */
function runPrlt(ctx: McpToolContext, cmd: string): unknown {
  const output = ctx.runCommand(cmd)
  try {
    return JSON.parse(output)
  } catch {
    return { success: true, raw: output }
  }
}

export function registerWorkStartOverride(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'work_start',
    'Start work on a ticket — spawns an agent with a running container/session, creates a git branch, and moves ticket to In Progress only after successful spawn',
    {
      ticket_id: z.string().describe('Ticket ID to start work on'),
      agent: z.string().optional().describe('Agent name to assign (defaults to creating an ephemeral agent)'),
      environment: z.enum(['devcontainer', 'host']).optional().describe('Execution environment (default: devcontainer if available)'),
      display_mode: z.enum(['background', 'terminal']).optional().describe('Display mode (default: background — MCP runs headless)'),
      skip_permissions: z.boolean().optional().describe('Skip permission prompts (danger mode, default: false)'),
      create_pr: z.boolean().optional().describe('Create PR when work is ready (default: false)'),
    },
    async (params) => {
      try {
        const args: string[] = [`prlt work spawn ${params.ticket_id} --yes`]

        if (params.display_mode) args.push(`--display ${params.display_mode}`)
        else args.push('--display background')

        if (params.skip_permissions) args.push('--skip-permissions')
        if (params.create_pr) args.push('--create-pr')
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
