/**
 * Analytics Module
 *
 * Privacy-first usage analytics for understanding feature adoption.
 *
 * Key principles:
 * - Opt-in only (disabled by default)
 * - Anonymous identification (UUID per workspace, no PII)
 * - Local-first batching (SQLite queue for offline support)
 * - Never blocks the CLI
 *
 * What we track:
 * - Command execution (name, duration, success/failure)
 * - Work lifecycle (executor, environment, mode, exit status)
 * - Feature adoption (which features are used)
 *
 * What we DON'T track:
 * - Usernames, emails, or any personal information
 * - File paths or content
 * - Ticket titles, descriptions, or any project content
 * - IP addresses (PostHog is configured to anonymize)
 */

// Re-export types
export * from './types.js'

// Re-export config functions
export {
  isAnalyticsEnabled,
  getWorkspaceUUID,
  getAnalyticsConfig,
  enableAnalytics,
  disableAnalytics,
  hasAnalyticsPreference,
  getConsentDate,
  promptAnalyticsPreference,
} from './config.js'

// Re-export queue functions
export {
  queueEvent,
  getQueuedEvents,
  getQueueCount,
  removeEvents,
  clearQueue,
  purgeOldEvents,
  getQueueStats,
} from './queue.js'

// Re-export client functions
export {
  trackEvent,
  trackCommand,
  trackWork,
  trackFeature,
  flushQueue,
  shutdown,
} from './client.js'
