/**
 * MCP Tool Overrides Index
 *
 * Manual override implementations that take precedence over auto-generated tools.
 * Add overrides here for tools that need custom MCP logic (e.g., direct tmux
 * interaction, in-process workspace context, streaming, etc.).
 *
 * To add a new override:
 * 1. Create a file in this directory exporting a registrar function and tool names
 * 2. Import and register it below
 * 3. Add the tool names to `overrideToolNames`
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../../types.js'
import { tmuxOverrideNames, registerTmuxOverrides } from './tmux.js'
import { workStartOverrideNames, registerWorkStartOverride } from './work-start.js'

/**
 * Set of tool names that have manual overrides.
 * The auto-generator will skip these names.
 */
export const overrideToolNames: Set<string> = new Set([
  ...tmuxOverrideNames,
  ...workStartOverrideNames,
])

/**
 * Register all manually overridden MCP tools.
 */
export function registerOverrideTools(server: McpServer, ctx: McpToolContext): void {
  registerTmuxOverrides(server, ctx)
  registerWorkStartOverride(server, ctx)
}
