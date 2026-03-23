/**
 * MCP Types and Interfaces
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SQLiteStorage } from '../pmo/storage/index.js'
import type { SqliteDatabase } from '../database/sqlite.js'
import type { WorkspaceInfo } from '../agents/commands.js'
import type { ExecutionStorage } from '../execution/storage.js'

export interface McpToolContext {
  storage: SQLiteStorage
  runCommand: (cmd: string) => string
  /** Workspace info — available when running in a workspace with agents */
  getWorkspaceContext?: () => {
    workspaceInfo: WorkspaceInfo
    executionStorage: ExecutionStorage
    db: SqliteDatabase
    pmoPath: string
  }
}

export type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export type ToolRegistrar = (server: McpServer, ctx: McpToolContext) => void
