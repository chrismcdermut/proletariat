/**
 * MCP Phase Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ProjectPhase, PhaseTemplate } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'

export function registerPhaseTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'phase_list',
    'List project phases',
    { category: z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']).optional() },
    async (params) => {
      try {
        const phases = await ctx.storage.listPhases({ category: params.category })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              phases: phases.map((p: ProjectPhase) => ({
                id: p.id,
                name: p.name,
                category: p.category,
                position: p.position,
                isDefault: p.isDefault,
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
    'phase_create',
    'Create a project phase',
    {
      name: z.string().describe('Phase name'),
      category: z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']),
      position: z.number().optional(),
      is_default: z.boolean().optional(),
    },
    async (params) => {
      try {
        const phase = await ctx.storage.createPhase({
          name: params.name,
          category: params.category,
          position: params.position,
          isDefault: params.is_default,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, phase: { id: phase.id, name: phase.name } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'phase_update',
    'Update a phase',
    {
      id: z.string().describe('Phase ID'),
      name: z.string().optional(),
      category: z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']).optional(),
    },
    async (params) => {
      try {
        const changes: Partial<ProjectPhase> = {}
        if (params.name) changes.name = params.name
        if (params.category) changes.category = params.category
        const phase = await ctx.storage.updatePhase(params.id, changes)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, phase: { id: phase.id, name: phase.name } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'phase_delete',
    'Delete a phase',
    { id: z.string().describe('Phase ID') },
    async (params) => {
      try {
        await ctx.storage.deletePhase(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Phase deleted' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'phase_template_list',
    'List phase templates',
    {},
    async () => {
      try {
        const templates = await ctx.storage.listPhaseTemplates()
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              templates: templates.map((t: PhaseTemplate) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                isBuiltin: t.isBuiltin,
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
    'phase_template_apply',
    'Apply a phase template',
    { template_id: z.string().describe('Template ID') },
    async (params) => {
      try {
        const phases = await ctx.storage.applyPhaseTemplate(params.template_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              message: `Applied template, created ${phases.length} phases`,
              phases: phases.map((p: ProjectPhase) => ({ id: p.id, name: p.name })),
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
