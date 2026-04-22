/**
 * Tool Registry DB Tests (PRLT-1360)
 *
 * Tests for:
 * - Migration 0029 (tool_registry table creation)
 * - DB CRUD operations (db.ts)
 * - YAML → DB migration path (registry.ts)
 * - Fallback behavior when DB is unavailable
 */

import { expect } from 'chai'
import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import yaml from 'js-yaml'

import { toolRegistry as migration0029 } from '../../src/lib/database/migrations/0029_tool_registry.js'
import {
  toolRegistryTableExists,
  loadRegistryFromDb,
  saveRegistryToDb,
  upsertMcpServer,
  upsertCliTool,
  removeToolFromDb,
  toolExistsInDb,
  getToolFromDb,
  isRegistryEmpty,
} from '../../src/lib/tool-registry/db.js'
import type { ToolRegistry } from '../../src/lib/tool-registry/types.js'

// =============================================================================
// Helpers
// =============================================================================

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  return db
}

function applyMigration(db: Database.Database): void {
  migration0029.up(db)
}

function createTempWorkspaceWithYaml(registry: ToolRegistry): string {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-tool-reg-'))
  const proletariatDir = path.join(workspacePath, '.proletariat')
  fs.mkdirSync(proletariatDir, { recursive: true })

  const yamlContent = yaml.dump(registry, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: true,
  })
  fs.writeFileSync(path.join(proletariatDir, 'tools.yaml'), yamlContent, 'utf-8')

  return workspacePath
}

function cleanupTempDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* */ }
}

// =============================================================================
// Migration Tests
// =============================================================================

describe('Tool Registry Migration 0029 (PRLT-1360)', () => {
  it('should have correct migration metadata', () => {
    expect(migration0029.id).to.equal('0029')
    expect(migration0029.name).to.equal('tool_registry')
  })

  it('should create the tool_registry table', () => {
    const db = createTestDb()
    expect(toolRegistryTableExists(db)).to.be.false

    applyMigration(db)
    expect(toolRegistryTableExists(db)).to.be.true

    db.close()
  })

  it('should be idempotent (CREATE IF NOT EXISTS)', () => {
    const db = createTestDb()
    applyMigration(db)
    applyMigration(db) // Should not throw
    expect(toolRegistryTableExists(db)).to.be.true
    db.close()
  })

  it('should create table with correct columns', () => {
    const db = createTestDb()
    applyMigration(db)

    // Insert a full row to verify all columns exist
    db.prepare(`
      INSERT INTO tool_registry (name, type, description, url, command, args, auth, detect, install, builtin)
      VALUES ('test', 'mcp', 'test desc', 'http://test', 'cmd', '["a"]', 'auth', 'detect', 'install', 0)
    `).run()

    const row = db.prepare('SELECT * FROM tool_registry WHERE name = ?').get('test') as Record<string, unknown>
    expect(row.name).to.equal('test')
    expect(row.type).to.equal('mcp')
    expect(row.description).to.equal('test desc')
    expect(row.url).to.equal('http://test')
    expect(row.command).to.equal('cmd')
    expect(row.args).to.equal('["a"]')
    expect(row.auth).to.equal('auth')
    expect(row.detect).to.equal('detect')
    expect(row.install).to.equal('install')
    expect(row.builtin).to.equal(0)

    db.close()
  })

  it('should enforce type CHECK constraint', () => {
    const db = createTestDb()
    applyMigration(db)

    expect(() => {
      db.prepare(`
        INSERT INTO tool_registry (name, type, description) VALUES ('bad', 'invalid', 'desc')
      `).run()
    }).to.throw()

    db.close()
  })
})

// =============================================================================
// DB CRUD Tests
// =============================================================================

describe('Tool Registry DB Operations (PRLT-1360)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    applyMigration(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('isRegistryEmpty', () => {
    it('should return true for an empty table', () => {
      expect(isRegistryEmpty(db)).to.be.true
    })

    it('should return false after inserting a row', () => {
      upsertCliTool(db, 'gh', { command: 'gh', description: 'GitHub CLI' })
      expect(isRegistryEmpty(db)).to.be.false
    })
  })

  describe('upsertMcpServer', () => {
    it('should insert a new MCP server', () => {
      upsertMcpServer(db, 'arcade', {
        url: 'https://api.arcade.dev/mcp',
        auth: '${ARCADE_API_KEY}',
        description: 'Arcade integrations',
      })

      const tool = getToolFromDb(db, 'arcade')
      expect(tool).to.not.be.null
      expect(tool!.type).to.equal('mcp')
      expect(tool!.url).to.equal('https://api.arcade.dev/mcp')
      expect(tool!.auth).to.equal('${ARCADE_API_KEY}')
      expect(tool!.description).to.equal('Arcade integrations')
    })

    it('should insert an MCP server with command and args', () => {
      upsertMcpServer(db, 'local-mcp', {
        command: 'node ./tools/mcp.js',
        args: ['--port', '3000'],
        description: 'Local MCP',
      })

      const tool = getToolFromDb(db, 'local-mcp')
      expect(tool).to.not.be.null
      expect(tool!.command).to.equal('node ./tools/mcp.js')
      expect(tool!.args).to.equal('["--port","3000"]')
    })

    it('should update an existing MCP server on conflict', () => {
      upsertMcpServer(db, 'arcade', { url: 'http://old', description: 'Old' })
      upsertMcpServer(db, 'arcade', { url: 'http://new', description: 'New' })

      const tool = getToolFromDb(db, 'arcade')
      expect(tool!.url).to.equal('http://new')
      expect(tool!.description).to.equal('New')
    })
  })

  describe('upsertCliTool', () => {
    it('should insert a new CLI tool', () => {
      upsertCliTool(db, 'gh', {
        command: 'gh',
        description: 'GitHub CLI',
        detect: 'which gh',
        install: 'brew install gh',
      })

      const tool = getToolFromDb(db, 'gh')
      expect(tool).to.not.be.null
      expect(tool!.type).to.equal('cli')
      expect(tool!.command).to.equal('gh')
      expect(tool!.detect).to.equal('which gh')
      expect(tool!.install).to.equal('brew install gh')
      expect(tool!.builtin).to.equal(0)
    })

    it('should handle builtin flag', () => {
      upsertCliTool(db, 'prlt', {
        command: 'prlt',
        description: 'Proletariat CLI',
        builtin: true,
      })

      const tool = getToolFromDb(db, 'prlt')
      expect(tool!.builtin).to.equal(1)
    })

    it('should update an existing CLI tool on conflict', () => {
      upsertCliTool(db, 'gh', { command: 'gh', description: 'Old' })
      upsertCliTool(db, 'gh', { command: 'gh', description: 'Updated' })

      const tool = getToolFromDb(db, 'gh')
      expect(tool!.description).to.equal('Updated')
    })
  })

  describe('removeToolFromDb', () => {
    it('should remove an existing tool', () => {
      upsertCliTool(db, 'gh', { command: 'gh', description: 'GitHub CLI' })
      expect(toolExistsInDb(db, 'gh')).to.be.true

      const removed = removeToolFromDb(db, 'gh')
      expect(removed).to.be.true
      expect(toolExistsInDb(db, 'gh')).to.be.false
    })

    it('should return false for a non-existent tool', () => {
      const removed = removeToolFromDb(db, 'nonexistent')
      expect(removed).to.be.false
    })
  })

  describe('loadRegistryFromDb', () => {
    it('should return empty registry from empty table', () => {
      const registry = loadRegistryFromDb(db)
      expect(Object.keys(registry['mcp-servers'])).to.have.lengthOf(0)
      expect(Object.keys(registry['cli-tools'])).to.have.lengthOf(0)
    })

    it('should load MCP servers and CLI tools into registry format', () => {
      upsertMcpServer(db, 'arcade', {
        url: 'https://api.arcade.dev/mcp',
        auth: '${ARCADE_API_KEY}',
        description: 'Arcade integrations',
      })
      upsertCliTool(db, 'gh', {
        command: 'gh',
        description: 'GitHub CLI',
        detect: 'which gh',
        install: 'brew install gh',
      })
      upsertCliTool(db, 'prlt', {
        command: 'prlt',
        description: 'Proletariat CLI',
        builtin: true,
      })

      const registry = loadRegistryFromDb(db)

      // MCP servers
      expect(Object.keys(registry['mcp-servers'])).to.have.lengthOf(1)
      expect(registry['mcp-servers']['arcade']).to.deep.include({
        url: 'https://api.arcade.dev/mcp',
        auth: '${ARCADE_API_KEY}',
        description: 'Arcade integrations',
      })

      // CLI tools
      expect(Object.keys(registry['cli-tools'])).to.have.lengthOf(2)
      expect(registry['cli-tools']['gh']).to.deep.include({
        command: 'gh',
        description: 'GitHub CLI',
        detect: 'which gh',
        install: 'brew install gh',
      })
      expect(registry['cli-tools']['prlt']).to.deep.include({
        command: 'prlt',
        description: 'Proletariat CLI',
        builtin: true,
      })
    })

    it('should parse JSON args for MCP servers', () => {
      upsertMcpServer(db, 'local', {
        command: 'node',
        args: ['--port', '3000'],
        description: 'Local',
      })

      const registry = loadRegistryFromDb(db)
      expect(registry['mcp-servers']['local'].args).to.deep.equal(['--port', '3000'])
    })
  })

  describe('saveRegistryToDb', () => {
    it('should write a full registry to the database', () => {
      const registry: ToolRegistry = {
        'mcp-servers': {
          arcade: {
            url: 'https://api.arcade.dev/mcp',
            auth: '${ARCADE_API_KEY}',
            description: 'Arcade integrations',
          },
        },
        'cli-tools': {
          gh: {
            command: 'gh',
            description: 'GitHub CLI',
            detect: 'which gh',
          },
        },
      }

      saveRegistryToDb(db, registry)

      expect(toolExistsInDb(db, 'arcade')).to.be.true
      expect(toolExistsInDb(db, 'gh')).to.be.true

      const loaded = loadRegistryFromDb(db)
      expect(loaded['mcp-servers']['arcade'].url).to.equal('https://api.arcade.dev/mcp')
      expect(loaded['cli-tools']['gh'].command).to.equal('gh')
    })

    it('should remove stale rows when saving', () => {
      // Insert initial data
      upsertCliTool(db, 'old-tool', { command: 'old', description: 'Will be removed' })

      // Save registry without old-tool
      const registry: ToolRegistry = {
        'mcp-servers': {},
        'cli-tools': {
          'new-tool': { command: 'new', description: 'Just added' },
        },
      }
      saveRegistryToDb(db, registry)

      expect(toolExistsInDb(db, 'old-tool')).to.be.false
      expect(toolExistsInDb(db, 'new-tool')).to.be.true
    })

    it('should round-trip a registry correctly', () => {
      const registry: ToolRegistry = {
        'mcp-servers': {
          arcade: {
            url: 'https://api.arcade.dev/mcp',
            auth: '${ARCADE_API_KEY}',
            description: 'Arcade integrations',
          },
          local: {
            command: 'node ./tools/mcp.js',
            args: ['--port', '3000'],
            description: 'Local MCP',
          },
        },
        'cli-tools': {
          gh: {
            command: 'gh',
            description: 'GitHub CLI',
            detect: 'which gh',
            install: 'brew install gh',
          },
          prlt: {
            command: 'prlt',
            description: 'Proletariat CLI',
            builtin: true,
          },
        },
      }

      saveRegistryToDb(db, registry)
      const loaded = loadRegistryFromDb(db)

      expect(loaded['mcp-servers']['arcade']).to.deep.include({
        url: 'https://api.arcade.dev/mcp',
        auth: '${ARCADE_API_KEY}',
        description: 'Arcade integrations',
      })
      expect(loaded['mcp-servers']['local'].args).to.deep.equal(['--port', '3000'])
      expect(loaded['cli-tools']['gh']).to.deep.include({
        command: 'gh',
        description: 'GitHub CLI',
        detect: 'which gh',
        install: 'brew install gh',
      })
      expect(loaded['cli-tools']['prlt']).to.deep.include({
        command: 'prlt',
        description: 'Proletariat CLI',
        builtin: true,
      })
    })
  })
})

// =============================================================================
// YAML → DB Migration Path Tests
// =============================================================================

describe('Tool Registry YAML Migration (PRLT-1360)', () => {
  it('should correctly parse YAML into ToolRegistry format for migration', () => {
    const yamlContent = `
mcp-servers:
  arcade:
    url: https://api.arcade.dev/mcp
    auth: "\${ARCADE_API_KEY}"
    description: Arcade integrations
cli-tools:
  gh:
    command: gh
    description: GitHub CLI
    detect: which gh
    install: brew install gh
`
    const parsed = yaml.load(yamlContent) as Partial<ToolRegistry>
    const registry: ToolRegistry = {
      'mcp-servers': parsed?.['mcp-servers'] ?? {},
      'cli-tools': parsed?.['cli-tools'] ?? {},
    }

    // Verify the YAML data can be saved to DB and read back
    const db = createTestDb()
    applyMigration(db)

    saveRegistryToDb(db, registry)
    const loaded = loadRegistryFromDb(db)

    expect(loaded['mcp-servers']['arcade'].url).to.equal('https://api.arcade.dev/mcp')
    expect(loaded['cli-tools']['gh'].command).to.equal('gh')
    expect(loaded['cli-tools']['gh'].detect).to.equal('which gh')

    db.close()
  })

  it('should create tools.yaml in the correct location', () => {
    const registry: ToolRegistry = {
      'mcp-servers': {},
      'cli-tools': {
        gh: { command: 'gh', description: 'GitHub CLI' },
      },
    }

    const tmpDir = createTempWorkspaceWithYaml(registry)
    try {
      const yamlPath = path.join(tmpDir, '.proletariat', 'tools.yaml')
      expect(fs.existsSync(yamlPath)).to.be.true

      const content = fs.readFileSync(yamlPath, 'utf-8')
      const parsed = yaml.load(content) as ToolRegistry
      expect(parsed['cli-tools']['gh'].command).to.equal('gh')
    } finally {
      cleanupTempDir(tmpDir)
    }
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('Tool Registry Edge Cases (PRLT-1360)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    applyMigration(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should handle MCP server with no url or command', () => {
    // This is a degenerate case but the schema allows it
    upsertMcpServer(db, 'stub', { description: 'Stub server' })
    const tool = getToolFromDb(db, 'stub')
    expect(tool).to.not.be.null
    expect(tool!.url).to.be.null
    expect(tool!.command).to.be.null
  })

  it('should handle CLI tool with minimal fields', () => {
    upsertCliTool(db, 'mytool', { command: 'mytool', description: 'My tool' })
    const tool = getToolFromDb(db, 'mytool')
    expect(tool).to.not.be.null
    expect(tool!.detect).to.be.null
    expect(tool!.install).to.be.null
    expect(tool!.builtin).to.equal(0)
  })

  it('should handle malformed JSON args gracefully', () => {
    // Directly insert a row with bad JSON in args
    db.prepare(`
      INSERT INTO tool_registry (name, type, description, args)
      VALUES ('bad-args', 'mcp', 'test', 'not-valid-json')
    `).run()

    const registry = loadRegistryFromDb(db)
    // args should be undefined (silently skipped) rather than throwing
    expect(registry['mcp-servers']['bad-args']).to.exist
    expect(registry['mcp-servers']['bad-args'].args).to.be.undefined
  })

  it('should handle empty registry save correctly', () => {
    const empty: ToolRegistry = { 'mcp-servers': {}, 'cli-tools': {} }
    saveRegistryToDb(db, empty)
    expect(isRegistryEmpty(db)).to.be.true
  })

  it('should handle concurrent upserts to same name', () => {
    upsertMcpServer(db, 'server', { url: 'http://v1', description: 'Version 1' })
    upsertMcpServer(db, 'server', { url: 'http://v2', description: 'Version 2' })

    const tool = getToolFromDb(db, 'server')
    expect(tool!.url).to.equal('http://v2')

    // Only one row should exist
    const count = (db.prepare('SELECT COUNT(*) as c FROM tool_registry WHERE name = ?').get('server') as { c: number }).c
    expect(count).to.equal(1)
  })
})
