/**
 * MCP Epic Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Epic, Ticket } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'

export function registerEpicTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'epic_list',
    'List epics',
    {
      project: z.string().optional(),
      status: z.enum(['active', 'draft', 'complete', 'dropped', 'future']).optional(),
      search: z.string().optional(),
    },
    async (params) => {
      try {
        let projectId = params.project
        if (!projectId) {
          const projects = await ctx.storage.listProjects()
          if (projects.length === 0) throw new Error('No projects')
          projectId = projects[0].id
        }
        const epics = await ctx.storage.listEpics(projectId, { status: params.status, search: params.search })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              count: epics.length,
              epics: epics.map((e: Epic) => ({
                id: e.id,
                title: e.title,
                status: e.status,
                position: e.position,
                projectId: e.projectId,
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
    'epic_create',
    'Create an epic',
    {
      title: z.string().describe('Epic title'),
      project: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(['active', 'draft', 'complete', 'dropped', 'future']).optional(),
      spec_id: z.string().optional(),
    },
    async (params) => {
      try {
        let projectId = params.project
        if (!projectId) {
          const projects = await ctx.storage.listProjects()
          if (projects.length === 0) throw new Error('No projects')
          projectId = projects[0].id
        }
        const epic = await ctx.storage.createEpic(projectId, {
          title: params.title,
          description: params.description,
          status: params.status || 'draft',
          specId: params.spec_id,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, epic: { id: epic.id, title: epic.title, status: epic.status } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'epic_show',
    'Get epic details with tickets',
    { id: z.string().describe('Epic ID') },
    async (params) => {
      try {
        const epic = await ctx.storage.getEpic(params.id)
        if (!epic) throw new Error(`Epic not found: ${params.id}`)
        const tickets = await ctx.storage.getTicketsForEpic(epic.projectId, params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              epic: {
                id: epic.id,
                projectId: epic.projectId,
                title: epic.title,
                status: epic.status,
                position: epic.position,
                specId: epic.specId,
                ticketCount: tickets.length,
                tickets: tickets.map((t: Ticket) => ({ id: t.id, title: t.title, statusName: t.statusName, priority: t.priority, category: t.category })),
                createdAt: epic.createdAt.toISOString(),
                updatedAt: epic.updatedAt.toISOString(),
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
    'epic_update',
    'Update an epic',
    {
      id: z.string().describe('Epic ID'),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(['active', 'draft', 'complete', 'dropped', 'future']).optional(),
    },
    async (params) => {
      try {
        const changes: Partial<Epic> = {}
        if (params.title) changes.title = params.title
        if (params.description !== undefined) changes.description = params.description
        if (params.status) changes.status = params.status
        const epic = await ctx.storage.updateEpic(params.id, changes)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, epic: { id: epic.id, title: epic.title, status: epic.status } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'epic_delete',
    'Delete an epic',
    { id: z.string().describe('Epic ID') },
    async (params) => {
      try {
        await ctx.storage.deleteEpic(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: `Deleted epic ${params.id}` }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'epic_reorder',
    'Reorder an epic',
    {
      id: z.string().describe('Epic ID'),
      position: z.number().describe('New position'),
      project: z.string().optional(),
    },
    async (params) => {
      try {
        const epic = await ctx.storage.getEpic(params.id)
        if (!epic) throw new Error(`Epic not found: ${params.id}`)
        const reordered = await ctx.storage.reorderEpic(params.project || epic.projectId, params.id, params.position)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, epic: { id: reordered.id, position: reordered.position } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'epic_add_blocker',
    'Add epic dependency',
    {
      epic_id: z.string().describe('Epic that will be blocked'),
      blocker_id: z.string().describe('Epic that blocks'),
    },
    async (params) => {
      try {
        await ctx.storage.createEpicDependency(params.epic_id, params.blocker_id, 'blocks')
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Epic dependency added' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
