/**
 * Tool Registry Types
 *
 * Types for MCP servers and CLI tools as pluggable integration providers.
 */

// =============================================================================
// MCP Server Registry
// =============================================================================

export interface McpServerEntry {
  /** Server URL (for remote servers) */
  url?: string
  /** Command to start local MCP server */
  command?: string
  /** Args for the command */
  args?: string[]
  /** Environment variable name for auth token */
  auth?: string
  /** Human-readable description */
  description?: string
}

// =============================================================================
// CLI Tool Registry
// =============================================================================

export interface CliToolEntry {
  /** Command to invoke the tool */
  command: string
  /** Human-readable description */
  description?: string
  /** Shell command to check if tool is installed (e.g., "which gh") */
  detect?: string
  /** Shell command to install the tool (e.g., "brew install gh") */
  install?: string
  /** Whether this is a built-in tool (always available, not removable) */
  builtin?: boolean
}

// =============================================================================
// Tool Registry (tools.yaml)
// =============================================================================

export interface ToolRegistry {
  'mcp-servers'?: Record<string, McpServerEntry>
  'cli-tools'?: Record<string, CliToolEntry>
}

// =============================================================================
// Policy Profile (per-agent access control)
// =============================================================================

export interface ToolPolicy {
  /** Which MCP server names this agent can access */
  mcp?: string[]
  /** Which CLI tool names this agent can access */
  cli?: string[]
  /** Per-MCP-server fine-grained access (e.g., which Arcade tools to allow) */
  [serverName: string]: string[] | undefined
}

export interface PolicyProfile {
  tools?: ToolPolicy
}

// =============================================================================
// Resolved Tool Context (for spawn-time)
// =============================================================================

export interface ResolvedMcpServer {
  name: string
  url?: string
  command?: string
  args?: string[]
  auth?: string
  description?: string
}

export interface ResolvedCliTool {
  name: string
  command: string
  description?: string
  available: boolean
}

export interface ResolvedToolContext {
  mcpServers: ResolvedMcpServer[]
  cliTools: ResolvedCliTool[]
}

// =============================================================================
// Claude Code MCP Config (mcp-config.json)
// =============================================================================

export interface ClaudeMcpServerConfig {
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
}

export interface ClaudeMcpConfig {
  mcpServers: Record<string, ClaudeMcpServerConfig>
}

// =============================================================================
// Common CLI tools for auto-detection
// =============================================================================

export const COMMON_CLI_TOOLS: Record<string, CliToolEntry> = {
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
    description: 'Infrastructure as Code',
    detect: 'which terraform',
    install: 'brew install terraform',
  },
  docker: {
    command: 'docker',
    description: 'Container runtime',
    detect: 'which docker',
    install: 'brew install --cask docker',
  },
  node: {
    command: 'node',
    description: 'Node.js runtime',
    detect: 'which node',
    install: 'brew install node',
  },
  python3: {
    command: 'python3',
    description: 'Python 3 runtime',
    detect: 'which python3',
    install: 'brew install python3',
  },
  curl: {
    command: 'curl',
    description: 'HTTP client',
    detect: 'which curl',
  },
  git: {
    command: 'git',
    description: 'Version control',
    detect: 'which git',
    install: 'brew install git',
  },
}
