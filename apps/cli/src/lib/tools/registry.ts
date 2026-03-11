/**
 * Tool Registry
 *
 * Load/save .proletariat/tools.yaml and manage registered tools.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import yaml from 'js-yaml'
import type {
  ToolRegistry,
  McpServerEntry,
  CliToolEntry,
} from './types.js'

const TOOLS_FILENAME = 'tools.yaml'

/**
 * Get the path to the tools.yaml file
 */
export function getToolsPath(hqPath: string): string {
  return path.join(hqPath, '.proletariat', TOOLS_FILENAME)
}

/**
 * Load tool registry from .proletariat/tools.yaml
 */
export function loadToolRegistry(hqPath: string): ToolRegistry {
  const toolsPath = getToolsPath(hqPath)

  if (!fs.existsSync(toolsPath)) {
    return { 'mcp-servers': {}, 'cli-tools': {} }
  }

  try {
    const content = fs.readFileSync(toolsPath, 'utf-8')
    const parsed = yaml.load(content) as ToolRegistry | null
    return {
      'mcp-servers': parsed?.['mcp-servers'] ?? {},
      'cli-tools': parsed?.['cli-tools'] ?? {},
    }
  } catch {
    return { 'mcp-servers': {}, 'cli-tools': {} }
  }
}

/**
 * Save tool registry to .proletariat/tools.yaml
 */
export function saveToolRegistry(hqPath: string, registry: ToolRegistry): void {
  const toolsPath = getToolsPath(hqPath)
  const dir = path.dirname(toolsPath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const content = yaml.dump(registry, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    quotingType: "'",
    forceQuotes: false,
  })

  fs.writeFileSync(toolsPath, content)
}

/**
 * Add an MCP server to the registry
 */
export function addMcpServer(hqPath: string, name: string, entry: McpServerEntry): void {
  const registry = loadToolRegistry(hqPath)
  if (!registry['mcp-servers']) {
    registry['mcp-servers'] = {}
  }
  registry['mcp-servers'][name] = entry
  saveToolRegistry(hqPath, registry)
}

/**
 * Add a CLI tool to the registry
 */
export function addCliTool(hqPath: string, name: string, entry: CliToolEntry): void {
  const registry = loadToolRegistry(hqPath)
  if (!registry['cli-tools']) {
    registry['cli-tools'] = {}
  }
  registry['cli-tools'][name] = entry
  saveToolRegistry(hqPath, registry)
}

/**
 * Remove a tool (MCP or CLI) from the registry
 */
export function removeTool(hqPath: string, name: string): { removed: boolean; type?: 'mcp' | 'cli' } {
  const registry = loadToolRegistry(hqPath)

  // Check CLI tools first (check for builtin)
  if (registry['cli-tools']?.[name]) {
    if (registry['cli-tools'][name].builtin) {
      return { removed: false }
    }
    delete registry['cli-tools'][name]
    saveToolRegistry(hqPath, registry)
    return { removed: true, type: 'cli' }
  }

  // Check MCP servers
  if (registry['mcp-servers']?.[name]) {
    delete registry['mcp-servers'][name]
    saveToolRegistry(hqPath, registry)
    return { removed: true, type: 'mcp' }
  }

  return { removed: false }
}

/**
 * Get all tool names (both MCP and CLI)
 */
export function getAllToolNames(registry: ToolRegistry): string[] {
  const mcpNames = Object.keys(registry['mcp-servers'] ?? {})
  const cliNames = Object.keys(registry['cli-tools'] ?? {})
  return [...mcpNames, ...cliNames]
}

/**
 * Ensure prlt is registered as a built-in CLI tool
 */
export function ensureBuiltinTools(registry: ToolRegistry): ToolRegistry {
  if (!registry['cli-tools']) {
    registry['cli-tools'] = {}
  }

  if (!registry['cli-tools']['prlt']) {
    registry['cli-tools']['prlt'] = {
      command: 'prlt',
      description: 'Proletariat CLI (always available)',
      builtin: true,
    }
  }

  return registry
}
