/**
 * MCP Types and Interfaces
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SQLiteStorage } from '../pmo/storage/index.js'

export interface McpToolContext {
  storage: SQLiteStorage
  runCommand: (cmd: string) => string
}

export type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export type ToolRegistrar = (server: McpServer, ctx: McpToolContext) => void
