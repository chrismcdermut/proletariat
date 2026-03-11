/**
 * Tool Policy
 *
 * Load per-agent policy profiles and filter tool registry by policy.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import yaml from 'js-yaml'
import type {
  PolicyProfile,
  ToolRegistry,
  ResolvedToolContext,
  ResolvedMcpServer,
  ResolvedCliTool,
} from './types.js'
import { checkToolAvailability } from './detect.js'

const POLICIES_DIR = 'policies'

/**
 * Load a policy profile by name.
 * Looks in .proletariat/policies/<name>.yaml
 */
export function loadPolicy(hqPath: string, policyName: string): PolicyProfile | null {
  const policyPath = path.join(hqPath, '.proletariat', POLICIES_DIR, `${policyName}.yaml`)

  if (!fs.existsSync(policyPath)) {
    return null
  }

  try {
    const content = fs.readFileSync(policyPath, 'utf-8')
    return yaml.load(content) as PolicyProfile
  } catch {
    return null
  }
}

/**
 * Save a policy profile.
 */
export function savePolicy(hqPath: string, policyName: string, policy: PolicyProfile): void {
  const policiesDir = path.join(hqPath, '.proletariat', POLICIES_DIR)
  fs.mkdirSync(policiesDir, { recursive: true })

  const policyPath = path.join(policiesDir, `${policyName}.yaml`)
  const content = yaml.dump(policy, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  })

  fs.writeFileSync(policyPath, content)
}

/**
 * List all available policy profiles.
 */
export function listPolicies(hqPath: string): string[] {
  const policiesDir = path.join(hqPath, '.proletariat', POLICIES_DIR)

  if (!fs.existsSync(policiesDir)) {
    return []
  }

  return fs.readdirSync(policiesDir)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => f.replace(/\.ya?ml$/, ''))
}

/**
 * Resolve tool context by filtering registry through a policy.
 * If no policy is provided, all tools are available.
 */
export function resolveToolContext(
  registry: ToolRegistry,
  policy?: PolicyProfile | null,
): ResolvedToolContext {
  const allMcpServers = registry['mcp-servers'] ?? {}
  const allCliTools = registry['cli-tools'] ?? {}

  let mcpServers: ResolvedMcpServer[]
  let cliTools: ResolvedCliTool[]

  if (policy?.tools) {
    // Filter MCP servers by policy
    const allowedMcp = policy.tools.mcp ?? []
    mcpServers = allowedMcp
      .filter(name => allMcpServers[name])
      .map(name => ({
        name,
        ...allMcpServers[name],
      }))

    // Filter CLI tools by policy (always include builtin tools)
    const allowedCli = policy.tools.cli ?? []
    cliTools = Object.entries(allCliTools)
      .filter(([name, entry]) => entry.builtin || allowedCli.includes(name))
      .map(([name, entry]) => ({
        name,
        command: entry.command,
        description: entry.description,
        available: checkToolAvailability(entry),
      }))
  } else {
    // No policy = all tools available
    mcpServers = Object.entries(allMcpServers).map(([name, entry]) => ({
      name,
      ...entry,
    }))

    cliTools = Object.entries(allCliTools).map(([name, entry]) => ({
      name,
      command: entry.command,
      description: entry.description,
      available: checkToolAvailability(entry),
    }))
  }

  return { mcpServers, cliTools }
}
