/**
 * Work Lifecycle Hooks — public API.
 *
 * Configurable event-driven actions for work lifecycle events.
 * Hooks subscribe to the EventBus and execute user-configured
 * actions (shell commands, webhooks, log messages, built-in actions)
 * when events fire, with mode-aware behavior (auto/confirm/notify/off).
 */

export type {
  HookableEvent,
  HookActionType,
  HookMode,
  WorkHookConfig,
  WorkHookRow,
  HookExecutionResult,
  HookActionHandler,
  AsyncHookActionHandler,
  PokeActionConfig,
  LlmActionConfig,
  WebhookActionConfig,
  EventPayloadMap,
  PrOpenedPayload,
  PrMergedPayload,
  CiGreenPayload,
  CiFailedPayload,
  AgentCompletedPayload,
  AgentDiedPayload,
  PrCommentPayload,
} from './types.js'

export {
  HOOKABLE_EVENTS,
  HOOK_MODES,
  TYPED_EVENT_NAMES,
  EVENT_PAYLOAD_FIELDS,
  interpolateTemplate,
} from './types.js'

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

export type { HookManagerOptions } from './manager.js'
