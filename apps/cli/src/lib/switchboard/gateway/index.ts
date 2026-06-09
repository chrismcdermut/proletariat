/**
 * Messaging Gateway — External platform adapters for the switchboard.
 *
 * Bridges Slack, Discord, and WhatsApp to the internal switchboard
 * message bus, enabling bidirectional communication with running agents
 * from external platforms.
 *
 * See: PRLT-1372
 *
 * @module switchboard/gateway
 */

// Core types
export type {
  GatewayPlatform,
  InboundMessage,
  OutboundMessage,
  MessageBlock,
  TextBlock,
  CodeBlock,
  LinkBlock,
  StatusCardBlock,
  DividerBlock,
  MessageTarget,
  GatewayCredentials,
  AuthResult,
  AdapterState,
  GatewayAdapter,
  AdapterConfig,
  GatewayConfig,
  GatewayMessageHandler,
  GatewaySwitchboardHandler,
} from './types.js'

// Auth
export {
  verifyAuth,
  verifySlackSignature,
  verifyDiscordSignature,
  verifyWhatsAppSignature,
} from './auth.js'

// Formatter
export {
  formatSlackBlocks,
  formatDiscordContent,
  formatWhatsAppText,
  formatOutboundMessage,
  parseMessageTarget,
} from './formatter.js'

// Adapters
export { SlackAdapter, type SlackAdapterOptions } from './adapters/slack.js'
export { DiscordAdapter, type DiscordAdapterOptions } from './adapters/discord.js'
export { WhatsAppAdapter, type WhatsAppAdapterOptions } from './adapters/whatsapp.js'

// Gateway
export { Gateway } from './gateway.js'
