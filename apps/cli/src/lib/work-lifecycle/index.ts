/**
 * Work Lifecycle module — public API.
 *
 * Provides provider-agnostic domain events for work item state changes.
 * The adapter layer translates provider-specific events (PMO tickets,
 * GitHub PRs, Linear issues, etc.) into these domain events.
 */

export type {
  WorkEventSource,
  WorkStartedEvent,
  WorkStatusChangedEvent,
  WorkPRCreatedEvent,
  WorkCompletedEvent,
} from './events.js'

export {
  WorkLifecycleAdapter,
  initWorkLifecycleAdapter,
  stopWorkLifecycleAdapter,
} from './adapter.js'

export {
  initHookManager,
  stopHookManager,
} from './hooks/index.js'

export {
  handlePostExecutionTransition,
  type PostExecutionContext,
  type PostExecutionResult,
} from './post-execution.js'

export {
  validateCommits,
  tryValidateCommits,
  type CommitValidationResult,
} from '../execution/commit-validation.js'

export {
  WorkflowRuleEvaluator,
  initWorkflowRuleEvaluator,
  stopWorkflowRuleEvaluator,
} from './rule-evaluator.js'

export {
  ActionChainingHandler,
  initActionChaining,
  stopActionChaining,
} from './action-chaining.js'

export {
  ContainerCleanupHook,
  initContainerCleanupHook,
  stopContainerCleanupHook,
} from './container-cleanup-hook.js'
