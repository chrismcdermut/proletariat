/**
 * MCP Spec Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Spec, Ticket } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'

export function registerSpecTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'spec_list',
    'List specifications',
    {
      status: z.enum(['draft', 'active', 'implemented']).optional(),
      type: z.enum(['product', 'platform', 'infra', 'integration']).optional(),
      search: z.string().optional(),
    },
    async (params) => {
      try {
        const specs = await ctx.storage.listSpecs({
          status: params.status,
          type: params.type,
          search: params.search,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              count: specs.length,
              specs: specs.map((s: Spec) => ({
                id: s.id,
                title: s.title,
                status: s.status,
                type: s.type,
                tags: s.tags,
                createdAt: s.createdAt.toISOString(),
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
    'spec_create',
    'Create a specification',
    {
      title: z.string().describe('Spec title'),
      status: z.enum(['draft', 'active', 'implemented']).optional(),
      type: z.enum(['product', 'platform', 'infra', 'integration']).optional(),
      problem: z.string().optional(),
      solution: z.string().optional(),
      acceptance_criteria: z.string().optional(),
      context: z.string().optional(),
    },
    async (params) => {
      try {
        const spec = await ctx.storage.createSpec({
          title: params.title,
          status: params.status || 'draft',
          type: params.type,
          problem: params.problem,
          solution: params.solution,
          acceptanceCriteria: params.acceptance_criteria,
          context: params.context,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, spec: { id: spec.id, title: spec.title, status: spec.status } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'spec_view',
    'Get spec details',
    { id: z.string().describe('Spec ID') },
    async (params) => {
      try {
        const spec = await ctx.storage.getSpec(params.id)
        if (!spec) throw new Error(`Spec not found: ${params.id}`)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, spec }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'spec_update',
    'Update a spec',
    {
      id: z.string().describe('Spec ID'),
      title: z.string().optional(),
      status: z.enum(['draft', 'active', 'implemented']).optional(),
      type: z.enum(['product', 'platform', 'infra', 'integration']).optional(),
      problem: z.string().optional(),
      solution: z.string().optional(),
      acceptance_criteria: z.string().optional(),
    },
    async (params) => {
      try {
        const changes: Partial<Spec> = {}
        if (params.title) changes.title = params.title
        if (params.status) changes.status = params.status
        if (params.type) changes.type = params.type
        if (params.problem !== undefined) changes.problem = params.problem
        if (params.solution !== undefined) changes.solution = params.solution
        if (params.acceptance_criteria !== undefined) changes.acceptanceCriteria = params.acceptance_criteria
        const spec = await ctx.storage.updateSpec(params.id, changes)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, spec: { id: spec.id, title: spec.title } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'spec_delete',
    'Delete a spec',
    { id: z.string().describe('Spec ID') },
    async (params) => {
      try {
        await ctx.storage.deleteSpec(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: `Deleted spec ${params.id}` }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'spec_add_dependency',
    'Add spec dependency',
    {
      spec_id: z.string().describe('Spec ID'),
      depends_on_id: z.string().describe('ID of spec this depends on'),
    },
    async (params) => {
      try {
        await ctx.storage.addSpecDependency(params.spec_id, params.depends_on_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Dependency added' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'spec_get_dependencies',
    'Get spec dependencies',
    { spec_id: z.string().describe('Spec ID') },
    async (params) => {
      try {
        const deps = await ctx.storage.getSpecDependencies(params.spec_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              dependencies: deps.map((s: Spec) => ({ id: s.id, title: s.title })),
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'spec_get_tickets',
    'Get tickets linked to a spec',
    {
      spec_id: z.string().describe('Spec ID'),
      project: z.string().optional().describe('Project ID'),
    },
    async (params) => {
      try {
        let projectId = params.project
        if (!projectId) {
          const projects = await ctx.storage.listProjects()
          if (projects.length === 0) throw new Error('No projects')
          projectId = projects[0].id
        }
        const tickets = await ctx.storage.getTicketsForSpec(projectId, params.spec_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              tickets: tickets.map((t: Ticket) => ({ id: t.id, title: t.title, statusName: t.statusName })),
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
