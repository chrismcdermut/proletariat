/**
 * Messaging Gateway Type Definitions
 *
 * Types for the messaging gateway that bridges external platforms
 * (Slack, Discord, WhatsApp) to the switchboard message bus.
 *
 * See: PRLT-1372
 */

import type { SwitchboardAddress, SwitchboardMessage } from '../types.js'

// =============================================================================
// Platform
// =============================================================================

/** Supported messaging platforms. */
export type GatewayPlatform = 'slack' | 'discord' | 'whatsapp'

// =============================================================================
// Inbound Message (external → switchboard)
// =============================================================================

/**
 * A normalized inbound message from an external platform.
 *
 * Adapters parse platform-specific payloads into this common shape
 * before the gateway routes them into the switchboard.
 */
export interface InboundMessage {
  /** Unique message ID from the platform. */
  platformMessageId: string
  /** Which platform it came from. */
  platform: GatewayPlatform
  /** Platform-specific sender identifier (e.g. Slack user ID). */
  senderId: string
  /** Human-readable sender name (if available). */
  senderName?: string
  /** Platform-specific channel/conversation identifier. */
  channelId: string
  /** The raw text content. */
  text: string
  /** Optional thread/reply-chain identifier. */
  threadId?: string
  /** When the message was sent (ISO timestamp). */
  timestamp: string
  /** Optional platform-specific metadata. */
  metadata?: Record<string, unknown>
}

// =============================================================================
// Outbound Message (switchboard → external)
// =============================================================================

/**
 * An outbound message to be sent to an external platform.
 *
 * The gateway constructs these from switchboard messages and hands
 * them to the appropriate adapter for platform-specific formatting.
 */
export interface OutboundMessage {
  /** Target platform. */
  platform: GatewayPlatform
  /** Channel/conversation to send to. */
  channelId: string
  /** Plain text content. */
  text: string
  /** Optional thread to reply in. */
  threadId?: string
  /** Structured blocks for rich formatting. */
  blocks?: MessageBlock[]
  /** Optional metadata for the adapter. */
  metadata?: Record<string, unknown>
}

// =============================================================================
// Rich Message Blocks
// =============================================================================

/** A block in a rich message. */
export type MessageBlock =
  | TextBlock
  | CodeBlock
  | LinkBlock
  | StatusCardBlock
  | DividerBlock

export interface TextBlock {
  type: 'text'
  content: string
}

export interface CodeBlock {
  type: 'code'
  content: string
  language?: string
}

export interface LinkBlock {
  type: 'link'
  url: string
  label?: string
}

export interface StatusCardBlock {
  type: 'status_card'
  title: string
  status: 'success' | 'failure' | 'warning' | 'info' | 'in_progress'
  fields: Array<{ label: string; value: string }>
}

export interface DividerBlock {
  type: 'divider'
}

// =============================================================================
// Routing
// =============================================================================

/**
 * Routing target — parsed from the inbound message text.
 *
 * Users can address a specific agent ("@agent-name do X") or broadcast
 * to all agents. If no explicit target is found, defaults to broadcast.
 */
export interface MessageTarget {
  /** 'direct' routes to a single agent; 'broadcast' fans out to all. */
  mode: 'direct' | 'broadcast'
  /** Agent ID or name (only set when mode is 'direct'). */
  agentId?: string
  /** Ticket ID (optional — resolves to the agent working that ticket). */
  ticketId?: string
}

// =============================================================================
// Auth
// =============================================================================

/** Credentials for authenticating with a platform. */
export interface GatewayCredentials {
  /** Platform this credential set is for. */
  platform: GatewayPlatform
  /** Bot/app token for authenticating outbound API calls. */
  botToken: string
  /** Signing secret for verifying inbound webhook payloads. */
  signingSecret?: string
  /** Allowed user IDs — if set, only these users can send messages. */
  allowedUserIds?: string[]
  /** App-level token for Slack Socket Mode. */
  appToken?: string
  /** WhatsApp Business phone number ID (WhatsApp only). */
  phoneNumberId?: string
  /** Webhook verification token (WhatsApp only). */
  verifyToken?: string
}

/** Result of an auth verification check. */
export interface AuthResult {
  /** Whether the message is authorized. */
  authorized: boolean
  /** Reason for denial (if not authorized). */
  reason?: string
  /** Verified user ID from the platform. */
  userId?: string
}

// =============================================================================
// Adapter Interface
// =============================================================================

/** Lifecycle state of a gateway adapter. */
export type AdapterState = 'stopped' | 'starting' | 'connected' | 'error'

/**
 * A gateway adapter bridges a single external platform to the switchboard.
 *
 * Each adapter handles:
 * - Connecting to the platform (websocket, webhook server, polling)
 * - Receiving inbound messages and normalizing them
 * - Sending outbound messages with platform-specific formatting
 * - Verifying message authenticity
 */
export interface GatewayAdapter {
  /** Which platform this adapter handles. */
  readonly platform: GatewayPlatform
  /** Current lifecycle state. */
  readonly state: AdapterState

  /**
   * Start the adapter — connect to the platform.
   * Called once by the gateway during startup.
   */
  start(): Promise<void>

  /**
   * Stop the adapter — disconnect from the platform.
   * Called during shutdown for graceful cleanup.
   */
  stop(): Promise<void>

  /**
   * Send a message to the platform.
   * The adapter converts OutboundMessage to platform-specific format.
   */
  send(message: OutboundMessage): Promise<void>

  /**
   * Verify an inbound request's authenticity.
   * Returns an AuthResult indicating whether the request is authorized.
   */
  verify(headers: Record<string, string>, body: string): Promise<AuthResult>
}

// =============================================================================
// Gateway Configuration
// =============================================================================

/**
 * Configuration for a single adapter in the gateway.
 */
export interface AdapterConfig {
  /** Platform to connect to. */
  platform: GatewayPlatform
  /** Whether this adapter is enabled. */
  enabled: boolean
  /** Credentials for the platform. */
  credentials: GatewayCredentials
  /** Default channel to send notifications to. */
  defaultChannelId?: string
}

/**
 * Full gateway configuration.
 */
export interface GatewayConfig {
  /** Adapters to initialize. */
  adapters: AdapterConfig[]
  /** Switchboard address for the gateway client. */
  address?: SwitchboardAddress
  /** Topics to subscribe to for outbound notifications. */
  subscribeTopics?: string[]
  /** Port for the webhook HTTP server (used by Slack/WhatsApp). */
  webhookPort?: number
  /** Logger function. */
  log?: (msg: string) => void
}

// =============================================================================
// Gateway Events (for the message handler callback)
// =============================================================================

/**
 * Callback invoked when the gateway receives an inbound message
 * from an external platform, after auth verification.
 */
export type GatewayMessageHandler = (
  message: InboundMessage,
  target: MessageTarget,
) => void | Promise<void>

/**
 * Callback invoked when a switchboard message should be forwarded
 * to an external platform.
 */
export type GatewaySwitchboardHandler = (
  message: SwitchboardMessage,
) => void | Promise<void>
