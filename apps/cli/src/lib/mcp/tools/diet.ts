/**
 * MCP Diet & Pull Tools
 *
 * Since PRLT-1299 removed the local ticket store and workflow definitions,
 * diet/pull operations are disabled. The provider (Linear, Jira, etc.) is
 * now the source of truth for ticket status and categorization.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'
import {
  loadDietConfig,
  saveDietConfig,
  parseDietString,
  formatDietConfig,
} from '../../pmo/diet.js'

export function registerDietTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'diet_show',
    'Show current diet configuration',
    {
      project_id: z.string().optional().describe('Project ID (uses default if omitted)'),
    },
    async () => {
      try {
        const db = ctx.storage.getDatabase()
        const dietConfig = loadDietConfig(db)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              diet: formatDietConfig(dietConfig),
              ratios: dietConfig.ratios,
              note: 'Diet distribution report is unavailable — local ticket store has been removed. Use the provider (Linear, Jira) for ticket categorization.',
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'diet_set',
    'Set diet weights (relative values normalized to percentages automatically)',
    {
      ratios: z.string().describe('Diet weights as "category=weight,..." e.g. "ship=4,grow=2.5,support=1.5,bizops=1,strategy=1"'),
    },
    async (params) => {
      try {
        const db = ctx.storage.getDatabase()
        const newConfig = parseDietString(params.ratios)
        saveDietConfig(db, newConfig)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              diet: formatDietConfig(newConfig),
              ratios: newConfig.ratios,
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'pull_tickets',
    'Pull tickets from Backlog to Ready with diet ratio enforcement. Currently disabled — local ticket store removed.',
    {
      project_id: z.string().optional().describe('Project ID'),
      count: z.number().optional().describe('Number of tickets to pull'),
      dry_run: z.boolean().optional().describe('If true, show what would be pulled'),
    },
    async () => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: 'pull_tickets is disabled. The local ticket store has been removed (PRLT-1299). Use the provider (Linear, Jira) to manage ticket status.',
          }, null, 2),
        }],
        isError: true,
      }
    }
  )
}
