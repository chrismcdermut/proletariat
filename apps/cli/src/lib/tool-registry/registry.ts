/**
 * Tool Registry — Load, save, and manage tool configuration
 *
 * Primary storage is the tool_registry table in workspace.db.
 * Falls back to .proletariat/tools.yaml for migration from older workspaces.
 *
 * Migration path:
 * 1. Open workspace DB, read tool_registry table
 * 2. If table is empty AND tools.yaml exists, import YAML data into DB
 * 3. All writes go to DB only
 *
 * PRLT-1360: Move tool registry from tools.yaml to workspace DB
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
import { openWorkspaceDatabase } from '../database/index.js'
import {
  toolRegistryTableExists,
  loadRegistryFromDb,
  saveRegistryToDb,
  upsertMcpServer,
  upsertCliTool,
  upsertApiTool,
  removeToolFromDb,
  isRegistryEmpty,
  getToolFromDb,
} from './db.js'

const TOOLS_FILENAME = 'tools.yaml'

/**
 * Get the path to the tools.yaml file for a given HQ root.
 */
export function getToolsConfigPath(hqPath: string): string {
  return path.join(hqPath, '.proletariat', TOOLS_FILENAME)
}

/**
 * Load tools from the legacy YAML file.
 * Returns null if the file doesn't exist.
 */
function loadFromYaml(hqPath: string): ToolRegistry | null {
  const configPath = getToolsConfigPath(hqPath)
  if (!fs.existsSync(configPath)) {
    return null
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
    return null
  }
}

/**
 * Open the workspace database, run a callback, and close.
 * Returns the callback result, or falls back to YAML-only mode
 * if the database cannot be opened.
 */
function withWorkspaceDb<T>(
  hqPath: string,
  fn: (db: import('better-sqlite3').Database) => T,
  fallback: () => T,
): T {
  try {
    const db = openWorkspaceDatabase(hqPath)
    try {
      return fn(db)
    } finally {
      db.close()
    }
  } catch {
    return fallback()
  }
}

/**
 * Load the tool registry from workspace.db.
 * Falls back to tools.yaml for migration from older workspaces.
 * Returns an empty registry if neither source has data.
 */
export function loadToolRegistry(hqPath: string): ToolRegistry {
  const empty: ToolRegistry = {
    'mcp-servers': {},
    'cli-tools': {},
    'api-tools': {},
  }

  return withWorkspaceDb(
    hqPath,
    (db) => {
      if (!toolRegistryTableExists(db)) {
        // DB doesn't have the table yet (pre-migration) — fall back to YAML
        return loadFromYaml(hqPath) ?? empty
      }

      // If DB table is empty, try migrating from YAML
      if (isRegistryEmpty(db)) {
        const yamlRegistry = loadFromYaml(hqPath)
        if (yamlRegistry && (
          Object.keys(yamlRegistry['mcp-servers']).length > 0 ||
          Object.keys(yamlRegistry['cli-tools']).length > 0 ||
          Object.keys(yamlRegistry['api-tools']).length > 0
        )) {
          // Migrate YAML data into DB
          saveRegistryToDb(db, yamlRegistry)
          return yamlRegistry
        }
      }

      return loadRegistryFromDb(db)
    },
    () => loadFromYaml(hqPath) ?? empty,
  )
}

/**
 * Save the tool registry to workspace.db.
 */
export function saveToolRegistry(hqPath: string, registry: ToolRegistry): void {
  withWorkspaceDb(
    hqPath,
    (db) => {
      if (!toolRegistryTableExists(db)) {
        // Fall back to YAML if table doesn't exist yet
        saveToYaml(hqPath, registry)
        return
      }
      saveRegistryToDb(db, registry)
    },
    () => saveToYaml(hqPath, registry),
  )
}

/**
 * Legacy YAML save — used as fallback when DB is unavailable.
 */
function saveToYaml(hqPath: string, registry: ToolRegistry): void {
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
  withWorkspaceDb(
    hqPath,
    (db) => {
      if (!toolRegistryTableExists(db)) {
        // Fall back to YAML-based add
        const registry = loadFromYaml(hqPath) ?? { 'mcp-servers': {}, 'cli-tools': {}, 'api-tools': {} }
        registry['mcp-servers'][name] = config
        saveToYaml(hqPath, registry)
        return
      }

      // Ensure YAML data is migrated first
      if (isRegistryEmpty(db)) {
        const yamlRegistry = loadFromYaml(hqPath)
        if (yamlRegistry) {
          saveRegistryToDb(db, yamlRegistry)
        }
      }

      upsertMcpServer(db, name, config)
    },
    () => {
      const registry = loadFromYaml(hqPath) ?? { 'mcp-servers': {}, 'cli-tools': {}, 'api-tools': {} }
      registry['mcp-servers'][name] = config
      saveToYaml(hqPath, registry)
    },
  )
}

/**
 * Add a CLI tool to the registry.
 */
export function addCliTool(
  hqPath: string,
  name: string,
  config: Omit<CliToolConfig, 'name'>
): void {
  withWorkspaceDb(
    hqPath,
    (db) => {
      if (!toolRegistryTableExists(db)) {
        const registry = loadFromYaml(hqPath) ?? { 'mcp-servers': {}, 'cli-tools': {}, 'api-tools': {} }
        registry['cli-tools'][name] = config
        saveToYaml(hqPath, registry)
        return
      }

      if (isRegistryEmpty(db)) {
        const yamlRegistry = loadFromYaml(hqPath)
        if (yamlRegistry) {
          saveRegistryToDb(db, yamlRegistry)
        }
      }

      upsertCliTool(db, name, config)
    },
    () => {
      const registry = loadFromYaml(hqPath) ?? { 'mcp-servers': {}, 'cli-tools': {}, 'api-tools': {} }
      registry['cli-tools'][name] = config
      saveToYaml(hqPath, registry)
    },
  )
}

/**
 * Add an API tool to the registry.
 */
export function addApiTool(
  hqPath: string,
  name: string,
  config: Omit<ApiToolConfig, 'name'>
): void {
  withWorkspaceDb(
    hqPath,
    (db) => {
      if (!toolRegistryTableExists(db)) {
        const registry = loadFromYaml(hqPath) ?? { 'mcp-servers': {}, 'cli-tools': {}, 'api-tools': {} }
        registry['api-tools'][name] = config
        saveToYaml(hqPath, registry)
        return
      }

      if (isRegistryEmpty(db)) {
        const yamlRegistry = loadFromYaml(hqPath)
        if (yamlRegistry) {
          saveRegistryToDb(db, yamlRegistry)
        }
      }

      upsertApiTool(db, name, config)
    },
    () => {
      const registry = loadFromYaml(hqPath) ?? { 'mcp-servers': {}, 'cli-tools': {}, 'api-tools': {} }
      registry['api-tools'][name] = config
      saveToYaml(hqPath, registry)
    },
  )
}

/**
 * Remove a tool (MCP, CLI, or API) from the registry.
 * Returns true if the tool was found and removed.
 */
export function removeTool(hqPath: string, name: string): boolean {
  return withWorkspaceDb(
    hqPath,
    (db) => {
      if (!toolRegistryTableExists(db)) {
        return removeFromYaml(hqPath, name)
      }

      // Ensure YAML data is migrated first
      if (isRegistryEmpty(db)) {
        const yamlRegistry = loadFromYaml(hqPath)
        if (yamlRegistry) {
          saveRegistryToDb(db, yamlRegistry)
        }
      }

      // Check if tool is built-in before removing
      const tool = getToolFromDb(db, name)
      if (!tool) return false
      if (tool.builtin) return false

      return removeToolFromDb(db, name)
    },
    () => removeFromYaml(hqPath, name),
  )
}

/**
 * Legacy YAML remove — used as fallback.
 */
function removeFromYaml(hqPath: string, name: string): boolean {
  const registry = loadFromYaml(hqPath)
  if (!registry) return false

  if (name in registry['mcp-servers']) {
    delete registry['mcp-servers'][name]
    saveToYaml(hqPath, registry)
    return true
  }

  if (name in registry['cli-tools']) {
    const tool = registry['cli-tools'][name]
    if (tool.builtin) return false
    delete registry['cli-tools'][name]
    saveToYaml(hqPath, registry)
    return true
  }

  if (name in registry['api-tools']) {
    delete registry['api-tools'][name]
    saveToYaml(hqPath, registry)
    return true
  }

  return false
}
