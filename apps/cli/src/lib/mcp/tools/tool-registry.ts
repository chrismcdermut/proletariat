/**
 * MCP Tools - Tool Registry
 *
 * Exposes tool registry operations as MCP tools for AI agents.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../types.js'
import { strictTool, errorResponse } from '../helpers.js'
import {
  readToolRegistry,
  addMcpServer,
  addCliTool,
  removeTool,
  checkTools,
  detectCliTools,
} from '../../tool-registry.js'

/**
 * Register tool registry management tools
 */
export function registerToolRegistryTools(server: McpServer, ctx: McpToolContext): void {
  // tool_registry_list - List all registered tools
  strictTool(
    server,
    'tool_registry_list',
    'List all registered MCP servers and CLI tools in the workspace tool registry',
    {
      type: z.enum(['all', 'mcp', 'cli']).optional().describe('Filter by tool type (default: all)'),
    },
    async (params) => {
      try {
        const workspaceCtx = ctx.getWorkspaceContext?.()
        if (!workspaceCtx) {
          return errorResponse(new Error('No workspace context available'))
        }

        const hqPath = workspaceCtx.workspaceInfo.path
        const registry = readToolRegistry(hqPath)
        const filterType = params.type || 'all'

        const result: Record<string, unknown> = { success: true }
        if (filterType === 'all' || filterType === 'mcp') {
          result['mcp-servers'] = registry['mcp-servers']
        }
        if (filterType === 'all' || filterType === 'cli') {
          result['cli-tools'] = registry['cli-tools']
        }

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

  // tool_registry_add_mcp - Register an MCP server
  strictTool(
    server,
    'tool_registry_add_mcp',
    'Register an MCP server in the workspace tool registry',
    {
      name: z.string().describe('Name for the MCP server'),
      url: z.string().optional().describe('Remote server URL (for HTTP-based MCP servers)'),
      command: z.string().optional().describe('Local command to run (for stdio-based MCP servers)'),
      auth: z.string().optional().describe('Auth environment variable (e.g., ${ARCADE_API_KEY})'),
      description: z.string().describe('Human-readable description'),
    },
    async (params) => {
      try {
        const workspaceCtx = ctx.getWorkspaceContext?.()
        if (!workspaceCtx) {
          return errorResponse(new Error('No workspace context available'))
        }

        if (!params.url && !params.command) {
          return errorResponse(new Error('Either url or command is required for MCP server registration'))
        }

        const hqPath = workspaceCtx.workspaceInfo.path
        addMcpServer(hqPath, params.name, {
          ...(params.url ? { url: params.url } : {}),
          ...(params.command ? { command: params.command } : {}),
          ...(params.auth ? { auth: params.auth } : {}),
          description: params.description,
        })

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, name: params.name, type: 'mcp' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // tool_registry_add_cli - Register a CLI tool
  strictTool(
    server,
    'tool_registry_add_cli',
    'Register a CLI tool in the workspace tool registry',
    {
      name: z.string().describe('Name for the CLI tool'),
      command: z.string().describe('Command to invoke'),
      description: z.string().describe('Human-readable description'),
      detect: z.string().optional().describe('Command to check if tool is installed'),
      install: z.string().optional().describe('Install command hint'),
    },
    async (params) => {
      try {
        const workspaceCtx = ctx.getWorkspaceContext?.()
        if (!workspaceCtx) {
          return errorResponse(new Error('No workspace context available'))
        }

        const hqPath = workspaceCtx.workspaceInfo.path
        addCliTool(hqPath, params.name, {
          command: params.command,
          description: params.description,
          ...(params.detect ? { detect: params.detect } : {}),
          ...(params.install ? { install: params.install } : {}),
        })

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, name: params.name, type: 'cli' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // tool_registry_remove - Remove a tool from the registry
  strictTool(
    server,
    'tool_registry_remove',
    'Remove a tool (MCP server or CLI tool) from the workspace tool registry',
    {
      name: z.string().describe('Name of the tool to remove'),
    },
    async (params) => {
      try {
        const workspaceCtx = ctx.getWorkspaceContext?.()
        if (!workspaceCtx) {
          return errorResponse(new Error('No workspace context available'))
        }

        const hqPath = workspaceCtx.workspaceInfo.path
        const result = removeTool(hqPath, params.name)

        if (result.wasBuiltin) {
          return errorResponse(new Error(`Cannot remove built-in tool: ${params.name}`))
        }
        if (!result.removed) {
          return errorResponse(new Error(`Tool not found: ${params.name}`))
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, name: params.name, type: result.type }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // tool_registry_check - Verify tool availability
  strictTool(
    server,
    'tool_registry_check',
    'Verify all registered tools are available and healthy',
    {},
    async () => {
      try {
        const workspaceCtx = ctx.getWorkspaceContext?.()
        if (!workspaceCtx) {
          return errorResponse(new Error('No workspace context available'))
        }

        const hqPath = workspaceCtx.workspaceInfo.path
        const results = checkTools(hqPath)

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, results }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // tool_registry_detect - Auto-detect CLI tools
  strictTool(
    server,
    'tool_registry_detect',
    'Auto-detect common CLI tools on the system and optionally register them',
    {
      register: z.boolean().optional().describe('Auto-register detected tools (default: false)'),
    },
    async (params) => {
      try {
        const workspaceCtx = ctx.getWorkspaceContext?.()
        if (!workspaceCtx) {
          return errorResponse(new Error('No workspace context available'))
        }

        const hqPath = workspaceCtx.workspaceInfo.path
        const registry = readToolRegistry(hqPath)
        const detected = detectCliTools()

        const newTools = detected.filter(t => !(t.name in registry['cli-tools']))

        if (params.register) {
          for (const tool of newTools) {
            addCliTool(hqPath, tool.name, tool.config)
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              detected: detected.map(t => t.name),
              newTools: newTools.map(t => t.name),
              registered: params.register ? newTools.map(t => t.name) : [],
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
