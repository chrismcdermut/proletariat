/**
 * Switchboard — Internal message bus for session/orchestrator communication.
 *
 * Provides structured, bidirectional communication between sessions,
 * the orchestrator, and the daemon via a durable SQLite-backed message
 * queue with Unix domain socket wakeup notifications.
 *
 * See: PRLT-1371
 *
 * @module switchboard
 */

// Core types
export {
  type SwitchboardAddress,
  type SwitchboardAddressKind,
  type SwitchboardPattern,
  type SwitchboardMessage,
  type SwitchboardMessageStatus,
  type SwitchboardSubscription,
  type SwitchboardCursor,
  type SendMessageOptions,
  type CallOptions,
  type CallResult,
  addressKey,
  DEFAULT_TTL,
} from './types.js'

// Database
export {
  SwitchboardDB,
  getSwitchboardDbPath,
  getSwitchboardSocketPath,
  ensureSwitchboardDb,
} from './db.js'

// Schema
export { SWITCHBOARD_SCHEMA_SQL } from './schema.js'

// Client
export {
  SwitchboardClient,
  type SwitchboardClientOptions,
} from './client.js'

// Server
export {
  SwitchboardServer,
  type SwitchboardServerOptions,
} from './server.js'

// Router
export {
  SwitchboardRouter,
  type SwitchboardRouterOptions,
  type RouteResult,
} from './router.js'

// Bridge
export {
  SwitchboardBridge,
  type SwitchboardBridgeOptions,
} from './bridge.js'

// GC
export {
  SwitchboardGC,
  type SwitchboardGCOptions,
  type GCResult,
} from './gc.js'

// Agent integration
export {
  registerSwitchboardTools,
  type SwitchboardMcpContext,
} from './agent/mcp-tools.js'

export {
  initAgentSwitchboard,
  teardownAgentSwitchboard,
  buildAgentSwitchboardConfig,
  type AgentSwitchboardConfig,
} from './agent/hooks.js'

export {
  buildHostMcpConfig,
  buildContainerMcpConfig,
  getSwitchboardVolumeMounts,
  getSwitchboardEnvVars,
  type SwitchboardMcpConfig,
} from './agent/startup.js'
