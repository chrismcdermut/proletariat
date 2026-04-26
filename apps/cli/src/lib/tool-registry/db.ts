/**
 * Tool Registry — Database Operations
 *
 * CRUD operations for the tool_registry table in workspace.db.
 * All functions accept a raw better-sqlite3 Database instance.
 *
 * PRLT-1360: Move tool registry from tools.yaml to workspace DB
 */

import type Database from 'better-sqlite3'
import type {
  ToolRegistry,
  McpServerConfig,
  CliToolConfig,
  ApiToolConfig,
} from './types.js'

interface ToolRow {
  name: string
  type: 'mcp' | 'cli' | 'api'
  description: string
  url: string | null
  command: string | null
  args: string | null
  auth: string | null
  auth_header: string | null
  detect: string | null
  install: string | null
  builtin: number
  docs: string | null
  created_at: string
}

/**
 * Check if the tool_registry table exists in the database.
 */
export function toolRegistryTableExists(db: Database.Database): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tool_registry'"
  ).get()
  return !!row
}

/**
 * Read the entire tool registry from the database.
 * Returns a ToolRegistry object matching the YAML schema shape.
 */
export function loadRegistryFromDb(db: Database.Database): ToolRegistry {
  const rows = db.prepare('SELECT * FROM tool_registry').all() as ToolRow[]

  const registry: ToolRegistry = {
    'mcp-servers': {},
    'cli-tools': {},
    'api-tools': {},
  }

  for (const row of rows) {
    if (row.type === 'mcp') {
      const config: Omit<McpServerConfig, 'name'> = {
        description: row.description,
      }
      if (row.url) config.url = row.url
      if (row.command) config.command = row.command
      if (row.args) {
        try { config.args = JSON.parse(row.args) } catch { /* skip malformed args */ }
      }
      if (row.auth) config.auth = row.auth
      registry['mcp-servers'][row.name] = config
    } else if (row.type === 'api') {
      const config: Omit<ApiToolConfig, 'name'> = {
        url: row.url || '',
        description: row.description,
      }
      if (row.auth) config.auth = row.auth
      if (row.auth_header) config.auth_header = row.auth_header
      if (row.docs) config.docs = row.docs
      registry['api-tools'][row.name] = config
    } else {
      const config: Omit<CliToolConfig, 'name'> = {
        command: row.command || row.name,
        description: row.description,
      }
      if (row.detect) config.detect = row.detect
      if (row.install) config.install = row.install
      if (row.builtin) config.builtin = true
      registry['cli-tools'][row.name] = config
    }
  }

  return registry
}

/**
 * Write a full ToolRegistry to the database, replacing all existing rows.
 */
export function saveRegistryToDb(db: Database.Database, registry: ToolRegistry): void {
  const upsert = db.prepare(`
    INSERT INTO tool_registry (name, type, description, url, command, args, auth, auth_header, detect, install, builtin, docs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      type = excluded.type,
      description = excluded.description,
      url = excluded.url,
      command = excluded.command,
      args = excluded.args,
      auth = excluded.auth,
      auth_header = excluded.auth_header,
      detect = excluded.detect,
      install = excluded.install,
      builtin = excluded.builtin,
      docs = excluded.docs
  `)

  const saveAll = db.transaction(() => {
    // Collect all names we're about to insert so we can delete stale rows
    const names = new Set<string>()

    for (const [name, config] of Object.entries(registry['mcp-servers'])) {
      names.add(name)
      upsert.run(
        name, 'mcp', config.description,
        config.url ?? null,
        config.command ?? null,
        config.args ? JSON.stringify(config.args) : null,
        config.auth ?? null,
        null, null, null, 0, null,
      )
    }

    for (const [name, config] of Object.entries(registry['cli-tools'])) {
      names.add(name)
      upsert.run(
        name, 'cli', config.description,
        null,
        config.command,
        null,
        null,
        null,
        config.detect ?? null,
        config.install ?? null,
        config.builtin ? 1 : 0,
        null,
      )
    }

    for (const [name, config] of Object.entries(registry['api-tools'])) {
      names.add(name)
      upsert.run(
        name, 'api', config.description,
        config.url,
        null,
        null,
        config.auth ?? null,
        config.auth_header ?? null,
        null, null, 0,
        config.docs ?? null,
      )
    }

    // Remove rows that are no longer in the registry
    const existing = db.prepare('SELECT name FROM tool_registry').all() as { name: string }[]
    const deleteTool = db.prepare('DELETE FROM tool_registry WHERE name = ?')
    for (const row of existing) {
      if (!names.has(row.name)) {
        deleteTool.run(row.name)
      }
    }
  })

  saveAll()
}

/**
 * Upsert a single MCP server into the tool_registry table.
 */
export function upsertMcpServer(
  db: Database.Database,
  name: string,
  config: Omit<McpServerConfig, 'name'>
): void {
  db.prepare(`
    INSERT INTO tool_registry (name, type, description, url, command, args, auth)
    VALUES (?, 'mcp', ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      type = 'mcp',
      description = excluded.description,
      url = excluded.url,
      command = excluded.command,
      args = excluded.args,
      auth = excluded.auth
  `).run(
    name,
    config.description,
    config.url ?? null,
    config.command ?? null,
    config.args ? JSON.stringify(config.args) : null,
    config.auth ?? null,
  )
}

/**
 * Upsert a single CLI tool into the tool_registry table.
 */
export function upsertCliTool(
  db: Database.Database,
  name: string,
  config: Omit<CliToolConfig, 'name'>
): void {
  db.prepare(`
    INSERT INTO tool_registry (name, type, description, command, detect, install, builtin)
    VALUES (?, 'cli', ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      type = 'cli',
      description = excluded.description,
      command = excluded.command,
      detect = excluded.detect,
      install = excluded.install,
      builtin = excluded.builtin
  `).run(
    name,
    config.description,
    config.command,
    config.detect ?? null,
    config.install ?? null,
    config.builtin ? 1 : 0,
  )
}

/**
 * Upsert a single API tool into the tool_registry table.
 */
export function upsertApiTool(
  db: Database.Database,
  name: string,
  config: Omit<ApiToolConfig, 'name'>
): void {
  db.prepare(`
    INSERT INTO tool_registry (name, type, description, url, auth, auth_header, docs)
    VALUES (?, 'api', ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      type = 'api',
      description = excluded.description,
      url = excluded.url,
      auth = excluded.auth,
      auth_header = excluded.auth_header,
      docs = excluded.docs
  `).run(
    name,
    config.description,
    config.url,
    config.auth ?? null,
    config.auth_header ?? null,
    config.docs ?? null,
  )
}

/**
 * Remove a tool from the database by name.
 * Returns true if a row was deleted.
 */
export function removeToolFromDb(db: Database.Database, name: string): boolean {
  const result = db.prepare('DELETE FROM tool_registry WHERE name = ?').run(name)
  return result.changes > 0
}

/**
 * Check if a tool exists in the database.
 */
export function toolExistsInDb(db: Database.Database, name: string): boolean {
  const row = db.prepare('SELECT name FROM tool_registry WHERE name = ?').get(name)
  return !!row
}

/**
 * Get a single tool row by name.
 */
export function getToolFromDb(db: Database.Database, name: string): ToolRow | null {
  return (db.prepare('SELECT * FROM tool_registry WHERE name = ?').get(name) as ToolRow) ?? null
}

/**
 * Check if the tool_registry table has any rows.
 */
export function isRegistryEmpty(db: Database.Database): boolean {
  const row = db.prepare('SELECT COUNT(*) as count FROM tool_registry').get() as { count: number }
  return row.count === 0
}
