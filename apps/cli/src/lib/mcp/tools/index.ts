/**
 * MCP Tools - Export all tool registrars
 */

export { registerWorkTools } from './work.js'
export { registerDietTools } from './diet.js'
export { registerTmuxTools } from './tmux.js'

// CLI passthrough tools
export {
  registerAgentTools,
  registerDockerTools,
  registerRepoTools,
  registerBranchTools,
  registerGitHubTools,
  registerInitTools,
  registerUtilityTools,
} from './cli-passthrough.js'
