/**
 * MCP Tool Overrides
 *
 * Manual tool implementations that take precedence over auto-generated tools.
 * When a tool name appears here, the auto-generator skips it and this
 * implementation is used instead.
 *
 * Use overrides for tools that need:
 * - Streaming responses
 * - Custom formatting beyond CLI JSON output
 * - Workspace context access (executionStorage, agent info)
 * - Multi-step orchestration within a single tool call
 *
 * To add an override:
 * 1. Create a file in this directory (e.g., `board-view.ts`)
 * 2. Export a registrar function: (server, ctx) => void
 * 3. Import and add it to the `overrides` map below, keyed by tool name
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../../types.js'

export type OverrideRegistrar = (server: McpServer, ctx: McpToolContext) => void

/**
 * Map of tool names to their manual override implementations.
 * Auto-generation is skipped for any tool name present here.
 */
export const overrides: Record<string, OverrideRegistrar> = {
  // Example:
  // 'board_view': registerBoardViewOverride,
}

/**
 * Get the set of tool names that have manual overrides.
 */
export function getOverriddenToolNames(): Set<string> {
  return new Set(Object.keys(overrides))
}

/**
 * Register all manual override tools on the MCP server.
 */
export function registerOverrides(server: McpServer, ctx: McpToolContext): void {
  for (const registrar of Object.values(overrides)) {
    registrar(server, ctx)
  }
}
