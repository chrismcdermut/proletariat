/**
 * Analytics Types
 *
 * Type definitions for the analytics module.
 */

/**
 * Analytics event types tracked by the CLI
 */
export type AnalyticsEventType =
  // Command execution events
  | 'command.started'
  | 'command.completed'
  | 'command.failed'
  // Work lifecycle events
  | 'work.started'
  | 'work.completed'
  | 'work.failed'
  | 'work.stopped'
  // Feature adoption events
  | 'feature.used'

/**
 * Base analytics event structure
 */
export interface AnalyticsEvent {
  /** Event type */
  event: AnalyticsEventType
  /** Timestamp when event occurred */
  timestamp: number
  /** Additional event properties (no PII) */
  properties: Record<string, string | number | boolean | null>
}

/**
 * Command execution event properties
 */
export interface CommandEventProperties {
  /** Command name (e.g., 'ticket create') */
  command: string
  /** Duration in milliseconds */
  duration_ms?: number
  /** Whether command succeeded */
  success: boolean
  /** Exit code if applicable */
  exit_code?: number
  /** Error code if failed */
  error_code?: string
}

/**
 * Work lifecycle event properties
 */
export interface WorkEventProperties {
  /** Executor type (claude-code, aider, etc.) */
  executor: string
  /** Execution environment (host, docker, devcontainer, vm) */
  environment: string
  /** Display mode (terminal, background) */
  display_mode: string
  /** Duration in milliseconds (for completed events) */
  duration_ms?: number
  /** Exit code if applicable */
  exit_code?: number
  /** Whether sandboxed mode was used */
  sandboxed: boolean
}

/**
 * Feature usage event properties
 */
export interface FeatureEventProperties {
  /** Feature name */
  feature: string
  /** Feature category */
  category?: string
}

/**
 * Analytics configuration stored in workspace_settings
 */
export interface AnalyticsConfig {
  /** Whether analytics is enabled (opt-in) */
  enabled: boolean
  /** Anonymous workspace UUID */
  workspaceId: string
  /** Date when consent was given (ISO string) */
  consentDate: string | null
}

/**
 * Queued event for offline storage
 */
export interface QueuedEvent {
  /** Queue entry ID */
  id: string
  /** Event type */
  event: string
  /** Event properties as JSON string */
  properties: string
  /** Timestamp when event was created */
  created_at: number
}

/**
 * Analytics settings keys stored in workspace_settings table
 */
export const ANALYTICS_SETTINGS_KEYS = {
  enabled: 'analytics.enabled',
  workspaceId: 'analytics.workspace_id',
  consentDate: 'analytics.consent_date',
} as const
