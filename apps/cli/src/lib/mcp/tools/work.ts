/**
 * MCP Work Tools (Agent workflow)
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ticket } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { formatTicket, errorResponse, strictTool } from '../helpers.js'

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

  strictTool(server,
    'work_revise',
    'Send ticket back for revision',
    { ticket_id: z.string().describe('Ticket ID') },
    async (params) => {
      try {
        const ticket = await ctx.storage.getTicket(params.ticket_id)
        if (!ticket) throw new Error(`Ticket not found: ${params.ticket_id}`)
        const columns = ctx.storage.getColumnNames(ticket.projectId!)
        const progressCol = columns.find((c: string) => c.toLowerCase().includes('progress')) || columns[1]
        const moved = await ctx.storage.moveTicket(ticket.projectId!, params.ticket_id, progressCol)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, ticket: formatTicket(moved), message: `${moved.id} sent back for revision` }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
