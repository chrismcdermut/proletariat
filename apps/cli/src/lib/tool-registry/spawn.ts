/**
 * Tool Registry — Spawn-time integration
 *
 * At agent spawn time:
 * 1. Load tool registry and policy profile
 * 2. Filter tools by policy
 * 3. Generate mcp-config.json for MCP servers (passed to Claude Code via --mcp-config)
 * 4. Build tools section for agent prompt (CLI tools + MCP descriptions)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { McpServerConfig, CliToolConfig, ToolPolicy } from './types.js'
import { loadToolRegistry } from './registry.js'
import { loadToolPolicy, filterByPolicy } from './policy.js'

// =============================================================================
// MCP Config Generation
// =============================================================================

interface McpConfigEntry {
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
}

interface McpConfigJson {
  mcpServers: Record<string, McpConfigEntry>
}

/**
 * Generate mcp-config.json content from a list of MCP servers.
 * This JSON is passed to Claude Code via the --mcp-config flag.
 */
export function generateMcpConfig(servers: McpServerConfig[]): McpConfigJson {
  const mcpServers: Record<string, McpConfigEntry> = {}

  for (const server of servers) {
    const entry: McpConfigEntry = {}

    if (server.url) {
      entry.url = server.url
    }

    if (server.command) {
      const parts = server.command.split(/\s+/)
      entry.command = parts[0]
      if (parts.length > 1 || server.args) {
        entry.args = [...parts.slice(1), ...(server.args || [])]
      }
    }

    if (server.auth) {
      // Resolve ${ENV_VAR} references
      const envVar = server.auth.replace(/^\$\{(.+)\}$/, '$1')
      const value = process.env[envVar]
      if (value) {
        entry.env = { [envVar]: value }
      }
    }

    mcpServers[server.name] = entry
  }

  return { mcpServers }
}

/**
 * Write mcp-config.json to a temporary location and return the path.
 * Returns null if there are no MCP servers to configure.
 */
export function writeMcpConfigFile(
  servers: McpServerConfig[],
  outputDir: string
): string | null {
  if (servers.length === 0) return null

  const config = generateMcpConfig(servers)
  fs.mkdirSync(outputDir, { recursive: true })

  const configPath = path.join(outputDir, 'mcp-config.json')
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  return configPath
}

// =============================================================================
// Agent Prompt Injection
// =============================================================================

/**
 * Build the AVAILABLE TOOLS section for agent prompts.
 * Describes MCP servers and CLI tools the agent has access to.
 */
export function buildToolsPromptSection(
  mcpServers: McpServerConfig[],
  cliTools: CliToolConfig[]
): string {
  if (mcpServers.length === 0 && cliTools.length === 0) return ''

  let section = `## Available Tools\n\n`

  if (mcpServers.length > 0) {
    section += `**MCP Servers:**\n`
    for (const server of mcpServers) {
      section += `- ${server.name} (${server.description})\n`
    }
    section += `\n`
  }

  if (cliTools.length > 0) {
    section += `**CLI Tools:**\n`
    for (const tool of cliTools) {
      section += `- ${tool.command} — ${tool.description}\n`
    }
    section += `\n`
  }

  section += `Use these tools for external interactions. Prefer registered tools over raw curl or API calls.\n\n`

  return section
}

// =============================================================================
// Combined Spawn-time Helper
// =============================================================================

export interface SpawnToolsResult {
  mcpConfigPath: string | null
  promptSection: string
  mcpServers: McpServerConfig[]
  cliTools: CliToolConfig[]
}

/**
 * Resolve tools for an agent spawn.
 * Loads registry, applies policy, generates MCP config, builds prompt section.
 *
 * @param hqPath - HQ root path
 * @param policyName - Optional policy profile name (e.g., "code-agent")
 * @param outputDir - Directory for writing mcp-config.json
 */
export function resolveToolsForSpawn(
  hqPath: string,
  policyName: string | undefined,
  outputDir: string
): SpawnToolsResult {
  const registry = loadToolRegistry(hqPath)
  const policy: ToolPolicy | null = policyName
    ? loadToolPolicy(hqPath, policyName)
    : null

  const { mcpServers, cliTools } = filterByPolicy(registry, policy)

  const mcpConfigPath = writeMcpConfigFile(mcpServers, outputDir)
  const promptSection = buildToolsPromptSection(mcpServers, cliTools)

  return { mcpConfigPath, promptSection, mcpServers, cliTools }
}
