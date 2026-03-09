/**
 * Events module — public API.
 */

export type {
  RuntimeEventMap,
  RuntimeEventName,
  AgentSpawnedEvent,
  AgentStatusChangeEvent,
  AgentPokedEvent,
  AgentStoppedEvent,
  AgentErrorEvent,
  AgentOutputEvent,
} from './events.js'

export {
  EventBus,
  getEventBus,
  resetEventBus,
} from './event-bus.js'

export type { EventListener } from './event-bus.js'

export { EventEmittingRunner } from './emitting-runner.js'
