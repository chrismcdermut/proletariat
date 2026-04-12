/**
 * MCP Ticket Tools
 *
 * Since PRLT-1299 removed the local ticket store, all ticket operations
 * are delegated to the `prlt` CLI which routes through the provider
 * (Linear, Jira, etc.).
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'
import { getWorkspacePriorities, setWorkspacePriorities } from '../../work-lifecycle/settings.js'

/** Run a prlt command and parse JSON output. */
function runPrlt(ctx: McpToolContext, cmd: string): unknown {
  const output = ctx.runCommand(cmd)
  try {
    return JSON.parse(output)
  } catch {
    return { success: true, raw: output }
  }
}

export function registerTicketTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'ticket_list',
    'List tickets with optional filters. Returns summary fields only (no descriptions). Use ticket_show for full details.',
    {
      project: z.string().optional().describe('Project ID'),
      column: z.string().optional().describe('Filter by column/status'),
      priority: z.string().optional().describe('Filter by priority (uses workspace priority scale)'),
      category: z.string().optional().describe('Filter by category'),
      assignee: z.string().optional().describe('Filter by assignee'),
      owner: z.string().optional().describe('Filter by owner'),
      search: z.string().optional().describe('Search in title/description'),
      all_projects: z.boolean().optional().describe('List from all projects'),
      limit: z.number().min(1).optional().describe('Maximum number of tickets to return (default: 50)'),
      offset: z.number().min(0).optional().describe('Number of tickets to skip for pagination (default: 0)'),
    },
    async (params) => {
      try {
        const args: string[] = ['prlt ticket list --json']
        if (params.project) args.push(`-P ${params.project}`)
        if (params.column) args.push(`--column "${params.column}"`)
        if (params.priority) args.push(`--priority "${params.priority}"`)
        if (params.category) args.push(`--category "${params.category}"`)
        if (params.assignee) args.push(`--assignee "${params.assignee}"`)
        if (params.search) args.push(`--search "${params.search}"`)
        const result = runPrlt(ctx, args.join(' '))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'ticket_create',
    'Create a new ticket',
    {
      title: z.string().describe('Ticket title (required)'),
      project: z.string().optional().describe('Project ID'),
      description: z.string().optional().describe('Ticket description'),
      priority: z.string().optional().describe('Priority (uses workspace priority scale)'),
      category: z.string().optional().describe('Category (feature, bug, etc.)'),
      column: z.string().optional().describe('Column/status name'),
      assignee: z.string().optional().describe('Assignee'),
    },
    async (params) => {
      try {
        const args: string[] = ['prlt ticket create --json']
        args.push(`--title "${params.title.replace(/"/g, '\\"')}"`)
        if (params.project) args.push(`-P ${params.project}`)
        if (params.description) args.push(`--description "${params.description.replace(/"/g, '\\"')}"`)
        if (params.priority) args.push(`--priority "${params.priority}"`)
        if (params.category) args.push(`--category "${params.category}"`)
        if (params.assignee) args.push(`--assignee "${params.assignee}"`)
        const result = runPrlt(ctx, args.join(' '))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'ticket_show',
    'Get detailed ticket information',
    { id: z.string().describe('Ticket ID') },
    async (params) => {
      try {
        const result = runPrlt(ctx, `prlt ticket show ${params.id} --json`)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'ticket_update',
    'Update a ticket',
    {
      id: z.string().describe('Ticket ID'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      priority: z.string().optional().describe('New priority (uses workspace priority scale)'),
      category: z.string().optional().describe('New category'),
      assignee: z.string().optional().describe('New assignee'),
    },
    async (params) => {
      try {
        const args: string[] = [`prlt ticket edit ${params.id} --json`]
        if (params.title) args.push(`--title "${params.title.replace(/"/g, '\\"')}"`)
        if (params.description) args.push(`--description "${params.description.replace(/"/g, '\\"')}"`)
        if (params.priority) args.push(`--priority "${params.priority}"`)
        if (params.category) args.push(`--category "${params.category}"`)
        if (params.assignee) args.push(`--assignee "${params.assignee}"`)
        const result = runPrlt(ctx, args.join(' '))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'ticket_move',
    'Move ticket to a different column/status',
    {
      id: z.string().describe('Ticket ID'),
      column: z.string().describe('Target column/status'),
    },
    async (params) => {
      try {
        const result = runPrlt(ctx, `prlt ticket move ${params.id} "${params.column}" --json`)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'ticket_delete',
    'Delete a ticket',
    { id: z.string().describe('Ticket ID') },
    async (params) => {
      try {
        const result = runPrlt(ctx, `prlt ticket delete ${params.id} --json`)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'ticket_add_subtask',
    'Add a subtask to a ticket',
    {
      ticket_id: z.string().describe('Ticket ID'),
      title: z.string().describe('Subtask title'),
    },
    async (params) => {
      try {
        const result = runPrlt(ctx, `prlt ticket edit ${params.ticket_id} --add-subtask "${params.title.replace(/"/g, '\\"')}" --json`)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'ticket_add_acceptance_criterion',
    'Add acceptance criterion to a ticket',
    {
      ticket_id: z.string().describe('Ticket ID'),
      criterion: z.string().describe('Acceptance criterion text'),
    },
    async (params) => {
      try {
        const result = runPrlt(ctx, `prlt ticket edit ${params.ticket_id} --add-ac "${params.criterion.replace(/"/g, '\\"')}" --json`)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'priority_list',
    'List the workspace priority scale (ordered from highest to lowest)',
    {},
    async () => {
      try {
        const db = ctx.storage.getDatabase()
        const priorities = getWorkspacePriorities(db)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, priorities }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'priority_set',
    'Set the workspace priority scale (replaces all existing priorities)',
    {
      priorities: z.array(z.string()).min(1).describe('Priority values from highest to lowest'),
    },
    async (params) => {
      try {
        const db = ctx.storage.getDatabase()
        const seen = new Set<string>()
        for (const p of params.priorities) {
          if (seen.has(p)) throw new Error(`Duplicate priority value: "${p}"`)
          seen.add(p)
        }
        const oldPriorities = getWorkspacePriorities(db)
        setWorkspacePriorities(db, params.priorities)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              previous: oldPriorities,
              priorities: params.priorities,
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
