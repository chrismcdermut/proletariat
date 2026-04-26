/**
 * Tool Detection and Health Checking
 *
 * Detects available CLI tools and verifies MCP server connectivity.
 */

import { execSync } from 'node:child_process'
import type {
  ToolRegistry,
  CliToolConfig,
  McpServerConfig,
  ApiToolConfig,
  ToolCheckResult,
} from './types.js'
import { COMMON_CLI_TOOLS } from './types.js'
import { getMcpServers, getCliTools, getApiTools } from './registry.js'

/**
 * Check if a CLI tool is available on the system.
 */
export function isCliToolAvailable(tool: CliToolConfig): boolean {
  const detectCmd = tool.detect || `which ${tool.command}`
  try {
    execSync(detectCmd, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Auto-detect common CLI tools available on the system.
 * Returns tools that are detected and not already in the registry.
 */
export function detectAvailableTools(registry: ToolRegistry): CliToolConfig[] {
  const existingNames = new Set(Object.keys(registry['cli-tools']))
  const detected: CliToolConfig[] = []

  for (const tool of COMMON_CLI_TOOLS) {
    if (existingNames.has(tool.name)) continue
    if (isCliToolAvailable(tool)) {
      detected.push(tool)
    }
  }

  return detected
}

/**
 * Check health of all registered tools.
 * Returns status for each tool (available or not).
 */
export async function checkAllTools(registry: ToolRegistry): Promise<ToolCheckResult[]> {
  const results: ToolCheckResult[] = []

  // Check MCP servers
  for (const server of getMcpServers(registry)) {
    results.push(checkMcpServer(server))
  }

  // Check CLI tools
  for (const tool of getCliTools(registry)) {
    results.push(checkCliTool(tool))
  }

  // Check API tools
  for (const tool of getApiTools(registry)) {
    results.push(await checkApiTool(tool))
  }

  return results
}

function checkMcpServer(server: McpServerConfig): ToolCheckResult {
  // For URL-based servers, check if the auth env var is set
  if (server.url && server.auth) {
    const envVar = server.auth.replace(/^\$\{(.+)\}$/, '$1')
    const hasAuth = !!process.env[envVar]
    return {
      name: server.name,
      type: 'mcp',
      available: hasAuth,
      error: hasAuth ? undefined : `Missing environment variable: ${envVar}`,
    }
  }

  // For command-based servers, check if the command exists
  if (server.command) {
    const cmd = server.command.split(' ')[0]
    try {
      execSync(`which ${cmd}`, { stdio: 'pipe' })
      return { name: server.name, type: 'mcp', available: true }
    } catch {
      return {
        name: server.name,
        type: 'mcp',
        available: false,
        error: `Command not found: ${cmd}`,
      }
    }
  }

  // URL-based without auth — assume available
  return { name: server.name, type: 'mcp', available: true }
}

function checkCliTool(tool: CliToolConfig): ToolCheckResult {
  const available = isCliToolAvailable(tool)
  return {
    name: tool.name,
    type: 'cli',
    available,
    error: available ? undefined : `Command not found: ${tool.command}`,
    installHint: available ? undefined : tool.install,
  }
}

async function checkApiTool(tool: ApiToolConfig): Promise<ToolCheckResult> {
  // Check auth env var if required
  if (tool.auth) {
    const hasAuth = !!process.env[tool.auth]
    if (!hasAuth) {
      return {
        name: tool.name,
        type: 'api',
        available: false,
        error: `Missing environment variable: ${tool.auth}`,
      }
    }
  }

  // Check if the API URL is reachable
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const response = await fetch(tool.url, {
      method: 'HEAD',
      signal: controller.signal,
    })
    clearTimeout(timeout)
    // Any response (even 4xx/5xx) means the server is reachable
    return {
      name: tool.name,
      type: 'api',
      available: true,
    }
  } catch {
    return {
      name: tool.name,
      type: 'api',
      available: false,
      error: `API not reachable: ${tool.url}`,
    }
  }
}
