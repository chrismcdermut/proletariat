/**
 * Switchboard Type Definitions
 *
 * Core types for the internal message bus that enables structured,
 * bidirectional communication between sessions, the orchestrator,
 * and the daemon.
 *
 * See: PRLT-1371
 */

// =============================================================================
// Address
// =============================================================================

/** The kind of endpoint participating in switchboard messaging. */
export type SwitchboardAddressKind =
  | 'session'
  | 'agent'
  | 'daemon'
  | 'orchestrator'
  | 'gateway'
  | 'cli'
  | 'topic'

/**
 * A switchboard endpoint address.
 *
 * Addresses identify the sender or recipient of a message.
 * The `kind` + `id` pair is unique. Container agents include
 * `containerId` so the router can locate them across the Docker boundary.
 */
export interface SwitchboardAddress {
  kind: SwitchboardAddressKind
  id: string
  containerId?: string
}

// =============================================================================
// Message
// =============================================================================

/** Delivery pattern determines routing and lifecycle semantics. */
export type SwitchboardPattern = 'cast' | 'call' | 'reply' | 'event'

/** Message lifecycle status. */
export type SwitchboardMessageStatus = 'pending' | 'delivered' | 'expired' | 'failed'

/**
 * A switchboard message — the unit of communication.
 *
 * Messages flow through the switchboard database. Each has a delivery
 * pattern that determines how it's routed and acknowledged:
 *
 * - **cast**: fire-and-forget, at-least-once, TTL 1hr
 * - **call**: request/reply, blocks caller, 30s default timeout
 * - **reply**: response to a call by correlationId
 * - **event**: pub/sub fanout to topic subscribers, TTL 24hr
 */
export interface SwitchboardMessage {
  /** Unique message ID (MSG-{uuid8}) */
  id: string
  /** Delivery pattern */
  pattern: SwitchboardPattern
  /** Sender address */
  from: SwitchboardAddress
  /** Recipient address (null for events — routed by topic) */
  to: SwitchboardAddress | null
  /** Links a reply to its originating call */
  correlationId: string | null
  /** Event topic for pub/sub routing */
  topic: string | null
  /** Application-level message type (e.g. 'poke', 'decision_request') */
  type: string
  /** JSON-encoded payload */
  payload: string
  /** Lifecycle status */
  status: SwitchboardMessageStatus
  /** When the message was created */
  createdAt: string
  /** When the message was delivered */
  deliveredAt: string | null
  /** Time-to-live in seconds (null = no expiry) */
  ttlSeconds: number | null
  /** Number of delivery attempts */
  retries: number
}

// =============================================================================
// Subscription (pub/sub)
// =============================================================================

/**
 * A topic subscription for pub/sub event routing.
 *
 * When an event message is published to a topic, all active subscribers
 * receive a copy of the message.
 */
export interface SwitchboardSubscription {
  /** Unique subscription ID */
  id: string
  /** The topic pattern to subscribe to */
  topic: string
  /** The subscriber's address */
  subscriber: SwitchboardAddress
  /** When the subscription was created */
  createdAt: string
  /** Whether the subscription is active */
  active: boolean
}

// =============================================================================
// Cursor (consumer read position)
// =============================================================================

/**
 * A consumer cursor tracking the last-read position in the message queue.
 *
 * Each consumer (identified by address) maintains a cursor so it can
 * poll for new messages without re-processing old ones.
 */
export interface SwitchboardCursor {
  /** The consumer's address key (kind:id) */
  consumerId: string
  /** The rowid of the last message read */
  lastRowId: number
  /** When the cursor was last updated */
  updatedAt: string
}

// =============================================================================
// Database Row Types (snake_case — match SQLite columns)
// =============================================================================

export interface MessageRow {
  rowid: number
  id: string
  pattern: string
  from_kind: string
  from_id: string
  from_container_id: string | null
  to_kind: string | null
  to_id: string | null
  to_container_id: string | null
  correlation_id: string | null
  topic: string | null
  type: string
  payload: string
  status: string
  created_at: string
  delivered_at: string | null
  ttl_seconds: number | null
  retries: number
}

export interface SubscriptionRow {
  id: string
  topic: string
  subscriber_kind: string
  subscriber_id: string
  subscriber_container_id: string | null
  created_at: string
  active: number
}

export interface CursorRow {
  consumer_id: string
  last_rowid: number
  updated_at: string
}

// =============================================================================
// Row → Record Converters
// =============================================================================

export function rowToMessage(row: MessageRow): SwitchboardMessage {
  return {
    id: row.id,
    pattern: row.pattern as SwitchboardPattern,
    from: {
      kind: row.from_kind as SwitchboardAddressKind,
      id: row.from_id,
      containerId: row.from_container_id || undefined,
    },
    to: row.to_kind ? {
      kind: row.to_kind as SwitchboardAddressKind,
      id: row.to_id!,
      containerId: row.to_container_id || undefined,
    } : null,
    correlationId: row.correlation_id,
    topic: row.topic,
    type: row.type,
    payload: row.payload,
    status: row.status as SwitchboardMessageStatus,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    ttlSeconds: row.ttl_seconds,
    retries: row.retries,
  }
}

export function rowToSubscription(row: SubscriptionRow): SwitchboardSubscription {
  return {
    id: row.id,
    topic: row.topic,
    subscriber: {
      kind: row.subscriber_kind as SwitchboardAddressKind,
      id: row.subscriber_id,
      containerId: row.subscriber_container_id || undefined,
    },
    createdAt: row.created_at,
    active: row.active === 1,
  }
}

export function rowToCursor(row: CursorRow): SwitchboardCursor {
  return {
    consumerId: row.consumer_id,
    lastRowId: row.last_rowid,
    updatedAt: row.updated_at,
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Serialize a SwitchboardAddress to a stable string key. */
export function addressKey(addr: SwitchboardAddress): string {
  return `${addr.kind}:${addr.id}`
}

/** Default TTL values by pattern (in seconds). */
export const DEFAULT_TTL: Record<SwitchboardPattern, number | null> = {
  cast: 3600,       // 1 hour
  call: 30,         // 30 seconds
  reply: 300,       // 5 minutes (generous for caller to pick up)
  event: 86400,     // 24 hours
}

/** Options for creating a new message. */
export interface SendMessageOptions {
  from: SwitchboardAddress
  to?: SwitchboardAddress
  type: string
  payload: unknown
  topic?: string
  correlationId?: string
  ttlSeconds?: number
}

/** Options for call() — request/reply with timeout. */
export interface CallOptions extends SendMessageOptions {
  timeoutMs?: number
}

/** Result of a call() — the reply message or a timeout. */
export interface CallResult {
  success: boolean
  reply: SwitchboardMessage | null
  timedOut: boolean
}
