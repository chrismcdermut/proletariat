/**
 * MCP Project Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Project, Column, Spec } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'

export function registerProjectTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'project_list',
    'List all projects',
    {
      include_archived: z.boolean().optional().describe('Include archived'),
      search: z.string().optional().describe('Search in name'),
    },
    async (params) => {
      try {
        const projects = await ctx.storage.listProjects({
          isArchived: params.include_archived ? undefined : false,
          search: params.search,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              count: projects.length,
              projects: projects.map((p: Project) => ({
                id: p.id,
                name: p.name,
                description: p.description,
                template: p.template,
                status: p.status,
                isArchived: p.isArchived,
                workflowId: p.workflowId,
                createdAt: p.createdAt.toISOString(),
                updatedAt: p.updatedAt.toISOString(),
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
    'project_create',
    'Create a new project',
    {
      name: z.string().describe('Project name'),
      description: z.string().optional().describe('Description'),
      template: z.string().optional().describe('Template (kanban, scrum, linear, simple)'),
    },
    async (params) => {
      try {
        const board = await ctx.storage.createProject({
          name: params.name,
          description: params.description,
          template: params.template,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              project: { id: board.id, name: board.name, columns: board.columns.map((c: Column) => c.name) },
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'project_show',
    'Get project details',
    { id: z.string().describe('Project ID') },
    async (params) => {
      try {
        const project = await ctx.storage.getProject(params.id)
        if (!project) throw new Error(`Project not found: ${params.id}`)
        const tickets = await ctx.storage.listTickets(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              project: {
                id: project.id,
                name: project.name,
                description: project.description,
                template: project.template,
                status: project.status,
                isArchived: project.isArchived,
                workflowId: project.workflowId,
                ticketCount: tickets.length,
                createdAt: project.createdAt.toISOString(),
                updatedAt: project.updatedAt.toISOString(),
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
    'project_update',
    'Update a project',
    {
      id: z.string().describe('Project ID'),
      name: z.string().optional().describe('New name'),
      description: z.string().optional().describe('New description'),
    },
    async (params) => {
      try {
        const changes: Partial<Project> = {}
        if (params.name) changes.name = params.name
        if (params.description !== undefined) changes.description = params.description
        const project = await ctx.storage.updateProject(params.id, changes)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, project: { id: project.id, name: project.name } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'project_archive',
    'Archive a project',
    { id: z.string().describe('Project ID') },
    async (params) => {
      try {
        const project = await ctx.storage.archiveProject(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, project: { id: project.id, isArchived: project.isArchived } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'project_unarchive',
    'Unarchive a project',
    { id: z.string().describe('Project ID') },
    async (params) => {
      try {
        const project = await ctx.storage.unarchiveProject(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, project: { id: project.id, isArchived: project.isArchived } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'project_delete',
    'Delete a project',
    { id: z.string().describe('Project ID') },
    async (params) => {
      try {
        await ctx.storage.deleteProject(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: `Deleted project ${params.id}` }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'project_link_to_spec',
    'Link project to a spec',
    {
      project_id: z.string().describe('Project ID'),
      spec_id: z.string().describe('Spec ID'),
    },
    async (params) => {
      try {
        await ctx.storage.linkProjectToSpec(params.project_id, params.spec_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Project linked to spec' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'project_get_specs',
    'Get specs linked to a project',
    { project_id: z.string().describe('Project ID') },
    async (params) => {
      try {
        const specs = await ctx.storage.getSpecsForProject(params.project_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              specs: specs.map((s: Spec) => ({ id: s.id, title: s.title, status: s.status })),
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
