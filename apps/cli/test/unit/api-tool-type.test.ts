/**
 * API Tool Type Tests (PRLT-1361)
 *
 * Tests for:
 * - Migration 0030 (api_tool_columns — auth_header, docs, type constraint)
 * - DB CRUD operations for API tools
 * - API tool prompt injection in spawn.ts
 * - API tool policy filtering
 * - API tool health checking in detect.ts
 * - Registry getApiTools helper
 */

import { expect } from 'chai'
import Database from 'better-sqlite3'

import { toolRegistry as migration0029 } from '../../src/lib/database/migrations/0029_tool_registry.js'
import { apiToolColumns as migration0030 } from '../../src/lib/database/migrations/0030_api_tool_columns.js'
import {
  loadRegistryFromDb,
  saveRegistryToDb,
  upsertApiTool,
  upsertMcpServer,
  upsertCliTool,
  removeToolFromDb,
  toolExistsInDb,
  getToolFromDb,
  isRegistryEmpty,
} from '../../src/lib/tool-registry/db.js'
import { buildToolsPromptSection } from '../../src/lib/tool-registry/spawn.js'
import { filterByPolicy } from '../../src/lib/tool-registry/policy.js'
import type { ToolRegistry, ToolPolicy, ApiToolConfig } from '../../src/lib/tool-registry/types.js'

// =============================================================================
// Helpers
// =============================================================================

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  return db
}

function applyMigrations(db: Database.Database): void {
  migration0029.up(db)
  migration0030.up(db)
}

function makeRegistry(overrides?: Partial<ToolRegistry>): ToolRegistry {
  return {
    'mcp-servers': {},
    'cli-tools': {},
    'api-tools': {},
    ...overrides,
  }
}

// =============================================================================
// Migration 0030 Tests
// =============================================================================

describe('API Tool Migration 0030 (PRLT-1361)', () => {
  it('should have correct migration metadata', () => {
    expect(migration0030.id).to.equal('0030')
    expect(migration0030.name).to.equal('api_tool_columns')
  })

  it('should add auth_header and docs columns', () => {
    const db = createTestDb()
    migration0029.up(db)
    migration0030.up(db)

    // Verify columns exist by inserting an API tool
    db.prepare(`
      INSERT INTO tool_registry (name, type, description, url, auth, auth_header, docs)
      VALUES ('test-api', 'api', 'Test API', 'https://api.test.com', 'TEST_KEY', 'X-API-Key', 'https://docs.test.com')
    `).run()

    const row = db.prepare('SELECT * FROM tool_registry WHERE name = ?').get('test-api') as Record<string, unknown>
    expect(row.type).to.equal('api')
    expect(row.auth_header).to.equal('X-API-Key')
    expect(row.docs).to.equal('https://docs.test.com')

    db.close()
  })

  it('should allow api type in CHECK constraint', () => {
    const db = createTestDb()
    applyMigrations(db)

    // Should succeed with 'api' type
    expect(() => {
      db.prepare(`INSERT INTO tool_registry (name, type, description, url) VALUES ('valid-api', 'api', 'test', 'https://example.com')`).run()
    }).to.not.throw()

    // Should still allow 'mcp' and 'cli'
    expect(() => {
      db.prepare(`INSERT INTO tool_registry (name, type, description) VALUES ('valid-mcp', 'mcp', 'test')`).run()
    }).to.not.throw()
    expect(() => {
      db.prepare(`INSERT INTO tool_registry (name, type, description, command) VALUES ('valid-cli', 'cli', 'test', 'test')`).run()
    }).to.not.throw()

    // Should reject invalid type
    expect(() => {
      db.prepare(`INSERT INTO tool_registry (name, type, description) VALUES ('invalid', 'webhook', 'test')`).run()
    }).to.throw()

    db.close()
  })

  it('should preserve existing data during migration', () => {
    const db = createTestDb()
    migration0029.up(db)

    // Insert data before migration
    db.prepare(`INSERT INTO tool_registry (name, type, description, url) VALUES ('arcade', 'mcp', 'Arcade', 'https://api.arcade.dev')`).run()
    db.prepare(`INSERT INTO tool_registry (name, type, description, command) VALUES ('gh', 'cli', 'GitHub CLI', 'gh')`).run()

    migration0030.up(db)

    // Verify old data survived
    const arcade = db.prepare('SELECT * FROM tool_registry WHERE name = ?').get('arcade') as Record<string, unknown>
    expect(arcade.type).to.equal('mcp')
    expect(arcade.description).to.equal('Arcade')
    expect(arcade.url).to.equal('https://api.arcade.dev')

    const gh = db.prepare('SELECT * FROM tool_registry WHERE name = ?').get('gh') as Record<string, unknown>
    expect(gh.type).to.equal('cli')
    expect(gh.command).to.equal('gh')

    db.close()
  })
})

// =============================================================================
// DB CRUD Tests
// =============================================================================

describe('API Tool DB Operations (PRLT-1361)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    applyMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('upsertApiTool', () => {
    it('should insert a new API tool', () => {
      upsertApiTool(db, 'posthog', {
        url: 'https://app.posthog.com/api',
        auth: 'POSTHOG_API_KEY',
        description: 'PostHog analytics API',
        docs: 'https://posthog.com/docs/api',
      })

      expect(toolExistsInDb(db, 'posthog')).to.be.true

      const row = getToolFromDb(db, 'posthog')
      expect(row).to.not.be.null
      expect(row!.type).to.equal('api')
      expect(row!.url).to.equal('https://app.posthog.com/api')
      expect(row!.auth).to.equal('POSTHOG_API_KEY')
      expect(row!.description).to.equal('PostHog analytics API')
      expect(row!.docs).to.equal('https://posthog.com/docs/api')
    })

    it('should insert API tool with custom auth_header', () => {
      upsertApiTool(db, 'custom-api', {
        url: 'https://api.custom.com',
        auth: 'CUSTOM_KEY',
        auth_header: 'X-API-Key',
        description: 'Custom API',
      })

      const row = getToolFromDb(db, 'custom-api')
      expect(row!.auth_header).to.equal('X-API-Key')
    })

    it('should insert API tool without optional fields', () => {
      upsertApiTool(db, 'simple-api', {
        url: 'https://api.simple.com',
        description: 'Simple API',
      })

      const row = getToolFromDb(db, 'simple-api')
      expect(row!.auth).to.be.null
      expect(row!.auth_header).to.be.null
      expect(row!.docs).to.be.null
    })

    it('should upsert (update) existing API tool', () => {
      upsertApiTool(db, 'posthog', {
        url: 'https://app.posthog.com/api',
        description: 'PostHog v1',
      })
      upsertApiTool(db, 'posthog', {
        url: 'https://app.posthog.com/api/v2',
        description: 'PostHog v2',
        auth: 'PH_KEY',
        docs: 'https://posthog.com/docs',
      })

      const row = getToolFromDb(db, 'posthog')
      expect(row!.url).to.equal('https://app.posthog.com/api/v2')
      expect(row!.description).to.equal('PostHog v2')
      expect(row!.auth).to.equal('PH_KEY')
    })
  })

  describe('removeToolFromDb', () => {
    it('should remove an API tool', () => {
      upsertApiTool(db, 'posthog', {
        url: 'https://app.posthog.com/api',
        description: 'PostHog',
      })
      expect(toolExistsInDb(db, 'posthog')).to.be.true

      const removed = removeToolFromDb(db, 'posthog')
      expect(removed).to.be.true
      expect(toolExistsInDb(db, 'posthog')).to.be.false
    })
  })

  describe('loadRegistryFromDb', () => {
    it('should load API tools into the api-tools section', () => {
      upsertApiTool(db, 'posthog', {
        url: 'https://app.posthog.com/api',
        auth: 'POSTHOG_API_KEY',
        auth_header: 'Authorization: Bearer',
        description: 'PostHog analytics API',
        docs: 'https://posthog.com/docs/api',
      })
      upsertMcpServer(db, 'arcade', { description: 'Arcade', url: 'https://api.arcade.dev' })
      upsertCliTool(db, 'gh', { command: 'gh', description: 'GitHub CLI' })

      const registry = loadRegistryFromDb(db)

      expect(Object.keys(registry['api-tools'])).to.have.lengthOf(1)
      expect(registry['api-tools']['posthog']).to.deep.equal({
        url: 'https://app.posthog.com/api',
        auth: 'POSTHOG_API_KEY',
        auth_header: 'Authorization: Bearer',
        description: 'PostHog analytics API',
        docs: 'https://posthog.com/docs/api',
      })
      expect(Object.keys(registry['mcp-servers'])).to.have.lengthOf(1)
      expect(Object.keys(registry['cli-tools'])).to.have.lengthOf(1)
    })

    it('should load API tool without optional fields', () => {
      upsertApiTool(db, 'minimal', {
        url: 'https://api.example.com',
        description: 'Minimal API',
      })

      const registry = loadRegistryFromDb(db)
      const api = registry['api-tools']['minimal']
      expect(api.url).to.equal('https://api.example.com')
      expect(api.description).to.equal('Minimal API')
      expect(api.auth).to.be.undefined
      expect(api.auth_header).to.be.undefined
      expect(api.docs).to.be.undefined
    })
  })

  describe('saveRegistryToDb', () => {
    it('should save API tools to database', () => {
      const registry = makeRegistry({
        'api-tools': {
          posthog: {
            url: 'https://app.posthog.com/api',
            auth: 'PH_KEY',
            description: 'PostHog',
            docs: 'https://posthog.com/docs',
          },
        },
      })

      saveRegistryToDb(db, registry)

      const row = getToolFromDb(db, 'posthog')
      expect(row).to.not.be.null
      expect(row!.type).to.equal('api')
      expect(row!.url).to.equal('https://app.posthog.com/api')
      expect(row!.auth).to.equal('PH_KEY')
      expect(row!.docs).to.equal('https://posthog.com/docs')
    })

    it('should save mixed tool types', () => {
      const registry = makeRegistry({
        'mcp-servers': { arcade: { description: 'Arcade', url: 'https://api.arcade.dev' } },
        'cli-tools': { gh: { command: 'gh', description: 'GitHub CLI' } },
        'api-tools': { posthog: { url: 'https://posthog.com/api', description: 'PostHog' } },
      })

      saveRegistryToDb(db, registry)

      expect(isRegistryEmpty(db)).to.be.false
      const loaded = loadRegistryFromDb(db)
      expect(Object.keys(loaded['mcp-servers'])).to.have.lengthOf(1)
      expect(Object.keys(loaded['cli-tools'])).to.have.lengthOf(1)
      expect(Object.keys(loaded['api-tools'])).to.have.lengthOf(1)
    })

    it('should remove stale API tools on save', () => {
      upsertApiTool(db, 'old-api', { url: 'https://old.com', description: 'Old' })

      // Save registry without old-api
      const registry = makeRegistry({
        'api-tools': { 'new-api': { url: 'https://new.com', description: 'New' } },
      })
      saveRegistryToDb(db, registry)

      expect(toolExistsInDb(db, 'old-api')).to.be.false
      expect(toolExistsInDb(db, 'new-api')).to.be.true
    })
  })
})

// =============================================================================
// Prompt Injection Tests
// =============================================================================

describe('API Tool Prompt Injection (PRLT-1361)', () => {
  it('should include API tools in prompt section', () => {
    const apiTools: ApiToolConfig[] = [
      {
        name: 'posthog',
        url: 'https://app.posthog.com/api',
        auth: 'POSTHOG_API_KEY',
        description: 'PostHog analytics API',
        docs: 'https://posthog.com/docs/api',
      },
    ]

    const section = buildToolsPromptSection([], [], apiTools)
    expect(section).to.include('REST APIs')
    expect(section).to.include('posthog API is available at https://app.posthog.com/api')
    expect(section).to.include('Auth: Authorization: Bearer $POSTHOG_API_KEY')
    expect(section).to.include('Docs: https://posthog.com/docs/api')
    expect(section).to.include('PostHog analytics API')
  })

  it('should use custom auth_header when provided', () => {
    const apiTools: ApiToolConfig[] = [
      {
        name: 'custom',
        url: 'https://api.custom.com',
        auth: 'CUSTOM_KEY',
        auth_header: 'X-API-Key',
        description: 'Custom API',
      },
    ]

    const section = buildToolsPromptSection([], [], apiTools)
    expect(section).to.include('Auth: X-API-Key $CUSTOM_KEY')
  })

  it('should omit auth line when no auth configured', () => {
    const apiTools: ApiToolConfig[] = [
      {
        name: 'public',
        url: 'https://api.public.com',
        description: 'Public API',
      },
    ]

    const section = buildToolsPromptSection([], [], apiTools)
    expect(section).to.include('public API is available at https://api.public.com')
    expect(section).to.not.include('Auth:')
  })

  it('should omit docs when not provided', () => {
    const apiTools: ApiToolConfig[] = [
      {
        name: 'nodocs',
        url: 'https://api.nodocs.com',
        auth: 'KEY',
        description: 'No docs API',
      },
    ]

    const section = buildToolsPromptSection([], [], apiTools)
    expect(section).to.not.include('Docs:')
  })

  it('should include all tool types in combined prompt', () => {
    const mcpServers = [{ name: 'arcade', description: 'Arcade', url: 'https://arcade.dev' }]
    const cliTools = [{ name: 'gh', command: 'gh', description: 'GitHub CLI' }]
    const apiTools: ApiToolConfig[] = [
      { name: 'posthog', url: 'https://posthog.com/api', description: 'PostHog' },
    ]

    const section = buildToolsPromptSection(mcpServers, cliTools, apiTools)
    expect(section).to.include('MCP Servers')
    expect(section).to.include('CLI Tools')
    expect(section).to.include('REST APIs')
  })

  it('should return empty string when no tools at all', () => {
    const section = buildToolsPromptSection([], [], [])
    expect(section).to.equal('')
  })

  it('should render multiple API tools', () => {
    const apiTools: ApiToolConfig[] = [
      { name: 'posthog', url: 'https://posthog.com/api', auth: 'PH_KEY', description: 'PostHog' },
      { name: 'stripe', url: 'https://api.stripe.com', auth: 'STRIPE_KEY', description: 'Stripe payments' },
    ]

    const section = buildToolsPromptSection([], [], apiTools)
    expect(section).to.include('posthog API is available at https://posthog.com/api')
    expect(section).to.include('stripe API is available at https://api.stripe.com')
  })
})

// =============================================================================
// Policy Filtering Tests
// =============================================================================

describe('API Tool Policy Filtering (PRLT-1361)', () => {
  it('should include all API tools when no policy', () => {
    const registry = makeRegistry({
      'api-tools': {
        posthog: { url: 'https://posthog.com/api', description: 'PostHog' },
        stripe: { url: 'https://api.stripe.com', description: 'Stripe' },
      },
    })

    const result = filterByPolicy(registry, null)
    expect(result.apiTools).to.have.lengthOf(2)
    expect(result.apiTools.map(a => a.name)).to.include.members(['posthog', 'stripe'])
  })

  it('should filter API tools by policy', () => {
    const registry = makeRegistry({
      'api-tools': {
        posthog: { url: 'https://posthog.com/api', description: 'PostHog' },
        stripe: { url: 'https://api.stripe.com', description: 'Stripe' },
        slack: { url: 'https://slack.com/api', description: 'Slack' },
      },
    })

    const policy: ToolPolicy = {
      mcp: [],
      cli: [],
      api: ['posthog', 'stripe'],
    }

    const result = filterByPolicy(registry, policy)
    expect(result.apiTools).to.have.lengthOf(2)
    expect(result.apiTools.map(a => a.name)).to.include.members(['posthog', 'stripe'])
    expect(result.apiTools.map(a => a.name)).to.not.include('slack')
  })

  it('should return empty API tools when policy has no api field', () => {
    const registry = makeRegistry({
      'api-tools': {
        posthog: { url: 'https://posthog.com/api', description: 'PostHog' },
      },
    })

    const policy: ToolPolicy = {
      mcp: [],
      cli: [],
      api: [],
    }

    const result = filterByPolicy(registry, policy)
    expect(result.apiTools).to.have.lengthOf(0)
  })

  it('should filter all tool types correctly in one call', () => {
    const registry = makeRegistry({
      'mcp-servers': { arcade: { description: 'Arcade', url: 'https://arcade.dev' } },
      'cli-tools': { gh: { command: 'gh', description: 'GitHub' } },
      'api-tools': {
        posthog: { url: 'https://posthog.com/api', description: 'PostHog' },
        stripe: { url: 'https://api.stripe.com', description: 'Stripe' },
      },
    })

    const policy: ToolPolicy = {
      mcp: ['arcade'],
      cli: ['gh'],
      api: ['posthog'],
    }

    const result = filterByPolicy(registry, policy)
    expect(result.mcpServers).to.have.lengthOf(1)
    // prlt is always included + gh
    expect(result.cliTools.map(t => t.name)).to.include('gh')
    expect(result.apiTools).to.have.lengthOf(1)
    expect(result.apiTools[0].name).to.equal('posthog')
  })
})
