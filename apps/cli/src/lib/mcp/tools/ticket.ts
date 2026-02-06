/**
 * MCP Ticket Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ticket } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { formatTicket, formatTicketFull, errorResponse } from '../helpers.js'

export function registerTicketTools(server: McpServer, ctx: McpToolContext): void {
  server.tool(
    'ticket_list',
    'List tickets with optional filters',
    {
      project: z.string().optional().describe('Project ID'),
      column: z.string().optional().describe('Filter by column/status'),
      priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('Filter by priority'),
      category: z.string().optional().describe('Filter by category'),
      assignee: z.string().optional().describe('Filter by assignee'),
      owner: z.string().optional().describe('Filter by owner'),
      search: z.string().optional().describe('Search in title/description'),
      epic: z.string().optional().describe('Filter by epic ID'),
      all_projects: z.boolean().optional().describe('List from all projects'),
    },
    async (params) => {
      try {
        const tickets = await ctx.storage.listTickets(
          params.all_projects ? undefined : params.project,
          {
            column: params.column,
            priority: params.priority,
            category: params.category,
            assignee: params.assignee,
            owner: params.owner,
            search: params.search,
            epic: params.epic,
            allProjects: params.all_projects,
          }
        )
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              count: tickets.length,
              tickets: tickets.map((t: Ticket) => ({
                id: t.id,
                title: t.title,
                description: t.description,
                priority: t.priority,
                category: t.category,
                statusName: t.statusName,
                statusCategory: t.statusCategory,
                projectId: t.projectId,
                assignee: t.assignee,
                owner: t.owner,
                epicId: t.epicId,
                branch: t.branch,
                createdAt: t.createdAt.toISOString(),
                updatedAt: t.updatedAt.toISOString(),
              })),
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_create',
    'Create a new ticket',
    {
      title: z.string().describe('Ticket title (required)'),
      project: z.string().optional().describe('Project ID'),
      description: z.string().optional().describe('Ticket description'),
      priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('Priority'),
      category: z.string().optional().describe('Category (feature, bug, etc.)'),
      column: z.string().optional().describe('Column/status name'),
      assignee: z.string().optional().describe('Assignee'),
      owner: z.string().optional().describe('Owner'),
      epic_id: z.string().optional().describe('Epic ID to link'),
      labels: z.array(z.string()).optional().describe('Labels to add'),
      subtasks: z.array(z.string()).optional().describe('Subtasks to add'),
    },
    async (params) => {
      try {
        let projectId = params.project
        if (!projectId) {
          const projects = await ctx.storage.listProjects()
          if (projects.length === 0) throw new Error('No projects found')
          projectId = projects[0].id
        }
        const ticket = await ctx.storage.createTicket(projectId, {
          title: params.title,
          description: params.description,
          priority: params.priority,
          category: params.category,
          statusName: params.column,
          assignee: params.assignee,
          owner: params.owner,
          epicId: params.epic_id,
          labels: params.labels,
          subtasks: params.subtasks?.map((title) => ({ id: '', title, done: false })),
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, ticket: formatTicket(ticket) }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_show',
    'Get detailed ticket information',
    { id: z.string().describe('Ticket ID') },
    async (params) => {
      try {
        const ticket = await ctx.storage.getTicket(params.id)
        if (!ticket) throw new Error(`Ticket not found: ${params.id}`)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, ticket: formatTicketFull(ticket) }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_update',
    'Update a ticket',
    {
      id: z.string().describe('Ticket ID'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('New priority'),
      category: z.string().optional().describe('New category'),
      assignee: z.string().optional().describe('New assignee'),
      owner: z.string().optional().describe('New owner'),
      branch: z.string().optional().describe('Git branch'),
    },
    async (params) => {
      try {
        const changes: Record<string, unknown> = {}
        if (params.title !== undefined) changes.title = params.title
        if (params.description !== undefined) changes.description = params.description
        if (params.priority !== undefined) changes.priority = params.priority
        if (params.category !== undefined) changes.category = params.category
        if (params.assignee !== undefined) changes.assignee = params.assignee
        if (params.owner !== undefined) changes.owner = params.owner
        if (params.branch !== undefined) changes.branch = params.branch
        const ticket = await ctx.storage.updateTicket(params.id, changes)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, ticket: formatTicket(ticket) }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_move',
    'Move ticket to a different column/status',
    {
      id: z.string().describe('Ticket ID'),
      column: z.string().describe('Target column/status'),
      position: z.number().optional().describe('Position in column'),
    },
    async (params) => {
      try {
        const ticket = await ctx.storage.getTicket(params.id)
        if (!ticket) throw new Error(`Ticket not found: ${params.id}`)
        const moved = await ctx.storage.moveTicket(ticket.projectId!, params.id, params.column, params.position)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, ticket: formatTicket(moved) }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_delete',
    'Delete a ticket',
    { id: z.string().describe('Ticket ID') },
    async (params) => {
      try {
        await ctx.storage.deleteTicket(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: `Deleted ${params.id}` }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_move_to_project',
    'Move ticket to a different project',
    {
      id: z.string().describe('Ticket ID'),
      project: z.string().describe('Target project ID'),
    },
    async (params) => {
      try {
        const ticket = await ctx.storage.moveTicketToProject(params.id, params.project)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, ticket: formatTicket(ticket) }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_add_subtask',
    'Add a subtask to a ticket',
    {
      ticket_id: z.string().describe('Ticket ID'),
      title: z.string().describe('Subtask title'),
    },
    async (params) => {
      try {
        const subtask = await ctx.storage.addSubtask(params.ticket_id, params.title)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, subtask }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_toggle_subtask',
    'Toggle subtask completion',
    {
      ticket_id: z.string().describe('Ticket ID'),
      subtask_id: z.string().describe('Subtask ID'),
    },
    async (params) => {
      try {
        const subtask = await ctx.storage.toggleSubtask(params.ticket_id, params.subtask_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, subtask }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_remove_subtask',
    'Remove a subtask',
    {
      ticket_id: z.string().describe('Ticket ID'),
      subtask_id: z.string().describe('Subtask ID'),
    },
    async (params) => {
      try {
        await ctx.storage.removeSubtask(params.ticket_id, params.subtask_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Subtask removed' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_add_acceptance_criterion',
    'Add acceptance criterion to a ticket',
    {
      ticket_id: z.string().describe('Ticket ID'),
      criterion: z.string().describe('Acceptance criterion text'),
    },
    async (params) => {
      try {
        const ac = await ctx.storage.addAcceptanceCriterion(params.ticket_id, params.criterion)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, acceptanceCriterion: ac }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_remove_acceptance_criterion',
    'Remove acceptance criterion',
    {
      ticket_id: z.string().describe('Ticket ID'),
      criterion_id: z.string().describe('Criterion ID'),
    },
    async (params) => {
      try {
        await ctx.storage.removeAcceptanceCriterion(params.ticket_id, params.criterion_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Criterion removed' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_link_to_epic',
    'Link ticket to an epic',
    {
      ticket_id: z.string().describe('Ticket ID'),
      epic_id: z.string().describe('Epic ID'),
    },
    async (params) => {
      try {
        await ctx.storage.linkTicketToEpic(params.ticket_id, params.epic_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Ticket linked to epic' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_unlink_from_epic',
    'Unlink ticket from its epic',
    { ticket_id: z.string().describe('Ticket ID') },
    async (params) => {
      try {
        await ctx.storage.unlinkTicketFromEpic(params.ticket_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Ticket unlinked from epic' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_link_to_spec',
    'Link ticket to a spec',
    {
      ticket_id: z.string().describe('Ticket ID'),
      spec_id: z.string().describe('Spec ID'),
    },
    async (params) => {
      try {
        await ctx.storage.linkTicketToSpec(params.ticket_id, params.spec_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Ticket linked to spec' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_add_blocker',
    'Add a blocking dependency',
    {
      ticket_id: z.string().describe('Ticket that will be blocked'),
      blocker_id: z.string().describe('Ticket that blocks'),
    },
    async (params) => {
      try {
        await ctx.storage.createTicketDependency(params.ticket_id, params.blocker_id, 'blocks')
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: `${params.ticket_id} is now blocked by ${params.blocker_id}` }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_remove_blocker',
    'Remove a blocking dependency',
    {
      ticket_id: z.string().describe('Blocked ticket'),
      blocker_id: z.string().describe('Blocking ticket'),
    },
    async (params) => {
      try {
        await ctx.storage.deleteTicketDependency(params.ticket_id, params.blocker_id, 'blocks')
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Blocker removed' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'ticket_get_blockers',
    'Get tickets blocking this ticket',
    { ticket_id: z.string().describe('Ticket ID') },
    async (params) => {
      try {
        const blockers = await ctx.storage.getTicketBlockers(params.ticket_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              blockers: blockers.map((t: Ticket) => ({ id: t.id, title: t.title, statusName: t.statusName })),
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
