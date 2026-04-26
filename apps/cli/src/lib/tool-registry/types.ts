/**
 * Tool Registry Types
 *
 * Types for MCP servers and CLI tools as pluggable integration providers
 * with per-agent access control via policy profiles.
 */

// =============================================================================
// MCP Server Registry
// =============================================================================

export interface McpServerConfig {
  /** Server name (unique identifier) */
  name: string
  /** URL for remote MCP servers */
  url?: string
  /** Command for local MCP servers (e.g., "node ./tools/my-mcp-server.js") */
  command?: string
  /** Args for local MCP server command */
  args?: string[]
  /** Environment variable name for auth token (e.g., "${ARCADE_API_KEY}") */
  auth?: string
  /** Human-readable description */
  description: string
}

// =============================================================================
// API Tool Registry
// =============================================================================

export interface ApiToolConfig {
  /** Tool name (unique identifier) */
  name: string
  /** Base URL for the REST API */
  url: string
  /** Environment variable name holding the auth token (e.g., "POSTHOG_API_KEY") */
  auth?: string
  /** Auth header format (default: "Authorization: Bearer") */
  auth_header?: string
  /** Human-readable description */
  description: string
  /** Link to API documentation */
  docs?: string
}

// =============================================================================
// CLI Tool Registry
// =============================================================================

export interface CliToolConfig {
  /** Tool name (unique identifier) */
  name: string
  /** The command/binary to invoke */
  command: string
  /** Human-readable description */
  description: string
  /** Shell command to detect if tool is installed (e.g., "which gh") */
  detect?: string
  /** Shell command to install the tool (e.g., "brew install gh") */
  install?: string
  /** Whether this is a built-in tool (always available, no config needed) */
  builtin?: boolean
}

// =============================================================================
// Tool Registry (combined)
// =============================================================================

export interface ToolRegistry {
  'mcp-servers': Record<string, Omit<McpServerConfig, 'name'>>
  'cli-tools': Record<string, Omit<CliToolConfig, 'name'>>
  'api-tools': Record<string, Omit<ApiToolConfig, 'name'>>
}

// =============================================================================
// Tool Policy (per-agent access control)
// =============================================================================

export interface ToolPolicy {
  mcp: string[]
  cli: string[]
  api: string[]
  /** Per-MCP-server fine-grained access (e.g., arcade: { allow: ['asana', 'slack'] }) */
  [serverName: string]: string[] | { allow: string[] } | undefined
}

// =============================================================================
// Tool Check Result
// =============================================================================

export interface ToolCheckResult {
  name: string
  type: 'mcp' | 'cli' | 'api'
  available: boolean
  error?: string
  installHint?: string
}

// =============================================================================
// Common CLI tools for auto-detection
// =============================================================================

export const COMMON_CLI_TOOLS: CliToolConfig[] = [
  {
    name: 'gh',
    command: 'gh',
    description: 'GitHub CLI — PRs, issues, releases',
    detect: 'which gh',
    install: 'brew install gh',
  },
  {
    name: 'jq',
    command: 'jq',
    description: 'JSON processor',
    detect: 'which jq',
    install: 'brew install jq',
  },
  {
    name: 'ffmpeg',
    command: 'ffmpeg',
    description: 'Video/audio processing',
    detect: 'which ffmpeg',
    install: 'brew install ffmpeg',
  },
  {
    name: 'aws',
    command: 'aws',
    description: 'AWS CLI',
    detect: 'which aws',
    install: 'brew install awscli',
  },
  {
    name: 'gcloud',
    command: 'gcloud',
    description: 'Google Cloud CLI',
    detect: 'which gcloud',
  },
  {
    name: 'kubectl',
    command: 'kubectl',
    description: 'Kubernetes CLI',
    detect: 'which kubectl',
    install: 'brew install kubectl',
  },
  {
    name: 'terraform',
    command: 'terraform',
    description: 'Infrastructure as Code',
    detect: 'which terraform',
    install: 'brew install terraform',
  },
  {
    name: 'docker',
    command: 'docker',
    description: 'Container runtime',
    detect: 'which docker',
    install: 'brew install --cask docker',
  },
  {
    name: 'node',
    command: 'node',
    description: 'Node.js runtime',
    detect: 'which node',
    install: 'brew install node',
  },
  {
    name: 'python3',
    command: 'python3',
    description: 'Python 3 runtime',
    detect: 'which python3',
    install: 'brew install python',
  },
  {
    name: 'curl',
    command: 'curl',
    description: 'URL transfer tool',
    detect: 'which curl',
  },
  {
    name: 'git',
    command: 'git',
    description: 'Version control',
    detect: 'which git',
    install: 'brew install git',
  },
  {
    name: 'ripgrep',
    command: 'rg',
    description: 'Fast search (ripgrep)',
    detect: 'which rg',
    install: 'brew install ripgrep',
  },
]

/** Default built-in tool (prlt itself) */
export const BUILTIN_PRLT_TOOL: CliToolConfig = {
  name: 'prlt',
  command: 'prlt',
  description: 'Proletariat CLI (always available)',
  detect: 'which prlt',
  builtin: true,
}
