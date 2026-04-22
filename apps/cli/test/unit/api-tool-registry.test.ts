import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  loadToolRegistry,
  saveToolRegistry,
  getApiTools,
  addApiTool,
  removeTool,
  checkAllTools,
  buildToolsPromptSection,
  filterByPolicy,
} from '../../src/lib/tool-registry/index.js'
import type {
  ToolRegistry,
  ApiToolConfig,
  ToolPolicy,
} from '../../src/lib/tool-registry/index.js'

describe('API Tool Registry', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-tool-test-'))
    fs.mkdirSync(path.join(tmpDir, '.proletariat'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ===========================================================================
  // types.ts — ApiToolConfig in ToolRegistry
  // ===========================================================================

  describe('ToolRegistry with api-tools', () => {
    it('loadToolRegistry returns empty api-tools when no file exists', () => {
      const registry = loadToolRegistry(tmpDir)
      expect(registry['api-tools']).to.deep.equal({})
    })

    it('loadToolRegistry returns empty api-tools when file has no api-tools section', () => {
      const configPath = path.join(tmpDir, '.proletariat', 'tools.yaml')
      fs.writeFileSync(configPath, 'mcp-servers: {}\ncli-tools: {}\n', 'utf-8')
      const registry = loadToolRegistry(tmpDir)
      expect(registry['api-tools']).to.deep.equal({})
    })

    it('loadToolRegistry reads api-tools from YAML', () => {
      const configPath = path.join(tmpDir, '.proletariat', 'tools.yaml')
      fs.writeFileSync(configPath, [
        'api-tools:',
        '  posthog:',
        '    url: https://app.posthog.com/api',
        '    auth: POSTHOG_API_KEY',
        '    description: PostHog analytics API',
        '    docs: https://posthog.com/docs/api',
        'cli-tools: {}',
        'mcp-servers: {}',
      ].join('\n'), 'utf-8')
      const registry = loadToolRegistry(tmpDir)
      expect(registry['api-tools']).to.have.property('posthog')
      expect(registry['api-tools']['posthog'].url).to.equal('https://app.posthog.com/api')
      expect(registry['api-tools']['posthog'].auth).to.equal('POSTHOG_API_KEY')
      expect(registry['api-tools']['posthog'].docs).to.equal('https://posthog.com/docs/api')
    })

    it('saveToolRegistry persists api-tools to YAML', () => {
      const registry: ToolRegistry = {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {
          stripe: {
            url: 'https://api.stripe.com',
            auth: 'STRIPE_SECRET_KEY',
            description: 'Stripe payments API',
          },
        },
      }
      saveToolRegistry(tmpDir, registry)
      const reloaded = loadToolRegistry(tmpDir)
      expect(reloaded['api-tools']['stripe'].url).to.equal('https://api.stripe.com')
      expect(reloaded['api-tools']['stripe'].auth).to.equal('STRIPE_SECRET_KEY')
    })
  })

  // ===========================================================================
  // registry.ts — getApiTools, addApiTool, removeTool
  // ===========================================================================

  describe('getApiTools', () => {
    it('returns empty array when no api tools registered', () => {
      const registry = loadToolRegistry(tmpDir)
      expect(getApiTools(registry)).to.deep.equal([])
    })

    it('hydrates name field into each api tool config', () => {
      const registry: ToolRegistry = {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {
          posthog: {
            url: 'https://app.posthog.com/api',
            auth: 'POSTHOG_API_KEY',
            description: 'PostHog analytics API',
          },
        },
      }
      const tools = getApiTools(registry)
      expect(tools).to.have.length(1)
      expect(tools[0].name).to.equal('posthog')
      expect(tools[0].url).to.equal('https://app.posthog.com/api')
    })
  })

  describe('addApiTool', () => {
    it('adds an api tool to the registry', () => {
      addApiTool(tmpDir, 'posthog', {
        url: 'https://app.posthog.com/api',
        auth: 'POSTHOG_API_KEY',
        description: 'PostHog analytics API',
        docs: 'https://posthog.com/docs/api',
      })
      const registry = loadToolRegistry(tmpDir)
      expect(registry['api-tools']).to.have.property('posthog')
      expect(registry['api-tools']['posthog'].url).to.equal('https://app.posthog.com/api')
      expect(registry['api-tools']['posthog'].auth).to.equal('POSTHOG_API_KEY')
      expect(registry['api-tools']['posthog'].docs).to.equal('https://posthog.com/docs/api')
    })

    it('stores auth_header when provided', () => {
      addApiTool(tmpDir, 'custom', {
        url: 'https://api.custom.io',
        auth: 'CUSTOM_KEY',
        auth_header: 'X-API-Key',
        description: 'Custom API',
      })
      const registry = loadToolRegistry(tmpDir)
      expect(registry['api-tools']['custom'].auth_header).to.equal('X-API-Key')
    })

    it('does not store docs when not provided', () => {
      addApiTool(tmpDir, 'simple', {
        url: 'https://api.simple.io',
        auth: 'SIMPLE_KEY',
        description: 'Simple API',
      })
      const registry = loadToolRegistry(tmpDir)
      expect(registry['api-tools']['simple'].docs).to.be.undefined
    })

    it('stores auth as plain env var name, not as a secret', () => {
      addApiTool(tmpDir, 'test-api', {
        url: 'https://api.test.io',
        auth: 'TEST_API_KEY',
        description: 'Test API',
      })
      const registry = loadToolRegistry(tmpDir)
      // auth should be the env var NAME, not the value
      expect(registry['api-tools']['test-api'].auth).to.equal('TEST_API_KEY')
      // Should not contain any actual secret values
      const content = fs.readFileSync(
        path.join(tmpDir, '.proletariat', 'tools.yaml'), 'utf-8'
      )
      expect(content).to.include('TEST_API_KEY')
      expect(content).not.to.include('sk-') // no actual secrets
    })
  })

  describe('removeTool (api)', () => {
    it('removes an api tool from the registry', () => {
      addApiTool(tmpDir, 'posthog', {
        url: 'https://app.posthog.com/api',
        auth: 'POSTHOG_API_KEY',
        description: 'PostHog analytics API',
      })
      const removed = removeTool(tmpDir, 'posthog')
      expect(removed).to.be.true
      const registry = loadToolRegistry(tmpDir)
      expect(registry['api-tools']).to.not.have.property('posthog')
    })

    it('returns false for non-existent api tool', () => {
      const removed = removeTool(tmpDir, 'nonexistent')
      expect(removed).to.be.false
    })
  })

  // ===========================================================================
  // detect.ts — checkAllTools with API tools
  // ===========================================================================

  describe('checkAllTools with API tools', () => {
    it('reports missing env var as unavailable', () => {
      // Save with env var that definitely does not exist
      const envVar = `_PRLT_TEST_NONEXISTENT_${Date.now()}`
      delete process.env[envVar]

      const registry: ToolRegistry = {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {
          testapi: {
            url: 'https://api.example.com',
            auth: envVar,
            description: 'Test API',
          },
        },
      }

      const results = checkAllTools(registry)
      const apiResult = results.find(r => r.name === 'testapi')
      expect(apiResult).to.exist
      expect(apiResult!.type).to.equal('api')
      expect(apiResult!.available).to.be.false
      expect(apiResult!.error).to.include('Missing environment variable')
    })

    it('includes api type in check results', () => {
      // Set a temporary env var so auth check passes
      const envVar = `_PRLT_TEST_API_CHECK_${Date.now()}`
      process.env[envVar] = 'test-value'

      const registry: ToolRegistry = {
        'mcp-servers': {},
        'cli-tools': {},
        'api-tools': {
          testapi: {
            url: 'https://api.example.com',
            auth: envVar,
            description: 'Test API',
          },
        },
      }

      const results = checkAllTools(registry)
      const apiResult = results.find(r => r.name === 'testapi')
      expect(apiResult).to.exist
      expect(apiResult!.type).to.equal('api')

      // Clean up
      delete process.env[envVar]
    })
  })

  // ===========================================================================
  // spawn.ts — buildToolsPromptSection with API tools
  // ===========================================================================

  describe('buildToolsPromptSection with API tools', () => {
    it('includes API tools in prompt section', () => {
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
      expect(section).to.include('posthog')
      expect(section).to.include('https://app.posthog.com/api')
      expect(section).to.include('$POSTHOG_API_KEY')
      expect(section).to.include('https://posthog.com/docs/api')
    })

    it('uses default auth header when not specified', () => {
      const apiTools: ApiToolConfig[] = [
        {
          name: 'stripe',
          url: 'https://api.stripe.com',
          auth: 'STRIPE_KEY',
          description: 'Stripe API',
        },
      ]
      const section = buildToolsPromptSection([], [], apiTools)
      expect(section).to.include('Authorization: Bearer')
    })

    it('uses custom auth header when specified', () => {
      const apiTools: ApiToolConfig[] = [
        {
          name: 'custom',
          url: 'https://api.custom.io',
          auth: 'CUSTOM_KEY',
          auth_header: 'X-API-Key',
          description: 'Custom API',
        },
      ]
      const section = buildToolsPromptSection([], [], apiTools)
      expect(section).to.include('X-API-Key')
      expect(section).not.to.include('Authorization: Bearer')
    })

    it('omits docs when not provided', () => {
      const apiTools: ApiToolConfig[] = [
        {
          name: 'simple',
          url: 'https://api.simple.io',
          auth: 'SIMPLE_KEY',
          description: 'Simple API',
        },
      ]
      const section = buildToolsPromptSection([], [], apiTools)
      expect(section).not.to.include('Docs:')
    })

    it('includes docs when provided', () => {
      const apiTools: ApiToolConfig[] = [
        {
          name: 'documented',
          url: 'https://api.documented.io',
          auth: 'DOC_KEY',
          description: 'Documented API',
          docs: 'https://docs.documented.io',
        },
      ]
      const section = buildToolsPromptSection([], [], apiTools)
      expect(section).to.include('Docs: https://docs.documented.io')
    })

    it('returns empty string when no tools of any type', () => {
      const section = buildToolsPromptSection([], [], [])
      expect(section).to.equal('')
    })

    it('includes all tool types in combined prompt', () => {
      const section = buildToolsPromptSection(
        [{ name: 'arcade', description: 'Arcade integrations', url: 'https://arcade.dev' }],
        [{ name: 'gh', command: 'gh', description: 'GitHub CLI' }],
        [{ name: 'posthog', url: 'https://posthog.com/api', auth: 'PH_KEY', description: 'PostHog' }]
      )
      expect(section).to.include('MCP Servers')
      expect(section).to.include('CLI Tools')
      expect(section).to.include('REST APIs')
    })
  })

  // ===========================================================================
  // policy.ts — filterByPolicy with API tools
  // ===========================================================================

  describe('filterByPolicy with API tools', () => {
    const registryWithApis: ToolRegistry = {
      'mcp-servers': {},
      'cli-tools': {},
      'api-tools': {
        posthog: {
          url: 'https://app.posthog.com/api',
          auth: 'POSTHOG_API_KEY',
          description: 'PostHog analytics API',
        },
        stripe: {
          url: 'https://api.stripe.com',
          auth: 'STRIPE_KEY',
          description: 'Stripe payments API',
        },
      },
    }

    it('returns all api tools when no policy is provided', () => {
      const result = filterByPolicy(registryWithApis, null)
      expect(result.apiTools).to.have.length(2)
      const names = result.apiTools.map(t => t.name)
      expect(names).to.include('posthog')
      expect(names).to.include('stripe')
    })

    it('filters api tools by policy', () => {
      const policy: ToolPolicy = {
        mcp: [],
        cli: [],
        api: ['posthog'],
      }
      const result = filterByPolicy(registryWithApis, policy)
      expect(result.apiTools).to.have.length(1)
      expect(result.apiTools[0].name).to.equal('posthog')
    })

    it('returns empty api tools when policy has no api field', () => {
      const policy: ToolPolicy = {
        mcp: [],
        cli: [],
        api: [],
      }
      const result = filterByPolicy(registryWithApis, policy)
      expect(result.apiTools).to.have.length(0)
    })

    it('still includes prlt in cli tools when filtering with policy', () => {
      const policy: ToolPolicy = {
        mcp: [],
        cli: [],
        api: ['posthog'],
      }
      const result = filterByPolicy(registryWithApis, policy)
      expect(result.cliTools.some(t => t.name === 'prlt')).to.be.true
    })
  })
})
