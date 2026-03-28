/**
 * Ticket Providers — public API.
 *
 * Unified provider interface for all ticket operations across backends.
 * provider.moveTicket(), .listTickets(), .createTicket(), .deleteTicket()
 * — same interface whether Linear, Jira, or local PMO.
 */

export type {
  TicketProvider,
  TicketProviderName,
  ProviderResult,
  ProviderMoveResult,
  ProviderDeleteResult,
  ProviderListResult,
  ProviderCreateResult,
  ProviderGetResult,
  ProviderUpdateResult,
  ProviderAssignResult,
  ProviderContext,
  ProviderStorage,
} from './types.js'

export { PMOTicketProvider } from './pmo-provider.js'
export { LinearTicketProvider } from './linear-provider.js'
export { TrelloTicketProvider } from './trello-provider.js'
export { GitHubIssuesTicketProvider } from './github-provider.js'
export { JiraTicketProvider } from './jira-provider.js'
export { EventEmittingProvider, type StatusResolver } from './event-emitting-provider.js'
export { ProviderStatusMappingStore, type StatusMapping } from './status-mapping.js'
export {
  ProviderTriggerStore,
  TriggerHandler,
  initTriggerHandler,
  stopTriggerHandler,
  TRIGGER_EVENTS,
  type TriggerEvent,
  type TriggerConfig,
} from './trigger-config.js'
export { resolveTicketProvider, resolveProjectProvider } from './resolver.js'
export {
  move,
  moveWithProvider,
  createPMProviderAdapter,
  llmResolveState,
  getStateMapConfig,
  setStateMapConfig,
  deleteStateMapConfig,
  listStateMapConfigs,
  type PMProvider,
  type PMState,
  type StateResolutionResult,
  type MoveOptions,
} from './state-resolution.js'
export {
  DEFAULT_INTENTS,
  getDefaultIntent,
  matchIntentByAliases,
  type SemanticIntent,
} from './state-intents.js'
