/**
 * MCP Server Command
 *
 * Comprehensive MCP (Model Context Protocol) server exposing ALL prlt commands
 * as tools for AI agent integration.
 *
 * Usage in Claude Code config:
 * ```json
 * {
 *   "mcpServers": {
 *     "prlt": { "command": "prlt", "args": ["mcp-server"] }
 *   }
 * }
 * ```
 */

import { Command } from '@oclif/core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { getPMOContext } from '../lib/pmo/pmo-context.js'
import type { McpToolContext } from '../lib/mcp/types.js'
import { getWorkspaceInfo } from '../lib/agents/commands.js'
import { ExecutionStorage } from '../lib/execution/storage.js'
import {
  registerTicketTools,
  registerProjectTools,
  registerBoardTools,
  registerSpecTools,
  registerEpicTools,
  registerWorkTools,
  registerWorkflowTools,
  registerStatusTools,
  registerPhaseTools,
  registerActionTools,
  registerRoadmapTools,
  registerCategoryTools,
  registerTemplateTools,
  registerViewTools,
  registerDietTools,
  registerLabelTools,
  registerTmuxTools,
  registerAgentTools,
  registerDockerTools,
  registerRepoTools,
  registerBranchTools,
  registerGitHubTools,
  registerInitTools,
  registerUtilityTools,
  registerToolRegistryTools,
} from '../lib/mcp/index.js'

export default class McpServerCommand extends Command {
  static description = 'Start MCP server for AI agent integration (exposes all prlt commands as tools)'

  static hidden = true

  static examples = ['<%= config.bin %> mcp-server']

  async run(): Promise<void> {
    // Initialize PMO context (may be null if not in a workspace)
    let pmoContext = null
    try {
      pmoContext = await getPMOContext({ logger: () => {} })
    } catch {
      pmoContext = null
    }

    // Create MCP server
    const server = new McpServer({
      name: 'prlt',
      version: this.config.version,
    })

    // Try to initialize workspace context for execution support
    let workspaceContext: ReturnType<NonNullable<McpToolContext['getWorkspaceContext']>> | null = null
    try {
      const workspaceInfo = getWorkspaceInfo()
      if (workspaceInfo && pmoContext) {
        const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
        const db = new Database(dbPath)
        const executionStorage = new ExecutionStorage(db)
        workspaceContext = {
          workspaceInfo,
          executionStorage,
          db,
          pmoPath: pmoContext.pmoPath,
        }
      }
    } catch {
      // Not in a workspace — workspace context will be null
    }

    // Create tool context
    const ctx: McpToolContext = {
      get storage() {
        if (!pmoContext) {
          throw new Error('PMO not initialized. Run "prlt new" first.')
        }
        return pmoContext.storage
      },
      runCommand: (cmd: string): string => {
        try {
          const result = execSync(cmd, {
            encoding: 'utf-8',
            cwd: process.cwd(),
            env: {
              ...process.env,
              PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
            },
            maxBuffer: 10 * 1024 * 1024,
          })
          return result.trim()
        } catch (error: unknown) {
          const execError = error as { stderr?: string; stdout?: string; message?: string }
          if (execError.stderr) return execError.stderr.trim()
          if (execError.stdout) return execError.stdout.trim()
          throw error
        }
      },
      getWorkspaceContext: workspaceContext
        ? () => workspaceContext!
        : undefined,
    }

    // Register all tool categories
    registerTicketTools(server, ctx)
    registerProjectTools(server, ctx)
    registerBoardTools(server, ctx)
    registerSpecTools(server, ctx)
    registerEpicTools(server, ctx)
    registerWorkTools(server, ctx)
    registerWorkflowTools(server, ctx)
    registerStatusTools(server, ctx)
    registerPhaseTools(server, ctx)
    registerActionTools(server, ctx)
    registerRoadmapTools(server, ctx)
    registerCategoryTools(server, ctx)
    registerTemplateTools(server, ctx)
    registerViewTools(server, ctx)
    registerDietTools(server, ctx)
    registerLabelTools(server, ctx)
    registerTmuxTools(server, ctx)
    registerAgentTools(server, ctx)
    registerDockerTools(server, ctx)
    registerRepoTools(server, ctx)
    registerBranchTools(server, ctx)
    registerGitHubTools(server, ctx)
    registerInitTools(server, ctx)
    registerUtilityTools(server, ctx)
    registerToolRegistryTools(server, ctx)

    // Connect via stdio transport
    const transport = new StdioServerTransport()
    await server.connect(transport)
  }
}
