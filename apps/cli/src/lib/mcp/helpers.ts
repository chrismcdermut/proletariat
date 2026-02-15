/**
 * MCP Helper Functions
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js'
import type { Ticket } from '../pmo/types.js'
import type { McpToolResult } from './types.js'

/**
 * Register an MCP tool with strict parameter validation.
 *
 * Uses z.object().strict() so that unknown/extra parameters are rejected
 * with a clear error instead of being silently stripped.
 * See: https://github.com/anthropics/proletariat/issues/366
 */
export function strictTool<T extends Record<string, z.ZodType>>(
  server: McpServer,
  name: string,
  description: string,
  shape: T,
  handler: (
    params: { [K in keyof T]: z.infer<T[K]> },
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ) => CallToolResult | Promise<CallToolResult>,
): void {
  const strictSchema = z.object(shape).strict()
  server.registerTool(name, {
    description,
    inputSchema: strictSchema,
  }, handler as Parameters<typeof server.registerTool>[2])
}


export function formatTicket(t: Ticket) {
  return {
    id: t.id,
    title: t.title,
    priority: t.priority,
    category: t.category,
    statusName: t.statusName,
    statusCategory: t.statusCategory,
    projectId: t.projectId,
    assignee: t.assignee,
    owner: t.owner,
    branch: t.branch,
    epicId: t.epicId,
    position: t.position,
  }
}

export function formatTicketFull(t: Ticket) {
  return {
    ...formatTicket(t),
    description: t.description,
    subtasks: t.subtasks,
    labels: t.labels,
    metadata: t.metadata,
    blockedBy: t.blockedBy,
    acceptanceCriteria: t.acceptanceCriteria,
    specId: t.specId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }
}

export function successResponse(data: Record<string, unknown>): McpToolResult {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ success: true, ...data }, null, 2),
    }],
  }
}

export function errorResponse(error: unknown): McpToolResult {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    }],
    isError: true,
  }
}

export function textResponse(text: string): McpToolResult {
  return {
    content: [{ type: 'text' as const, text }],
  }
}
