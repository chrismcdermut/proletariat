/**
 * Tool Registry — Load, save, and manage tools.yaml config
 *
 * The tools.yaml file lives at .proletariat/tools.yaml in the HQ root.
 * It registers MCP servers and CLI tools that agents can use.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import yaml from 'js-yaml'
import type {
  ToolRegistry,
  McpServerConfig,
  CliToolConfig,
  ApiToolConfig,
} from './types.js'
import { BUILTIN_PRLT_TOOL } from './types.js'

const TOOLS_FILENAME = 'tools.yaml'

/**
 * Get the path to the tools.yaml file for a given HQ root.
 */
export function getToolsConfigPath(hqPath: string): string {
  return path.join(hqPath, '.proletariat', TOOLS_FILENAME)
}

/**
 * Load the tool registry from .proletariat/tools.yaml.
 * Returns an empty registry if the file doesn't exist.
 */
export function loadToolRegistry(hqPath: string): ToolRegistry {
  const configPath = getToolsConfigPath(hqPath)

  const empty: ToolRegistry = {
    'mcp-servers': {},
    'cli-tools': {},
    'api-tools': {},
  }

  if (!fs.existsSync(configPath)) {
    return empty
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const parsed = yaml.load(content) as Partial<ToolRegistry> | null

    return {
      'mcp-servers': parsed?.['mcp-servers'] ?? {},
      'cli-tools': parsed?.['cli-tools'] ?? {},
      'api-tools': parsed?.['api-tools'] ?? {},
    }
  } catch {
    return empty
  }
}

/**
 * Save the tool registry to .proletariat/tools.yaml.
 */
export function saveToolRegistry(hqPath: string, registry: ToolRegistry): void {
  const configPath = getToolsConfigPath(hqPath)
  const dir = path.dirname(configPath)
  fs.mkdirSync(dir, { recursive: true })

  const content = yaml.dump(registry, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: true,
  })

  fs.writeFileSync(configPath, content, 'utf-8')
}

/**
 * Get all MCP servers from the registry, hydrated with their names.
 */
export function getMcpServers(registry: ToolRegistry): McpServerConfig[] {
  return Object.entries(registry['mcp-servers']).map(([name, config]) => ({
    name,
    ...config,
  }))
}

/**
 * Get all CLI tools from the registry, hydrated with their names.
 * Always includes the built-in prlt tool.
 */
export function getCliTools(registry: ToolRegistry): CliToolConfig[] {
  const tools: CliToolConfig[] = Object.entries(registry['cli-tools']).map(([name, config]) => ({
    name,
    ...config,
  }))

  // Ensure prlt is always present
  if (!tools.some(t => t.name === 'prlt')) {
    tools.push(BUILTIN_PRLT_TOOL)
  }

  return tools
}

/**
 * Get all API tools from the registry, hydrated with their names.
 */
export function getApiTools(registry: ToolRegistry): ApiToolConfig[] {
  return Object.entries(registry['api-tools']).map(([name, config]) => ({
    name,
    ...config,
  }))
}

/**
 * Add an MCP server to the registry.
 */
export function addMcpServer(
  hqPath: string,
  name: string,
  config: Omit<McpServerConfig, 'name'>
): void {
  const registry = loadToolRegistry(hqPath)
  registry['mcp-servers'][name] = config
  saveToolRegistry(hqPath, registry)
}

/**
 * Add a CLI tool to the registry.
 */
export function addCliTool(
  hqPath: string,
  name: string,
  config: Omit<CliToolConfig, 'name'>
): void {
  const registry = loadToolRegistry(hqPath)
  registry['cli-tools'][name] = config
  saveToolRegistry(hqPath, registry)
}

/**
 * Add an API tool to the registry.
 */
export function addApiTool(
  hqPath: string,
  name: string,
  config: Omit<ApiToolConfig, 'name'>
): void {
  const registry = loadToolRegistry(hqPath)
  registry['api-tools'][name] = config
  saveToolRegistry(hqPath, registry)
}

/**
 * Remove a tool (MCP, CLI, or API) from the registry.
 * Returns true if the tool was found and removed.
 */
export function removeTool(hqPath: string, name: string): boolean {
  const registry = loadToolRegistry(hqPath)

  if (name in registry['mcp-servers']) {
    delete registry['mcp-servers'][name]
    saveToolRegistry(hqPath, registry)
    return true
  }

  if (name in registry['cli-tools']) {
    const tool = registry['cli-tools'][name]
    if (tool.builtin) {
      return false // Can't remove built-in tools
    }
    delete registry['cli-tools'][name]
    saveToolRegistry(hqPath, registry)
    return true
  }

  if (name in registry['api-tools']) {
    delete registry['api-tools'][name]
    saveToolRegistry(hqPath, registry)
    return true
  }

  return false
}
