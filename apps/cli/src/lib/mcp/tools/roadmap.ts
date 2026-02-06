/**
 * MCP Roadmap Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Roadmap, Project } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { errorResponse } from '../helpers.js'

export function registerRoadmapTools(server: McpServer, ctx: McpToolContext): void {
  server.tool(
    'roadmap_list',
    'List roadmaps',
    {},
    async () => {
      try {
        const roadmaps = await ctx.storage.listRoadmaps()
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              roadmaps: roadmaps.map((r: Roadmap) => ({
                id: r.id,
                name: r.name,
                description: r.description,
                isDefault: r.isDefault,
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
    'roadmap_create',
    'Create a roadmap',
    {
      name: z.string().describe('Roadmap name'),
      description: z.string().optional(),
      is_default: z.boolean().optional(),
    },
    async (params) => {
      try {
        const roadmap = await ctx.storage.createRoadmap({
          name: params.name,
          description: params.description,
          isDefault: params.is_default ?? false,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, roadmap: { id: roadmap.id, name: roadmap.name } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'roadmap_show',
    'Get roadmap with projects',
    { id: z.string().describe('Roadmap ID') },
    async (params) => {
      try {
        const roadmap = await ctx.storage.getRoadmap(params.id)
        if (!roadmap) throw new Error(`Roadmap not found: ${params.id}`)
        const projects = await ctx.storage.listRoadmapProjects(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              roadmap: {
                ...roadmap,
                projects: projects.map((p: Project) => ({ id: p.id, name: p.name })),
              },
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'roadmap_add_project',
    'Add project to roadmap',
    {
      roadmap_id: z.string().describe('Roadmap ID'),
      project_id: z.string().describe('Project ID'),
      position: z.number().optional(),
    },
    async (params) => {
      try {
        await ctx.storage.addProjectToRoadmap(params.roadmap_id, params.project_id, params.position)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Project added to roadmap' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'roadmap_remove_project',
    'Remove project from roadmap',
    {
      roadmap_id: z.string().describe('Roadmap ID'),
      project_id: z.string().describe('Project ID'),
    },
    async (params) => {
      try {
        await ctx.storage.removeProjectFromRoadmap(params.roadmap_id, params.project_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Project removed from roadmap' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  server.tool(
    'roadmap_delete',
    'Delete a roadmap',
    { id: z.string().describe('Roadmap ID') },
    async (params) => {
      try {
        await ctx.storage.deleteRoadmap(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Roadmap deleted' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
