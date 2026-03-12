/**
 * Tool Registry — Public API
 */

// Types
export type {
  McpServerConfig,
  CliToolConfig,
  ToolRegistry,
  ToolPolicy,
  ToolCheckResult,
} from './types.js'
export { COMMON_CLI_TOOLS, BUILTIN_PRLT_TOOL } from './types.js'

// Registry operations
export {
  getToolsConfigPath,
  loadToolRegistry,
  saveToolRegistry,
  getMcpServers,
  getCliTools,
  addMcpServer,
  addCliTool,
  removeTool,
} from './registry.js'

// Detection and health
export {
  isCliToolAvailable,
  detectAvailableTools,
  checkAllTools,
} from './detect.js'

// Policy
export {
  getPoliciesDir,
  loadToolPolicy,
  saveToolPolicy,
  listPolicies,
  filterByPolicy,
} from './policy.js'

// Spawn-time integration
export {
  generateMcpConfig,
  writeMcpConfigFile,
  buildToolsPromptSection,
  resolveToolsForSpawn,
} from './spawn.js'
export type { SpawnToolsResult } from './spawn.js'
