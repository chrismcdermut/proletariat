/**
 * MCP Template Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { TicketTemplate } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'

export function registerTemplateTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'ticket_template_list',
    'List ticket templates',
    { include_builtin: z.boolean().optional() },
    async (params) => {
      try {
        const templates = await ctx.storage.listTicketTemplates({
          isBuiltin: params.include_builtin ? undefined : false,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              templates: templates.map((t: TicketTemplate) => ({
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
    'ticket_template_show',
    'Get ticket template details',
    { id: z.string().describe('Template ID') },
    async (params) => {
      try {
        const template = await ctx.storage.getTicketTemplate(params.id)
        if (!template) throw new Error(`Template not found: ${params.id}`)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, template }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'ticket_template_create',
    'Create a ticket template',
    {
      name: z.string().describe('Template name'),
      description: z.string().optional(),
      title_pattern: z.string().optional(),
      description_template: z.string().optional(),
      default_priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
      default_category: z.string().optional(),
    },
    async (params) => {
      try {
        const template = await ctx.storage.createTicketTemplate({
          name: params.name,
          description: params.description,
          titlePattern: params.title_pattern,
          descriptionTemplate: params.description_template,
          defaultPriority: params.default_priority,
          defaultCategory: params.default_category,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, template: { id: template.id, name: template.name } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'ticket_template_create_from_ticket',
    'Create template from existing ticket',
    {
      ticket_id: z.string().describe('Ticket ID'),
      name: z.string().describe('Template name'),
      description: z.string().optional(),
    },
    async (params) => {
      try {
        const template = await ctx.storage.createTicketTemplateFromTicket(
          params.ticket_id,
          params.name,
          params.description
        )
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, template: { id: template.id, name: template.name } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'ticket_template_delete',
    'Delete a ticket template',
    { id: z.string().describe('Template ID') },
    async (params) => {
      try {
        await ctx.storage.deleteTicketTemplate(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Template deleted' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
