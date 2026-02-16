/**
 * MCP Label Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'

export function registerLabelTools(server: McpServer, ctx: McpToolContext): void {
  // ===========================================================================
  // Label Group Tools
  // ===========================================================================

  strictTool(server,
    'label_group_list',
    'List all label groups',
    {
      search: z.string().optional().describe('Search in name/description'),
    },
    async (params) => {
      try {
        const groups = await ctx.storage.listLabelGroups({
          search: params.search,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              count: groups.length,
              groups: groups.map(g => ({
                id: g.id,
                name: g.name,
                description: g.description,
                isExclusive: g.isExclusive,
                isRequired: g.isRequired,
                position: g.position,
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
    'label_group_create',
    'Create a new label group',
    {
      name: z.string().describe('Group name (must be unique)'),
      description: z.string().optional().describe('Group description'),
      is_exclusive: z.boolean().optional().describe('Only one label from this group per ticket (default: true)'),
      is_required: z.boolean().optional().describe('Must have one label from this group (default: false)'),
    },
    async (params) => {
      try {
        const group = await ctx.storage.createLabelGroup({
          name: params.name,
          description: params.description,
          isExclusive: params.is_exclusive,
          isRequired: params.is_required,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              group: {
                id: group.id,
                name: group.name,
                description: group.description,
                isExclusive: group.isExclusive,
                isRequired: group.isRequired,
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
    'label_group_update',
    'Update a label group',
    {
      id: z.string().describe('Group ID'),
      name: z.string().optional().describe('New name'),
      description: z.string().optional().describe('New description'),
      is_exclusive: z.boolean().optional().describe('Only one label from this group per ticket'),
      is_required: z.boolean().optional().describe('Must have one label from this group'),
    },
    async (params) => {
      try {
        const changes: Record<string, unknown> = {}
        if (params.name !== undefined) changes.name = params.name
        if (params.description !== undefined) changes.description = params.description
        if (params.is_exclusive !== undefined) changes.isExclusive = params.is_exclusive
        if (params.is_required !== undefined) changes.isRequired = params.is_required
        const group = await ctx.storage.updateLabelGroup(params.id, changes)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              group: {
                id: group.id,
                name: group.name,
                description: group.description,
                isExclusive: group.isExclusive,
                isRequired: group.isRequired,
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
    'label_group_delete',
    'Delete a label group (labels in the group become ungrouped)',
    {
      id: z.string().describe('Group ID'),
    },
    async (params) => {
      try {
        await ctx.storage.deleteLabelGroup(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: `Deleted label group ${params.id}` }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // ===========================================================================
  // Label Tools
  // ===========================================================================

  strictTool(server,
    'label_list',
    'List all labels, optionally filtered by group',
    {
      group: z.string().optional().describe('Filter by group ID'),
      search: z.string().optional().describe('Search in name/description'),
    },
    async (params) => {
      try {
        const labels = await ctx.storage.listLabels({
          groupId: params.group,
          search: params.search,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              count: labels.length,
              labels: labels.map(l => ({
                id: l.id,
                name: l.name,
                color: l.color,
                description: l.description,
                groupId: l.groupId,
                groupName: l.groupName,
                isBuiltin: l.isBuiltin,
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
    'label_create',
    'Create a new label',
    {
      name: z.string().describe('Label name'),
      color: z.string().optional().describe('Label color (hex, e.g. #ff0000)'),
      description: z.string().optional().describe('Label description'),
      group_id: z.string().optional().describe('Label group ID to add this label to'),
    },
    async (params) => {
      try {
        const label = await ctx.storage.createLabel({
          name: params.name,
          color: params.color,
          description: params.description,
          groupId: params.group_id,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              label: {
                id: label.id,
                name: label.name,
                color: label.color,
                description: label.description,
                groupId: label.groupId,
                groupName: label.groupName,
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
    'label_update',
    'Update a label (rename, recolor, regroup)',
    {
      id: z.string().describe('Label ID'),
      name: z.string().optional().describe('New name'),
      color: z.string().optional().describe('New color (hex)'),
      description: z.string().optional().describe('New description'),
      group_id: z.string().optional().describe('Move to different group'),
    },
    async (params) => {
      try {
        const changes: Record<string, unknown> = {}
        if (params.name !== undefined) changes.name = params.name
        if (params.color !== undefined) changes.color = params.color
        if (params.description !== undefined) changes.description = params.description
        if (params.group_id !== undefined) changes.groupId = params.group_id
        const label = await ctx.storage.updateLabel(params.id, changes)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              label: {
                id: label.id,
                name: label.name,
                color: label.color,
                description: label.description,
                groupId: label.groupId,
                groupName: label.groupName,
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
    'label_delete',
    'Delete a label (removes from all tickets)',
    {
      id: z.string().describe('Label ID'),
    },
    async (params) => {
      try {
        await ctx.storage.deleteLabel(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: `Deleted label ${params.id}` }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // ===========================================================================
  // Ticket-Label Association Tools
  // ===========================================================================

  strictTool(server,
    'ticket_add_label',
    'Add a label to a ticket. For exclusive groups, replaces existing label from same group.',
    {
      ticket_id: z.string().describe('Ticket ID'),
      label: z.string().describe('Label ID or name (supports group:name format)'),
    },
    async (params) => {
      try {
        // Try by ID first, then by name
        const labelById = await ctx.storage.getLabel(params.label)
        if (labelById) {
          await ctx.storage.addLabelToTicket(params.ticket_id, labelById.id)
        } else {
          await ctx.storage.addLabelToTicketByName(params.ticket_id, params.label)
        }
        const labels = await ctx.storage.getLabelsForTicket(params.ticket_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              message: `Label added to ${params.ticket_id}`,
              labels: labels.map(l => ({
                id: l.id,
                name: l.name,
                groupName: l.groupName,
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
    'ticket_remove_label',
    'Remove a label from a ticket',
    {
      ticket_id: z.string().describe('Ticket ID'),
      label: z.string().describe('Label ID or name'),
    },
    async (params) => {
      try {
        const labelById = await ctx.storage.getLabel(params.label)
        if (labelById) {
          await ctx.storage.removeLabelFromTicket(params.ticket_id, labelById.id)
        } else {
          await ctx.storage.removeLabelFromTicketByName(params.ticket_id, params.label)
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              message: `Label removed from ${params.ticket_id}`,
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'ticket_labels',
    'List all labels on a ticket',
    {
      ticket_id: z.string().describe('Ticket ID'),
    },
    async (params) => {
      try {
        const labels = await ctx.storage.getLabelsForTicket(params.ticket_id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              count: labels.length,
              labels: labels.map(l => ({
                id: l.id,
                name: l.name,
                color: l.color,
                groupId: l.groupId,
                groupName: l.groupName,
              })),
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
