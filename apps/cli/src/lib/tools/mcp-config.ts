/**
 * MCP Config Generation
 *
 * Generate mcp-config.json for Claude Code from resolved MCP servers.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { ResolvedMcpServer, ClaudeMcpConfig, ClaudeMcpServerConfig } from './types.js'

/**
 * Resolve environment variable references in auth strings.
 * Handles ${VAR_NAME} syntax by looking up the env var value.
 */
function resolveEnvVar(authRef: string): string {
  // Match ${VAR_NAME} pattern
  const match = authRef.match(/^\$\{(.+)\}$/)
  if (match) {
    const envValue = process.env[match[1]]
    return envValue ?? ''
  }
  // If no ${} pattern, treat as literal or env var name
  return process.env[authRef] ?? authRef
}

/**
 * Generate a Claude Code MCP config object from resolved servers.
 */
export function generateMcpConfig(servers: ResolvedMcpServer[]): ClaudeMcpConfig {
  const mcpServers: Record<string, ClaudeMcpServerConfig> = {}

  for (const server of servers) {
    const config: ClaudeMcpServerConfig = {}

    if (server.url) {
      config.url = server.url
    }

    if (server.command) {
      const parts = server.command.split(/\s+/)
      config.command = parts[0]
      if (parts.length > 1 || (server.args && server.args.length > 0)) {
        config.args = [...parts.slice(1), ...(server.args ?? [])]
      }
    }

    if (server.auth) {
      const authValue = resolveEnvVar(server.auth)
      if (authValue) {
        config.env = { ...config.env }
        // Use a generic key based on the server name
        const envKey = server.auth.match(/^\$\{(.+)\}$/)?.[1] ?? `${server.name.toUpperCase()}_API_KEY`
        config.env[envKey] = authValue
      }
    }

    mcpServers[server.name] = config
  }

  return { mcpServers }
}

/**
 * Write MCP config to a temporary file and return the path.
 * Used to pass to Claude Code via --mcp-config flag.
 */
export function writeMcpConfigFile(
  config: ClaudeMcpConfig,
  basePath?: string,
): string {
  const dir = basePath
    ? path.join(basePath, '.proletariat', 'scripts')
    : path.join(os.tmpdir(), 'prlt-mcp')

  fs.mkdirSync(dir, { recursive: true })

  const timestamp = Date.now()
  const configPath = path.join(dir, `mcp-config-${timestamp}.json`)
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

  return configPath
}
