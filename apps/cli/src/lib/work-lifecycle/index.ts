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
