/**
 * MCP Helper Functions
 */

import type { Ticket } from '../pmo/types.js'
import type { McpToolResult } from './types.js'

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
