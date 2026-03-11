/**
 * Tool Registry
 *
 * Manages registered MCP servers and CLI tools at the workspace level.
 * Stored in .proletariat/tools.yaml.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import yaml from 'js-yaml'
import { execSync } from 'node:child_process'

// =============================================================================
// Types
// =============================================================================

export interface McpServerConfig {
  /** Remote server URL (for HTTP-based MCP servers) */
  url?: string
  /** Local command to run (for stdio-based MCP servers) */
  command?: string
  /** Command arguments (for stdio-based MCP servers) */
  args?: string[]
  /** Auth environment variable name (e.g., ${ARCADE_API_KEY}) */
  auth?: string
  /** Human-readable description */
  description: string
}

export interface CliToolConfig {
  /** Command to invoke */
  command: string
  /** Human-readable description */
  description: string
  /** Command to check if tool is installed (e.g., "which gh") */
  detect?: string
  /** Install command hint (e.g., "brew install gh") */
  install?: string
  /** Whether this is a built-in tool (always available, cannot be removed) */
  builtin?: boolean
}

export interface ToolRegistry {
  'mcp-servers': Record<string, McpServerConfig>
  'cli-tools': Record<string, CliToolConfig>
}

export interface ToolPolicy {
  mcp: string[]
  cli: string[]
  /** Per-MCP-server sub-filtering (e.g., { arcade: { allow: ['asana', 'slack'] } }) */
  [key: string]: string[] | { allow: string[] } | undefined
}

// =============================================================================
// Well-known CLI tools for auto-detection
// =============================================================================

export const WELL_KNOWN_CLI_TOOLS: Record<string, Omit<CliToolConfig, 'command'> & { command: string }> = {
  gh: {
    command: 'gh',
    description: 'GitHub CLI — PRs, issues, releases',
    detect: 'which gh',
    install: 'brew install gh',
  },
  jq: {
    command: 'jq',
    description: 'JSON processor',
    detect: 'which jq',
    install: 'brew install jq',
  },
  ffmpeg: {
    command: 'ffmpeg',
    description: 'Video/audio processing',
    detect: 'which ffmpeg',
    install: 'brew install ffmpeg',
  },
  aws: {
    command: 'aws',
    description: 'AWS CLI',
    detect: 'which aws',
    install: 'brew install awscli',
  },
  gcloud: {
    command: 'gcloud',
    description: 'Google Cloud CLI',
    detect: 'which gcloud',
  },
  kubectl: {
    command: 'kubectl',
    description: 'Kubernetes CLI',
    detect: 'which kubectl',
    install: 'brew install kubectl',
  },
  terraform: {
    command: 'terraform',
    description: 'Infrastructure as code',
    detect: 'which terraform',
    install: 'brew install terraform',
  },
  docker: {
    command: 'docker',
    description: 'Container runtime',
    detect: 'which docker',
    install: 'brew install docker',
  },
  node: {
    command: 'node',
    description: 'Node.js runtime',
    detect: 'which node',
  },
  python3: {
    command: 'python3',
    description: 'Python 3 runtime',
    detect: 'which python3',
  },
  cargo: {
    command: 'cargo',
    description: 'Rust package manager',
    detect: 'which cargo',
  },
  go: {
    command: 'go',
    description: 'Go toolchain',
    detect: 'which go',
  },
}

// Built-in tools that are always registered
const BUILTIN_TOOLS: Record<string, CliToolConfig> = {
  prlt: {
    command: 'prlt',
    description: 'Proletariat CLI (always available)',
    builtin: true,
  },
}

// =============================================================================
// Registry File Operations
// =============================================================================

function getToolsFilePath(hqPath: string): string {
  return path.join(hqPath, '.proletariat', 'tools.yaml')
}

function getDefaultRegistry(): ToolRegistry {
  return {
    'mcp-servers': {},
    'cli-tools': { ...BUILTIN_TOOLS },
  }
}

/**
 * Read tool registry from .proletariat/tools.yaml
 */
export function readToolRegistry(hqPath: string): ToolRegistry {
  const filePath = getToolsFilePath(hqPath)

  if (!fs.existsSync(filePath)) {
    return getDefaultRegistry()
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = yaml.load(content) as Partial<ToolRegistry> | null

    // Merge with defaults to ensure built-in tools are always present
    const registry: ToolRegistry = {
      'mcp-servers': parsed?.['mcp-servers'] ?? {},
      'cli-tools': {
        ...BUILTIN_TOOLS,
        ...(parsed?.['cli-tools'] ?? {}),
      },
    }

    return registry
  } catch {
    return getDefaultRegistry()
  }
}

/**
 * Write tool registry to .proletariat/tools.yaml
 */
export function writeToolRegistry(hqPath: string, registry: ToolRegistry): void {
  const filePath = getToolsFilePath(hqPath)
  const dir = path.dirname(filePath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const content = yaml.dump(registry, {
    lineWidth: -1,  // Don't wrap lines
    quotingType: "'",
    forceQuotes: false,
  })

  fs.writeFileSync(filePath, content)
}

// =============================================================================
// Registry Mutations
// =============================================================================

/**
 * Add or update an MCP server in the registry
 */
export function addMcpServer(hqPath: string, name: string, config: McpServerConfig): void {
  const registry = readToolRegistry(hqPath)
  registry['mcp-servers'][name] = config
  writeToolRegistry(hqPath, registry)
}

/**
 * Add or update a CLI tool in the registry
 */
export function addCliTool(hqPath: string, name: string, config: CliToolConfig): void {
  const registry = readToolRegistry(hqPath)
  registry['cli-tools'][name] = config
  writeToolRegistry(hqPath, registry)
}

/**
 * Remove a tool (MCP server or CLI tool) from the registry
 */
export function removeTool(hqPath: string, name: string): { removed: boolean; type?: 'mcp' | 'cli'; wasBuiltin?: boolean } {
  const registry = readToolRegistry(hqPath)

  // Check if it's a built-in tool
  if (registry['cli-tools'][name]?.builtin) {
    return { removed: false, type: 'cli', wasBuiltin: true }
  }

  // Check MCP servers first
  if (name in registry['mcp-servers']) {
    delete registry['mcp-servers'][name]
    writeToolRegistry(hqPath, registry)
    return { removed: true, type: 'mcp' }
  }

  // Check CLI tools
  if (name in registry['cli-tools']) {
    delete registry['cli-tools'][name]
    writeToolRegistry(hqPath, registry)
    return { removed: true, type: 'cli' }
  }

  return { removed: false }
}

// =============================================================================
// Tool Detection and Health Checks
// =============================================================================

export interface ToolCheckResult {
  name: string
  type: 'mcp' | 'cli'
  available: boolean
  error?: string
}

/**
 * Check if a CLI tool is available on the system
 */
function checkCliToolAvailable(tool: CliToolConfig): boolean {
  const detectCmd = tool.detect || `which ${tool.command}`
  try {
    execSync(detectCmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * Check availability of all registered tools
 */
export function checkTools(hqPath: string): ToolCheckResult[] {
  const registry = readToolRegistry(hqPath)
  const results: ToolCheckResult[] = []

  // Check MCP servers (basic URL/command validation)
  for (const [name, config] of Object.entries(registry['mcp-servers'])) {
    if (config.command) {
      // stdio-based MCP server - check if command exists
      const cmdName = config.command.split(' ')[0]
      try {
        execSync(`which ${cmdName}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
        results.push({ name, type: 'mcp', available: true })
      } catch {
        results.push({ name, type: 'mcp', available: false, error: `Command not found: ${cmdName}` })
      }
    } else if (config.url) {
      // HTTP-based MCP server - mark as available (can't fully validate without connecting)
      results.push({ name, type: 'mcp', available: true })
    } else {
      results.push({ name, type: 'mcp', available: false, error: 'No url or command configured' })
    }
  }

  // Check CLI tools
  for (const [name, config] of Object.entries(registry['cli-tools'])) {
    const available = checkCliToolAvailable(config)
    results.push({
      name,
      type: 'cli',
      available,
      error: available ? undefined : `${config.command} not found${config.install ? ` (install: ${config.install})` : ''}`,
    })
  }

  return results
}

/**
 * Auto-detect common CLI tools installed on the system
 */
export function detectCliTools(): Array<{ name: string; config: CliToolConfig }> {
  const detected: Array<{ name: string; config: CliToolConfig }> = []

  for (const [name, config] of Object.entries(WELL_KNOWN_CLI_TOOLS)) {
    if (checkCliToolAvailable(config)) {
      detected.push({ name, config })
    }
  }

  return detected
}

// =============================================================================
// Policy Filtering
// =============================================================================

/**
 * Filter the tool registry by a policy profile.
 * Returns only the tools that the policy allows.
 */
export function filterRegistryByPolicy(
  registry: ToolRegistry,
  policy?: ToolPolicy
): ToolRegistry {
  if (!policy) {
    // No policy = full access
    return registry
  }

  const filtered: ToolRegistry = {
    'mcp-servers': {},
    'cli-tools': {},
  }

  // Filter MCP servers
  for (const name of policy.mcp) {
    if (name in registry['mcp-servers']) {
      filtered['mcp-servers'][name] = registry['mcp-servers'][name]
    }
  }

  // Filter CLI tools (always include prlt)
  const cliNames = new Set(policy.cli)
  cliNames.add('prlt') // Always available
  for (const name of cliNames) {
    if (name in registry['cli-tools']) {
      filtered['cli-tools'][name] = registry['cli-tools'][name]
    }
  }

  return filtered
}

// =============================================================================
// MCP Config Generation
// =============================================================================

export interface ClaudeMcpConfig {
  mcpServers: Record<string, {
    url?: string
    command?: string
    args?: string[]
    env?: Record<string, string>
  }>
}

/**
 * Generate Claude Code MCP config JSON from filtered registry.
 * This is written to a temp file and passed via --mcp-config.
 */
export function generateMcpConfig(registry: ToolRegistry): ClaudeMcpConfig | null {
  const mcpServers = registry['mcp-servers']
  if (Object.keys(mcpServers).length === 0) {
    return null
  }

  const config: ClaudeMcpConfig = { mcpServers: {} }

  for (const [name, server] of Object.entries(mcpServers)) {
    const entry: ClaudeMcpConfig['mcpServers'][string] = {}

    if (server.url) {
      entry.url = server.url
    }
    if (server.command) {
      entry.command = server.command
    }
    if (server.args) {
      entry.args = server.args
    }

    // Resolve auth env var references (${VAR_NAME} -> actual value)
    if (server.auth) {
      const envVarMatch = server.auth.match(/^\$\{(.+)\}$/)
      if (envVarMatch) {
        const envVarName = envVarMatch[1]
        const envValue = process.env[envVarName]
        if (envValue) {
          entry.env = { [envVarName]: envValue }
        }
      }
    }

    config.mcpServers[name] = entry
  }

  return config
}

// =============================================================================
// Agent Prompt Generation
// =============================================================================

/**
 * Build the AVAILABLE TOOLS section for agent prompts.
 * Describes what MCP servers and CLI tools the agent has access to.
 */
export function buildToolsPromptSection(registry: ToolRegistry): string {
  const mcpServers = Object.entries(registry['mcp-servers'])
  const cliTools = Object.entries(registry['cli-tools'])

  if (mcpServers.length === 0 && cliTools.length === 0) {
    return ''
  }

  let section = '\n## Available Tools\n\n'

  if (mcpServers.length > 0) {
    section += '**MCP Servers:**\n'
    for (const [name, config] of mcpServers) {
      section += `- ${name}: ${config.description}\n`
    }
    section += '\n'
  }

  if (cliTools.length > 0) {
    section += '**CLI Tools:**\n'
    for (const [name, config] of cliTools) {
      section += `- ${name} (\`${config.command}\`): ${config.description}\n`
    }
    section += '\n'
  }

  section += 'Use these tools for external interactions. Do NOT use curl or raw API calls when a registered tool is available.\n'

  return section
}
