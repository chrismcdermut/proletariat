/**
 * MCP Work Tools (Agent workflow)
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ticket } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { formatTicket, errorResponse, strictTool } from '../helpers.js'
import { spawnAgentForTicket } from '../../execution/spawner.js'
import { createEphemeralAgent } from '../../agents/commands.js'
import type { DisplayMode, ExecutionEnvironment } from '../../execution/types.js'

export function registerWorkTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'work_status',
    'Get current work status (in-progress tickets)',
    {},
    async () => {
      try {
        const tickets = await ctx.storage.listTickets(undefined, { allProjects: true })
        const inProgress = tickets.filter((t: Ticket) => t.statusCategory === 'started' && t.assignee)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              inProgressCount: inProgress.length,
              tickets: inProgress.map((t: Ticket) => ({
                id: t.id,
                title: t.title,
                assignee: t.assignee,
                statusName: t.statusName,
                priority: t.priority,
                projectId: t.projectId,
                branch: t.branch,
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
    'work_assign',
    'Assign a ticket to someone for work preparation (does NOT move to In Progress — use the CLI "work start" command to actually start work with an agent/session)',
    {
      ticket_id: z.string().describe('Ticket ID'),
      assignee: z.string().optional().describe('Who is working'),
    },
    async (params) => {
      try {
        const ticket = await ctx.storage.getTicket(params.ticket_id)
        if (!ticket) throw new Error(`Ticket not found: ${params.ticket_id}`)
        if (params.assignee) {
          await ctx.storage.updateTicket(params.ticket_id, { assignee: params.assignee })
        }
        const updated = await ctx.storage.getTicket(params.ticket_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              ticket: formatTicket(updated!),
              message: `Assigned ${updated!.id}: ${updated!.title}${params.assignee ? ` to ${params.assignee}` : ''}`,
            }, null, 2),
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
        const ticket = await ctx.storage.getTicket(params.ticket_id)
        if (!ticket) throw new Error(`Ticket not found: ${params.ticket_id}`)
        const columns = ctx.storage.getColumnNames(ticket.projectId!)
        const doneCol = columns.find((c: string) =>
          c.toLowerCase().includes('done') || c.toLowerCase().includes('complete')
        ) || columns[columns.length - 1]
        const moved = await ctx.storage.moveTicket(ticket.projectId!, params.ticket_id, doneCol)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              ticket: formatTicket(moved),
              message: `Completed ${moved.id}`,
            }, null, 2),
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
        const ticket = await ctx.storage.getTicket(params.ticket_id)
        if (!ticket) throw new Error(`Ticket not found: ${params.ticket_id}`)
        const columns = ctx.storage.getColumnNames(ticket.projectId!)
        const reviewCol = columns.find((c: string) => c.toLowerCase().includes('review'))
        if (reviewCol) {
          const moved = await ctx.storage.moveTicket(ticket.projectId!, params.ticket_id, reviewCol)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, ticket: formatTicket(moved), message: `${moved.id} ready for review` }, null, 2),
            }],
          }
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'No review column found', ticket: formatTicket(ticket) }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // NOTE: 'work_revise' tool removed — absorbed by 'work_review' (model decides whether to comment, fix, or both)

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

  strictTool(server,
    'work_review',
    'Evaluate the output/PR for a ticket. Spawns an agent that decides whether to comment, fix, or both based on context. Replaces the old review-comment and review-fix actions.',
    {
      ticket_id: z.string().describe('Ticket ID to review'),
    },
    async (params) => {
      try {
        const cmd = `prlt work review ${params.ticket_id} --json`
        const output = ctx.runCommand(cmd)

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              ticketId: params.ticket_id,
              command: cmd,
              output,
              message: `Review started for ${params.ticket_id}`,
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'work_spawn',
    'Spawn work on a ticket using the full CLI pipeline (agent selection, Docker build, container creation, branch setup, tmux session). Shells out to "prlt work spawn" — works whenever prlt is installed, no workspace context needed in-process.',
    {
      ticket_id: z.string().describe('Ticket ID to spawn work for'),
      action: z.string().optional().describe('Action to perform (e.g., implement, groom, review, custom). Defaults to implement.'),
      display_mode: z.enum(['terminal', 'background']).optional().describe('Display mode (default: background)'),
      skip_permissions: z.boolean().optional().describe('Skip permission prompts — danger mode (default: false)'),
      create_pr: z.boolean().optional().describe('Create PR when work is ready (default: false)'),
      agent: z.string().optional().describe('Agent name to use (default: ephemeral agent created on-demand)'),
      environment: z.enum(['devcontainer', 'host']).optional().describe('Execution environment (default: devcontainer if available)'),
    },
    async (params) => {
      try {
        // Build the prlt work spawn command
        const args: string[] = [params.ticket_id]

        // Add flags
        if (params.action) {
          args.push('--action', params.action)
        }

        if (params.display_mode) {
          args.push('--display', params.display_mode)
        } else {
          args.push('--display', 'background')
        }

        if (params.skip_permissions) {
          args.push('--skip-permissions')
        }

        if (params.create_pr) {
          args.push('--create-pr')
        }

        if (params.environment === 'host') {
          args.push('--run-on-host')
        }

        // Always skip confirmation in MCP context
        args.push('--yes')

        const cmd = `prlt work spawn ${args.join(' ')}`
        const output = ctx.runCommand(cmd)

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              ticketId: params.ticket_id,
              command: cmd,
              output,
              message: `Spawned work for ${params.ticket_id} via CLI pipeline`,
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
