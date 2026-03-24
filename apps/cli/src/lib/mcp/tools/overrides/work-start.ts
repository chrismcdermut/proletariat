/**
 * MCP Work Start Override
 *
 * The work_start tool requires in-process workspace context for agent spawning
 * (ephemeral agent creation, execution storage, etc.), so it cannot be
 * auto-generated as a simple CLI passthrough.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../../types.js'
import { formatTicket, errorResponse, strictTool } from '../../helpers.js'
import { spawnAgentForTicket } from '../../../execution/spawner.js'
import { createEphemeralAgent } from '../../../agents/commands.js'
import type { DisplayMode, ExecutionEnvironment } from '../../../execution/types.js'

/** Tool names provided by this override module. */
export const workStartOverrideNames = [
  'work_start',
]

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
        // Require workspace context for spawn operations
        if (!ctx.getWorkspaceContext) {
          throw new Error(
            'Workspace not initialized. work_start requires a workspace with agents. Run "prlt new" first.'
          )
        }

        const { workspaceInfo, executionStorage, db, pmoPath } = ctx.getWorkspaceContext()

        // Validate ticket exists
        const ticket = await ctx.storage.getTicket(params.ticket_id)
        if (!ticket) throw new Error(`Ticket not found: ${params.ticket_id}`)

        // Check ticket is not blocked
        if (ticket.blockedBy && ticket.blockedBy.length > 0) {
          throw new Error(
            `Ticket ${ticket.id} is blocked by: ${ticket.blockedBy.join(', ')}. Resolve blockers first.`
          )
        }

        // Check for existing running execution
        const runningExec = executionStorage.getRunningExecution(ticket.id)
        if (runningExec) {
          throw new Error(
            `Ticket ${ticket.id} already has a running execution: ${runningExec.id} (agent: ${runningExec.agentName})`
          )
        }

        // Select or create agent
        let agentName: string
        if (params.agent) {
          // Use specified agent — verify it exists
          const agentExists = workspaceInfo.agents.some(a => a.name === params.agent)
          if (!agentExists) {
            throw new Error(
              `Agent "${params.agent}" not found. Available agents: ${workspaceInfo.agents.map(a => a.name).join(', ') || 'none'}`
            )
          }
          agentName = params.agent
        } else {
          // Create an ephemeral agent (default for MCP)
          const ephemeralResult = await createEphemeralAgent(workspaceInfo)
          agentName = ephemeralResult.name
        }

        // Spawn the agent with background mode (MCP is headless)
        const displayMode: DisplayMode = (params.display_mode as DisplayMode) || 'background'
        const environment: ExecutionEnvironment | undefined = params.environment as ExecutionEnvironment | undefined

        const result = await spawnAgentForTicket(
          ticket,
          agentName,
          ctx.storage,
          executionStorage,
          workspaceInfo,
          db,
          pmoPath,
          {
            environment,
            displayMode,
            skipPermissions: params.skip_permissions ?? false,
            createPR: params.create_pr ?? false,
            skipRemoteCheck: false,
          }
        )

        if (result.success) {
          // Fetch updated ticket to return current state
          const updatedTicket = await ctx.storage.getTicket(params.ticket_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                executionId: result.executionId,
                ticketId: result.ticketId,
                agent: result.agentName,
                status: 'running',
                ticket: updatedTicket ? formatTicket(updatedTicket) : undefined,
                message: `Started work on ${ticket.id}: ${ticket.title} (agent: ${agentName})`,
              }, null, 2),
            }],
          }
        } else {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                ticketId: result.ticketId,
                agent: result.agentName,
                error: result.error || 'Spawn failed',
                message: `Failed to start work on ${ticket.id}: ${result.error}`,
              }, null, 2),
            }],
            isError: true,
          }
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
