/**
 * Tool Policy — Per-agent access control for tools
 *
 * Policy profiles are defined in YAML files under .proletariat/policies/.
 * Each profile specifies which MCP servers and CLI tools an agent can access.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import yaml from 'js-yaml'
import type {
  ToolRegistry,
  ToolPolicy,
  McpServerConfig,
  CliToolConfig,
  ApiToolConfig,
} from './types.js'
import { BUILTIN_PRLT_TOOL } from './types.js'

const POLICIES_DIR = 'policies'

/**
 * Get path to the policies directory.
 */
export function getPoliciesDir(hqPath: string): string {
  return path.join(hqPath, '.proletariat', POLICIES_DIR)
}

/**
 * Load a tool policy by name.
 * Looks in .proletariat/policies/{name}.yaml
 */
export function loadToolPolicy(hqPath: string, policyName: string): ToolPolicy | null {
  const policyPath = path.join(getPoliciesDir(hqPath), `${policyName}.yaml`)

  if (!fs.existsSync(policyPath)) {
    return null
  }

  try {
    const content = fs.readFileSync(policyPath, 'utf-8')
    const parsed = yaml.load(content) as { tools?: ToolPolicy } | null
    return parsed?.tools ?? null
  } catch {
    return null
  }
}

/**
 * Save a tool policy.
 */
export function saveToolPolicy(hqPath: string, policyName: string, policy: ToolPolicy): void {
  const policiesDir = getPoliciesDir(hqPath)
  fs.mkdirSync(policiesDir, { recursive: true })

  const policyPath = path.join(policiesDir, `${policyName}.yaml`)
  const content = yaml.dump({ tools: policy }, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  })
  fs.writeFileSync(policyPath, content, 'utf-8')
}

/**
 * List all available policy profiles.
 */
export function listPolicies(hqPath: string): string[] {
  const policiesDir = getPoliciesDir(hqPath)
  if (!fs.existsSync(policiesDir)) return []

  return fs.readdirSync(policiesDir)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => f.replace(/\.(yaml|yml)$/, ''))
}

/**
 * Filter registry by policy — returns only the tools the agent is allowed to use.
 * If no policy is provided, returns all registered tools.
 */
export function filterByPolicy(
  registry: ToolRegistry,
  policy: ToolPolicy | null
): { mcpServers: McpServerConfig[]; cliTools: CliToolConfig[]; apiTools: ApiToolConfig[] } {
  const allMcp = Object.entries(registry['mcp-servers'])
  const allCli = Object.entries(registry['cli-tools'])
  const allApi = Object.entries(registry['api-tools'])

  // No policy = full access
  if (!policy) {
    return {
      mcpServers: allMcp.map(([name, config]) => ({ name, ...config })),
      cliTools: [
        ...allCli.map(([name, config]) => ({ name, ...config })),
        // Always include prlt
        ...(allCli.some(([name]) => name === 'prlt') ? [] : [BUILTIN_PRLT_TOOL]),
      ],
      apiTools: allApi.map(([name, config]) => ({ name, ...config })),
    }
  }

  // Filter MCP servers
  const allowedMcp = new Set(policy.mcp || [])
  const mcpServers = allMcp
    .filter(([name]) => allowedMcp.has(name))
    .map(([name, config]) => ({ name, ...config }))

  // Filter CLI tools
  const allowedCli = new Set(policy.cli || [])
  // Always allow prlt
  allowedCli.add('prlt')

  const cliTools = allCli
    .filter(([name]) => allowedCli.has(name))
    .map(([name, config]) => ({ name, ...config }))

  // Ensure prlt is always present
  if (!cliTools.some(t => t.name === 'prlt')) {
    cliTools.push(BUILTIN_PRLT_TOOL)
  }

  // Filter API tools
  const allowedApi = new Set(policy.api || [])
  const apiTools = allApi
    .filter(([name]) => allowedApi.has(name))
    .map(([name, config]) => ({ name, ...config }))

  return { mcpServers, cliTools, apiTools }
}
