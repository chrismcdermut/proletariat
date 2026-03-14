/**
 * Work Lifecycle Hooks — public API.
 *
 * Configurable event-driven actions for work lifecycle events.
 * Hooks subscribe to the EventBus and execute user-configured
 * actions (shell commands, webhooks, log messages) when events fire.
 */

export type {
  HookableEvent,
  HookActionType,
  WorkHookConfig,
  WorkHookRow,
  HookExecutionResult,
} from './types.js'

export { HOOKABLE_EVENTS } from './types.js'

export {
  WorkHookStorage,
  HOOKS_TABLE,
  HOOKS_TABLE_SCHEMA,
  HOOKS_TABLE_INDEX,
  ensureHooksTable,
} from './storage.js'

export { executeHook } from './executor.js'

export {
  HookManager,
  initHookManager,
  stopHookManager,
} from './manager.js'
