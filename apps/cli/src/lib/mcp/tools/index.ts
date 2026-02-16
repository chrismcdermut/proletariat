/**
 * MCP Tools - Export all tool registrars
 */

export { registerTicketTools } from './ticket.js'
export { registerProjectTools } from './project.js'
export { registerBoardTools } from './board.js'
export { registerSpecTools } from './spec.js'
export { registerEpicTools } from './epic.js'
export { registerWorkTools } from './work.js'
export { registerWorkflowTools } from './workflow.js'
export { registerStatusTools } from './status.js'
export { registerPhaseTools } from './phase.js'
export { registerActionTools } from './action.js'
export { registerRoadmapTools } from './roadmap.js'
export { registerCategoryTools } from './category.js'
export { registerTemplateTools } from './template.js'
export { registerViewTools } from './view.js'
export { registerCommentTools } from './comment.js'
export { registerDietTools } from './diet.js'

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
