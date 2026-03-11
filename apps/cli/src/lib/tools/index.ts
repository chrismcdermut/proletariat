/**
 * Tool Registry - Public API
 */

export * from './types.js'
export {
  loadToolRegistry,
  saveToolRegistry,
  addMcpServer,
  addCliTool,
  removeTool,
  getAllToolNames,
  ensureBuiltinTools,
  getToolsPath,
} from './registry.js'
export {
  loadPolicy,
  savePolicy,
  listPolicies,
  resolveToolContext,
} from './policy.js'
export {
  checkToolAvailability,
  detectAvailableTools,
  checkRegisteredTools,
} from './detect.js'
export {
  generateMcpConfig,
  writeMcpConfigFile,
} from './mcp-config.js'
export {
  buildToolsPromptSection,
} from './prompt.js'
export {
  resolveAndAttachToolContext,
} from './resolve.js'
