/**
 * Notification Layer Types
 *
 * Defines the shape of notification providers, rules, and dispatch results.
 * Providers are configured channels (Slack, Email, SMS, Terminal, Browser Push).
 * Rules map events to providers, with optional escalation chains.
 */

import type { HookableEvent } from '../work-lifecycle/hooks/types.js'
import type { OrchestrateEvent } from '../orchestrate/types.js'

// =============================================================================
// Provider Types
// =============================================================================

/** Supported notification channel types. */
export type NotificationProviderType = 'slack' | 'email' | 'sms' | 'terminal' | 'browser_push'

/** All valid provider types. */
export const NOTIFICATION_PROVIDER_TYPES: NotificationProviderType[] = [
  'slack',
  'email',
  'sms',
  'terminal',
  'browser_push',
]

/** Slack provider configuration. */
export interface SlackProviderConfig {
  webhook_url: string
  channel?: string
  username?: string
}

/** Email provider configuration (SendGrid or SES). */
export interface EmailProviderConfig {
  provider: 'sendgrid' | 'ses'
  api_key: string
  from: string
  to: string[]
}

/** SMS provider configuration (Twilio). */
export interface SmsProviderConfig {
  account_sid: string
  auth_token: string
  from: string
  to: string[]
}

/** Terminal provider configuration (no external config needed). */
export interface TerminalProviderConfig {
  prefix?: string
}

/** Browser push provider configuration (placeholder for prlt web). */
export interface BrowserPushProviderConfig {
  endpoint?: string
}

/** Union of all provider config shapes. */
export type ProviderConfig =
  | SlackProviderConfig
  | EmailProviderConfig
  | SmsProviderConfig
  | TerminalProviderConfig
  | BrowserPushProviderConfig

// =============================================================================
// Provider Model
// =============================================================================

/** Persisted notification provider configuration. */
export interface NotificationProvider {
  id: string
  type: NotificationProviderType
  name: string
  config: ProviderConfig
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** Database row shape for notification_providers (snake_case). */
export interface NotificationProviderRow {
  id: string
  type: string
  name: string
  config: string
  enabled: number
  created_at: string
  updated_at: string
}

// =============================================================================
// Rule Model
// =============================================================================

/** Notification event — same set as hookable + orchestrate events. */
export type NotificationEvent = HookableEvent | OrchestrateEvent

/** Persisted notification rule — maps an event to a provider. */
export interface NotificationRule {
  id: string
  event: NotificationEvent
  providerId: string
  priority: number
  /** Delay in seconds before sending (for escalation chains). null = immediate. */
  escalationDelaySeconds: number | null
  /** Group ID for escalation chains. Rules in the same group escalate sequentially. */
  escalationGroup: string | null
  enabled: boolean
  createdAt: string
}

/** Database row shape for notification_rules (snake_case). */
export interface NotificationRuleRow {
  id: string
  event: string
  provider_id: string
  priority: number
  escalation_delay_seconds: number | null
  escalation_group: string | null
  enabled: number
  created_at: string
}

// =============================================================================
// Dispatch Results
// =============================================================================

/** Result of sending a single notification. */
export interface NotificationResult {
  providerId: string
  providerName: string
  providerType: NotificationProviderType
  success: boolean
  error?: string
  durationMs: number
}

/** Context passed to notification handlers. */
export interface NotificationContext {
  event: string
  ticket?: string
  pr?: number
  branch?: string
  agent?: string
  container?: string
  message?: string
  [key: string]: unknown
}

// =============================================================================
// Escalation Chain
// =============================================================================

/** A resolved escalation step with timing. */
export interface EscalationStep {
  rule: NotificationRule
  provider: NotificationProvider
  delaySeconds: number
}

/** An active escalation chain being tracked. */
export interface ActiveEscalation {
  group: string
  event: string
  context: NotificationContext
  steps: EscalationStep[]
  currentStep: number
  startedAt: number
  timerId?: ReturnType<typeof setTimeout>
  acknowledged: boolean
}
