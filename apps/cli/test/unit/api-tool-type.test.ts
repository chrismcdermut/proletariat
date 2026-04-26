import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import yaml from 'js-yaml'
import type { ToolRegistry, ApiToolConfig, ToolPolicy } from '../../src/lib/tool-registry/types.js'

/**
 * Unit tests for API tool type (PRLT-1361)
 *
 * Tests the full lifecycle of API tools: type definitions, registry CRUD,
 * health checking, prompt injection, and policy filtering.
 */

function createTempHQ(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-api-test-'))
  fs.mkdirSync(path.join(tmpDir, '.proletariat'), { recursive: true })
  return tmpDir
}

function cleanupTempHQ(tmpDir: string): void {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

function writeToolsYaml(hqPath: string, registry: Partial<ToolRegistry>): void {
  const configPath = path.join(hqPath, '.proletariat', 'tools.yaml')
  const content = yaml.dump(registry, { indent: 2, lineWidth: 120, noRefs: true })
  fs.writeFileSync(configPath, content, 'utf-8')
}

describe('API Tool Type (PRLT-1361)', () => {
  // =========================================================================
  // Type definitions
  // =========================================================================
  describe('Type definitions', () => {
    it('ApiToolConfig interface has required fields', async () => {
      const config: ApiToolConfig = {
        name: 'test-api',
        url: 'https://api.example.com',
        description: 'Test API',
      }
      expect(config.name).to.equal('test-api')
      expect(config.url).to.equal('https://api.example.com')
      expect(config.description).to.equal('Test API')
    })

    it('ApiToolConfig supports optional auth, auth_header, and docs fields', async () => {
      const config: ApiToolConfig = {
        name: 'posthog',
        url: 'https://app.posthog.com/api',
        auth: 'POSTHOG_API_KEY',
        auth_header: 'Authorization: Bearer',
        description: 'PostHog analytics API',
        docs: 'https://posthog.com/docs/api',
      }
      expect(config.auth).to.equal('POSTHOG_API_KEY')
      expect(config.auth_header).to.equal('Authorization: Bearer')
      expect(config.docs).to.equal('https://posthog.com/docs/api')
    })

    it('ToolRegistry includes api-tools section', async () => {
      const registry: ToolRegistry = {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {},
      }
      expect(registry).to.have.property('api-tools')
    })
  })

  // =========================================================================
  // Registry operations
  // =========================================================================
  describe('Registry operations', () => {
    let hqPath: string

    beforeEach(() => {
      hqPath = createTempHQ()
    })

    afterEach(() => {
      cleanupTempHQ(hqPath)
    })

    it('loadToolRegistry returns empty api-tools when no tools.yaml exists', async () => {
      const { loadToolRegistry } = await import('../../src/lib/tool-registry/registry.js')
      const registry = loadToolRegistry(hqPath)
      expect(registry['api-tools']).to.deep.equal({})
    })

    it('loadToolRegistry loads api-tools from tools.yaml', async () => {
      writeToolsYaml(hqPath, {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {
          posthog: {
            url: 'https://app.posthog.com/api',
            auth: 'POSTHOG_API_KEY',
            description: 'PostHog analytics API',
            docs: 'https://posthog.com/docs/api',
          },
        },
      })

      const { loadToolRegistry } = await import('../../src/lib/tool-registry/registry.js')
      const registry = loadToolRegistry(hqPath)
      expect(registry['api-tools']).to.have.property('posthog')
      expect(registry['api-tools']['posthog'].url).to.equal('https://app.posthog.com/api')
      expect(registry['api-tools']['posthog'].auth).to.equal('POSTHOG_API_KEY')
      expect(registry['api-tools']['posthog'].docs).to.equal('https://posthog.com/docs/api')
    })

    it('loadToolRegistry defaults api-tools to empty when tools.yaml has no api-tools key', async () => {
      writeToolsYaml(hqPath, {
        'mcp-servers': {},
        'cli-tools': {},
      })

      const { loadToolRegistry } = await import('../../src/lib/tool-registry/registry.js')
      const registry = loadToolRegistry(hqPath)
      expect(registry['api-tools']).to.deep.equal({})
    })

    it('getApiTools hydrates configs with names', async () => {
      writeToolsYaml(hqPath, {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {
          posthog: {
            url: 'https://app.posthog.com/api',
            description: 'PostHog analytics API',
          },
          stripe: {
            url: 'https://api.stripe.com/v1',
            auth: 'STRIPE_SECRET_KEY',
            description: 'Stripe payment API',
          },
        },
      })

      const { loadToolRegistry, getApiTools } = await import('../../src/lib/tool-registry/registry.js')
      const registry = loadToolRegistry(hqPath)
      const tools = getApiTools(registry)
      expect(tools).to.have.length(2)
      expect(tools[0].name).to.equal('posthog')
      expect(tools[1].name).to.equal('stripe')
    })

    it('addApiTool adds an API tool to the registry', async () => {
      const { addApiTool, loadToolRegistry } = await import('../../src/lib/tool-registry/registry.js')

      addApiTool(hqPath, 'posthog', {
        url: 'https://app.posthog.com/api',
        auth: 'POSTHOG_API_KEY',
        description: 'PostHog analytics API',
        docs: 'https://posthog.com/docs/api',
      })

      const registry = loadToolRegistry(hqPath)
      expect(registry['api-tools']).to.have.property('posthog')
      expect(registry['api-tools']['posthog'].url).to.equal('https://app.posthog.com/api')
      expect(registry['api-tools']['posthog'].auth).to.equal('POSTHOG_API_KEY')
    })

    it('addApiTool preserves existing tools', async () => {
      writeToolsYaml(hqPath, {
        'mcp-servers': { arcade: { url: 'https://arcade.dev/mcp', description: 'Arcade' } },
        'cli-tools': { gh: { command: 'gh', description: 'GitHub CLI' } },
        'api-tools': {},
      })

      const { addApiTool, loadToolRegistry } = await import('../../src/lib/tool-registry/registry.js')

      addApiTool(hqPath, 'posthog', {
        url: 'https://app.posthog.com/api',
        description: 'PostHog analytics API',
      })

      const registry = loadToolRegistry(hqPath)
      expect(registry['mcp-servers']).to.have.property('arcade')
      expect(registry['cli-tools']).to.have.property('gh')
      expect(registry['api-tools']).to.have.property('posthog')
    })

    it('removeTool removes an API tool', async () => {
      writeToolsYaml(hqPath, {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {
          posthog: {
            url: 'https://app.posthog.com/api',
            description: 'PostHog analytics API',
          },
        },
      })

      const { removeTool, loadToolRegistry } = await import('../../src/lib/tool-registry/registry.js')
      const removed = removeTool(hqPath, 'posthog')
      expect(removed).to.be.true

      const registry = loadToolRegistry(hqPath)
      expect(registry['api-tools']).to.not.have.property('posthog')
    })

    it('removeTool returns false for nonexistent API tool', async () => {
      writeToolsYaml(hqPath, {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {},
      })

      const { removeTool } = await import('../../src/lib/tool-registry/registry.js')
      const removed = removeTool(hqPath, 'nonexistent')
      expect(removed).to.be.false
    })

    it('addApiTool stores auth_header field', async () => {
      const { addApiTool, loadToolRegistry } = await import('../../src/lib/tool-registry/registry.js')

      addApiTool(hqPath, 'custom-api', {
        url: 'https://api.example.com',
        auth: 'API_TOKEN',
        auth_header: 'X-Api-Key',
        description: 'Custom API',
      })

      const registry = loadToolRegistry(hqPath)
      expect(registry['api-tools']['custom-api'].auth_header).to.equal('X-Api-Key')
    })
  })

  // =========================================================================
  // Health checking
  // =========================================================================
  describe('Health checking', () => {
    let hqPath: string

    beforeEach(() => {
      hqPath = createTempHQ()
    })

    afterEach(() => {
      cleanupTempHQ(hqPath)
    })

    it('checkAllTools includes API tools in results', async () => {
      writeToolsYaml(hqPath, {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {
          posthog: {
            url: 'https://app.posthog.com/api',
            auth: 'POSTHOG_API_KEY',
            description: 'PostHog analytics API',
          },
        },
      })

      const { loadToolRegistry } = await import('../../src/lib/tool-registry/registry.js')
      const { checkAllTools } = await import('../../src/lib/tool-registry/detect.js')
      const registry = loadToolRegistry(hqPath)
      const results = await checkAllTools(registry)

      const apiResults = results.filter(r => r.type === 'api')
      expect(apiResults).to.have.length(1)
      expect(apiResults[0].name).to.equal('posthog')
    })

    it('API tool check fails when auth env var is missing', async () => {
      // Make sure the env var is not set
      const saved = process.env.TEST_MISSING_API_KEY
      delete process.env.TEST_MISSING_API_KEY

      writeToolsYaml(hqPath, {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {
          testapi: {
            url: 'https://api.example.com',
            auth: 'TEST_MISSING_API_KEY',
            description: 'Test API',
          },
        },
      })

      const { loadToolRegistry } = await import('../../src/lib/tool-registry/registry.js')
      const { checkAllTools } = await import('../../src/lib/tool-registry/detect.js')
      const registry = loadToolRegistry(hqPath)
      const results = await checkAllTools(registry)

      const apiResult = results.find(r => r.name === 'testapi')
      expect(apiResult).to.exist
      expect(apiResult!.available).to.be.false
      expect(apiResult!.error).to.include('TEST_MISSING_API_KEY')

      // Restore
      if (saved !== undefined) process.env.TEST_MISSING_API_KEY = saved
    })

    it('ToolCheckResult type field supports api value', async () => {
      const result = {
        name: 'posthog',
        type: 'api' as const,
        available: true,
      }
      expect(result.type).to.equal('api')
    })
  })

  // =========================================================================
  // Prompt injection
  // =========================================================================
  describe('Prompt injection', () => {
    it('buildToolsPromptSection includes REST APIs section', async () => {
      const { buildToolsPromptSection } = await import('../../src/lib/tool-registry/spawn.js')

      const section = buildToolsPromptSection([], [], [
        {
          name: 'posthog',
          url: 'https://app.posthog.com/api',
          auth: 'POSTHOG_API_KEY',
          description: 'PostHog analytics API',
          docs: 'https://posthog.com/docs/api',
        },
      ])

      expect(section).to.include('**REST APIs:**')
      expect(section).to.include('posthog')
      expect(section).to.include('https://app.posthog.com/api')
      expect(section).to.include('$POSTHOG_API_KEY')
      expect(section).to.include('https://posthog.com/docs/api')
    })

    it('prompt includes default auth header when none specified', async () => {
      const { buildToolsPromptSection } = await import('../../src/lib/tool-registry/spawn.js')

      const section = buildToolsPromptSection([], [], [
        {
          name: 'myapi',
          url: 'https://api.example.com',
          auth: 'MY_API_KEY',
          description: 'My API',
        },
      ])

      expect(section).to.include('Authorization: Bearer')
    })

    it('prompt uses custom auth_header when specified', async () => {
      const { buildToolsPromptSection } = await import('../../src/lib/tool-registry/spawn.js')

      const section = buildToolsPromptSection([], [], [
        {
          name: 'myapi',
          url: 'https://api.example.com',
          auth: 'MY_API_KEY',
          auth_header: 'X-Api-Key',
          description: 'My API',
        },
      ])

      expect(section).to.include('X-Api-Key')
      expect(section).to.not.include('Authorization: Bearer')
    })

    it('prompt omits auth info when no auth configured', async () => {
      const { buildToolsPromptSection } = await import('../../src/lib/tool-registry/spawn.js')

      const section = buildToolsPromptSection([], [], [
        {
          name: 'publicapi',
          url: 'https://api.example.com',
          description: 'Public API',
        },
      ])

      expect(section).to.include('publicapi')
      expect(section).to.include('https://api.example.com')
      expect(section).to.not.include('Auth:')
    })

    it('prompt omits docs when not provided', async () => {
      const { buildToolsPromptSection } = await import('../../src/lib/tool-registry/spawn.js')

      const section = buildToolsPromptSection([], [], [
        {
          name: 'myapi',
          url: 'https://api.example.com',
          description: 'My API',
        },
      ])

      expect(section).to.not.include('Docs:')
    })

    it('returns empty string when no tools of any type', async () => {
      const { buildToolsPromptSection } = await import('../../src/lib/tool-registry/spawn.js')
      const section = buildToolsPromptSection([], [], [])
      expect(section).to.equal('')
    })

    it('combines MCP, CLI, and API tools in one section', async () => {
      const { buildToolsPromptSection } = await import('../../src/lib/tool-registry/spawn.js')

      const section = buildToolsPromptSection(
        [{ name: 'arcade', url: 'https://arcade.dev/mcp', description: 'Arcade' }],
        [{ name: 'gh', command: 'gh', description: 'GitHub CLI' }],
        [{ name: 'posthog', url: 'https://app.posthog.com/api', description: 'PostHog API' }]
      )

      expect(section).to.include('**MCP Servers:**')
      expect(section).to.include('**CLI Tools:**')
      expect(section).to.include('**REST APIs:**')
    })
  })

  // =========================================================================
  // Policy filtering
  // =========================================================================
  describe('Policy filtering', () => {
    it('no policy returns all API tools', async () => {
      const { filterByPolicy } = await import('../../src/lib/tool-registry/policy.js')

      const registry: ToolRegistry = {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {
          posthog: { url: 'https://app.posthog.com/api', description: 'PostHog' },
          stripe: { url: 'https://api.stripe.com/v1', description: 'Stripe' },
        },
      }

      const result = filterByPolicy(registry, null)
      expect(result.apiTools).to.have.length(2)
    })

    it('policy filters API tools to allowed set', async () => {
      const { filterByPolicy } = await import('../../src/lib/tool-registry/policy.js')

      const registry: ToolRegistry = {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {
          posthog: { url: 'https://app.posthog.com/api', description: 'PostHog' },
          stripe: { url: 'https://api.stripe.com/v1', description: 'Stripe' },
          openai: { url: 'https://api.openai.com/v1', description: 'OpenAI' },
        },
      }

      const policy: ToolPolicy = {
        mcp: [],
        cli: [],
        api: ['posthog', 'openai'],
      }

      const result = filterByPolicy(registry, policy)
      expect(result.apiTools).to.have.length(2)
      expect(result.apiTools.map(t => t.name)).to.include('posthog')
      expect(result.apiTools.map(t => t.name)).to.include('openai')
      expect(result.apiTools.map(t => t.name)).to.not.include('stripe')
    })

    it('policy with empty api list returns no API tools', async () => {
      const { filterByPolicy } = await import('../../src/lib/tool-registry/policy.js')

      const registry: ToolRegistry = {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {
          posthog: { url: 'https://app.posthog.com/api', description: 'PostHog' },
        },
      }

      const policy: ToolPolicy = {
        mcp: [],
        cli: [],
        api: [],
      }

      const result = filterByPolicy(registry, policy)
      expect(result.apiTools).to.have.length(0)
    })

    it('policy without api field returns no API tools', async () => {
      const { filterByPolicy } = await import('../../src/lib/tool-registry/policy.js')

      const registry: ToolRegistry = {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {
          posthog: { url: 'https://app.posthog.com/api', description: 'PostHog' },
        },
      }

      // Simulate a policy YAML that doesn't have the api field
      const policy = {
        mcp: [],
        cli: [],
      } as unknown as ToolPolicy

      const result = filterByPolicy(registry, policy)
      expect(result.apiTools).to.have.length(0)
    })
  })

  // =========================================================================
  // SpawnToolsResult
  // =========================================================================
  describe('SpawnToolsResult', () => {
    let hqPath: string

    beforeEach(() => {
      hqPath = createTempHQ()
    })

    afterEach(() => {
      cleanupTempHQ(hqPath)
    })

    it('resolveToolsForSpawn includes apiTools in result', async () => {
      writeToolsYaml(hqPath, {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {
          posthog: {
            url: 'https://app.posthog.com/api',
            auth: 'POSTHOG_API_KEY',
            description: 'PostHog analytics API',
            docs: 'https://posthog.com/docs/api',
          },
        },
      })

      const { resolveToolsForSpawn } = await import('../../src/lib/tool-registry/spawn.js')
      const result = resolveToolsForSpawn(hqPath, undefined, path.join(hqPath, '.proletariat', 'scripts'))

      expect(result.apiTools).to.have.length(1)
      expect(result.apiTools[0].name).to.equal('posthog')
      expect(result.promptSection).to.include('posthog')
      expect(result.promptSection).to.include('https://app.posthog.com/api')
    })

    it('resolveToolsForSpawn returns empty apiTools when none registered', async () => {
      writeToolsYaml(hqPath, {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {},
      })

      const { resolveToolsForSpawn } = await import('../../src/lib/tool-registry/spawn.js')
      const result = resolveToolsForSpawn(hqPath, undefined, path.join(hqPath, '.proletariat', 'scripts'))

      expect(result.apiTools).to.have.length(0)
    })
  })

  // =========================================================================
  // Auth storage (env var reference, not secret)
  // =========================================================================
  describe('Auth storage', () => {
    let hqPath: string

    beforeEach(() => {
      hqPath = createTempHQ()
    })

    afterEach(() => {
      cleanupTempHQ(hqPath)
    })

    it('stores auth as env var name, not the actual secret', async () => {
      const { addApiTool, loadToolRegistry } = await import('../../src/lib/tool-registry/registry.js')

      addApiTool(hqPath, 'posthog', {
        url: 'https://app.posthog.com/api',
        auth: 'POSTHOG_API_KEY',
        description: 'PostHog analytics API',
      })

      const registry = loadToolRegistry(hqPath)
      // Auth should be the env var name, not wrapped in ${} like MCP servers do
      expect(registry['api-tools']['posthog'].auth).to.equal('POSTHOG_API_KEY')
      // Should not contain actual secret values
      const configPath = path.join(hqPath, '.proletariat', 'tools.yaml')
      const content = fs.readFileSync(configPath, 'utf-8')
      expect(content).to.include('POSTHOG_API_KEY')
      // The YAML should not contain the resolved value
      expect(content).to.not.include('${')
    })
  })
})
