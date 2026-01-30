/**
 * Analytics Module - Privacy-First Usage Analytics
 *
 * Integrates PostHog for command usage analytics to understand feature adoption.
 * Key principles:
 * - Opt-in only (disabled by default)
 * - Anonymous identification (UUID per workspace, no PII)
 * - Offline-first with local SQLite queue
 * - Never blocks CLI operations
 */

import { PostHog } from 'posthog-node'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

// PostHog configuration
const POSTHOG_API_KEY = 'phc_placeholder_key' // Replace with actual key in production
const POSTHOG_HOST = 'https://us.i.posthog.com'

// Queue configuration
const QUEUE_TABLE = 'analytics_queue'
const MAX_QUEUE_AGE_DAYS = 7
const BATCH_SIZE = 50

// =============================================================================
// Types
// =============================================================================

/**
 * Analytics event types
 */
export type AnalyticsEventType =
  | 'command.executed'
  | 'command.failed'
  | 'execution.started'
  | 'execution.completed'
  | 'execution.failed'
  | 'feature.used'

/**
 * Base analytics event
 */
export interface AnalyticsEvent {
  /** Event type identifier */
  event: AnalyticsEventType
  /** Anonymous workspace identifier */
  distinctId: string
  /** Event properties (no PII) */
  properties: Record<string, string | number | boolean | null>
  /** Timestamp when event occurred */
  timestamp: string
}

/**
 * Command execution event properties
 */
export interface CommandEventProperties {
  /** Command name (e.g., 'work start', 'ticket create') */
  command: string
  /** Execution duration in milliseconds */
  duration_ms?: number
  /** Whether command succeeded */
  success: boolean
  /** Error code if failed (no messages/stack traces) */
  error_code?: string
  /** CLI version */
  cli_version: string
  /** Execution environment (host/devcontainer/docker) */
  environment?: string
}

/**
 * Work execution event properties
 */
export interface ExecutionEventProperties {
  /** Execution mode (terminal/background) */
  mode?: string
  /** Executor type (claude-code/aider/codex) */
  executor?: string
  /** Exit status */
  exit_status?: 'completed' | 'failed' | 'stopped'
  /** Duration in seconds */
  duration_seconds?: number
  /** CLI version */
  cli_version: string
}

/**
 * Feature usage event properties
 */
export interface FeatureEventProperties {
  /** Feature name */
  feature: string
  /** Feature variant if applicable */
  variant?: string
  /** CLI version */
  cli_version: string
}

/**
 * Analytics configuration stored in workspace_settings
 */
export interface AnalyticsConfig {
  /** Whether analytics is enabled (opted-in) */
  enabled: boolean
  /** Anonymous workspace identifier */
  workspaceId: string | null
  /** ISO timestamp when consent was given */
  consentDate: string | null
}

/**
 * Queued event stored in SQLite
 */
interface QueuedEvent {
  id: number
  event_type: string
  distinct_id: string
  properties: string // JSON serialized
  timestamp: string
  created_at: string
}

// =============================================================================
// Analytics Settings (workspace_settings table)
// =============================================================================

const ANALYTICS_KEYS = {
  enabled: 'analytics.enabled',
  workspaceId: 'analytics.workspace_id',
  consentDate: 'analytics.consent_date',
}

/**
 * Get analytics setting from database
 */
function getAnalyticsSetting(db: Database.Database, key: string): string | null {
  const row = db
    .prepare('SELECT value FROM workspace_settings WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

/**
 * Set analytics setting in database
 */
function setAnalyticsSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO workspace_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

/**
 * Check if analytics is enabled for this workspace
 */
export function isAnalyticsEnabled(db: Database.Database): boolean {
  const enabled = getAnalyticsSetting(db, ANALYTICS_KEYS.enabled)
  return enabled === 'true'
}

/**
 * Get full analytics configuration
 */
export function getAnalyticsConfig(db: Database.Database): AnalyticsConfig {
  return {
    enabled: getAnalyticsSetting(db, ANALYTICS_KEYS.enabled) === 'true',
    workspaceId: getAnalyticsSetting(db, ANALYTICS_KEYS.workspaceId),
    consentDate: getAnalyticsSetting(db, ANALYTICS_KEYS.consentDate),
  }
}

/**
 * Enable analytics with consent
 */
export function enableAnalytics(db: Database.Database): AnalyticsConfig {
  // Generate workspace UUID if not exists
  let workspaceId = getAnalyticsSetting(db, ANALYTICS_KEYS.workspaceId)
  if (!workspaceId) {
    workspaceId = randomUUID()
    setAnalyticsSetting(db, ANALYTICS_KEYS.workspaceId, workspaceId)
  }

  // Set enabled and consent date
  setAnalyticsSetting(db, ANALYTICS_KEYS.enabled, 'true')
  const consentDate = new Date().toISOString()
  setAnalyticsSetting(db, ANALYTICS_KEYS.consentDate, consentDate)

  // Ensure queue table exists
  ensureQueueTable(db)

  return {
    enabled: true,
    workspaceId,
    consentDate,
  }
}

/**
 * Disable analytics
 */
export function disableAnalytics(db: Database.Database): void {
  setAnalyticsSetting(db, ANALYTICS_KEYS.enabled, 'false')
  // Keep workspaceId and consentDate for audit trail
}

/**
 * Check if analytics preference has been set (user has made a choice)
 */
export function hasAnalyticsPreference(db: Database.Database): boolean {
  return getAnalyticsSetting(db, ANALYTICS_KEYS.enabled) !== null
}

/**
 * Get workspace UUID, creating if needed
 */
export function getOrCreateWorkspaceId(db: Database.Database): string {
  let workspaceId = getAnalyticsSetting(db, ANALYTICS_KEYS.workspaceId)
  if (!workspaceId) {
    workspaceId = randomUUID()
    setAnalyticsSetting(db, ANALYTICS_KEYS.workspaceId, workspaceId)
  }
  return workspaceId
}

// =============================================================================
// Queue Table Management
// =============================================================================

/**
 * SQL to create the analytics queue table
 */
export const ANALYTICS_QUEUE_SCHEMA = `
-- Analytics event queue for offline batching
CREATE TABLE IF NOT EXISTS ${QUEUE_TABLE} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  distinct_id TEXT NOT NULL,
  properties TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_queue_created ON ${QUEUE_TABLE}(created_at);
`

/**
 * Ensure queue table exists
 */
export function ensureQueueTable(db: Database.Database): void {
  db.exec(ANALYTICS_QUEUE_SCHEMA)
}

/**
 * Add event to queue
 */
function queueEvent(db: Database.Database, event: AnalyticsEvent): void {
  ensureQueueTable(db)
  db.prepare(`
    INSERT INTO ${QUEUE_TABLE} (event_type, distinct_id, properties, timestamp, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    event.event,
    event.distinctId,
    JSON.stringify(event.properties),
    event.timestamp,
    new Date().toISOString()
  )
}

/**
 * Get queued events (oldest first)
 */
function getQueuedEvents(db: Database.Database, limit: number = BATCH_SIZE): QueuedEvent[] {
  ensureQueueTable(db)
  return db.prepare(`
    SELECT * FROM ${QUEUE_TABLE}
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit) as QueuedEvent[]
}

/**
 * Delete events from queue by IDs
 */
function deleteQueuedEvents(db: Database.Database, ids: number[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`DELETE FROM ${QUEUE_TABLE} WHERE id IN (${placeholders})`).run(...ids)
}

/**
 * Clean up old events (older than MAX_QUEUE_AGE_DAYS)
 */
export function cleanupOldEvents(db: Database.Database): number {
  ensureQueueTable(db)
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - MAX_QUEUE_AGE_DAYS)

  const result = db.prepare(`
    DELETE FROM ${QUEUE_TABLE}
    WHERE created_at < ?
  `).run(cutoffDate.toISOString())

  return result.changes
}

/**
 * Get queue size
 */
export function getQueueSize(db: Database.Database): number {
  ensureQueueTable(db)
  const row = db.prepare(`SELECT COUNT(*) as count FROM ${QUEUE_TABLE}`).get() as { count: number }
  return row.count
}

// =============================================================================
// PostHog Client Wrapper
// =============================================================================

let postHogClient: PostHog | null = null

/**
 * Get or create PostHog client (lazy initialization)
 * Only initializes if analytics is enabled
 */
function getPostHogClient(): PostHog {
  if (!postHogClient) {
    postHogClient = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      flushAt: 10, // Batch size before auto-flush
      flushInterval: 30000, // Flush every 30 seconds
      // Disable automatic capture - we only want explicit events
      disableGeoip: true,
    })
  }
  return postHogClient
}

/**
 * Shutdown PostHog client gracefully
 */
export async function shutdownAnalytics(): Promise<void> {
  if (postHogClient) {
    await postHogClient.shutdown()
    postHogClient = null
  }
}

// =============================================================================
// Event Tracking
// =============================================================================

/**
 * Track an analytics event
 * Queues locally first, then attempts to send
 * Never blocks or throws - fails silently
 */
export function trackEvent(
  db: Database.Database,
  event: AnalyticsEventType,
  properties: Record<string, string | number | boolean | null>
): void {
  try {
    // Check if analytics is enabled
    if (!isAnalyticsEnabled(db)) {
      return
    }

    const workspaceId = getOrCreateWorkspaceId(db)
    const analyticsEvent: AnalyticsEvent = {
      event,
      distinctId: workspaceId,
      properties,
      timestamp: new Date().toISOString(),
    }

    // Queue event locally first
    queueEvent(db, analyticsEvent)

    // Try to flush queue (non-blocking)
    flushQueue(db).catch(() => {
      // Silently ignore flush errors - events are safely queued
    })
  } catch {
    // Never throw from analytics - fail silently
  }
}

/**
 * Track command execution
 */
export function trackCommand(
  db: Database.Database,
  props: CommandEventProperties
): void {
  trackEvent(db, props.success ? 'command.executed' : 'command.failed', {
    command: props.command,
    duration_ms: props.duration_ms ?? null,
    success: props.success,
    error_code: props.error_code ?? null,
    cli_version: props.cli_version,
    environment: props.environment ?? null,
  })
}

/**
 * Track work execution lifecycle
 */
export function trackExecution(
  db: Database.Database,
  eventType: 'execution.started' | 'execution.completed' | 'execution.failed',
  props: ExecutionEventProperties
): void {
  trackEvent(db, eventType, {
    mode: props.mode ?? null,
    executor: props.executor ?? null,
    exit_status: props.exit_status ?? null,
    duration_seconds: props.duration_seconds ?? null,
    cli_version: props.cli_version,
  })
}

/**
 * Track feature usage
 */
export function trackFeature(
  db: Database.Database,
  props: FeatureEventProperties
): void {
  trackEvent(db, 'feature.used', {
    feature: props.feature,
    variant: props.variant ?? null,
    cli_version: props.cli_version,
  })
}

// =============================================================================
// Queue Flushing
// =============================================================================

/**
 * Flush queued events to PostHog
 * Returns number of events sent
 */
export async function flushQueue(db: Database.Database): Promise<number> {
  // Skip if analytics disabled
  if (!isAnalyticsEnabled(db)) {
    return 0
  }

  // Clean up old events first
  cleanupOldEvents(db)

  // Get queued events
  const events = getQueuedEvents(db, BATCH_SIZE)
  if (events.length === 0) {
    return 0
  }

  try {
    const client = getPostHogClient()
    const sentIds: number[] = []

    for (const queuedEvent of events) {
      try {
        const properties = JSON.parse(queuedEvent.properties)
        client.capture({
          distinctId: queuedEvent.distinct_id,
          event: queuedEvent.event_type,
          properties,
          timestamp: new Date(queuedEvent.timestamp),
        })
        sentIds.push(queuedEvent.id)
      } catch {
        // Skip malformed events
        sentIds.push(queuedEvent.id)
      }
    }

    // Flush to PostHog
    await client.flush()

    // Remove sent events from queue
    deleteQueuedEvents(db, sentIds)

    return sentIds.length
  } catch {
    // Network error - events remain in queue for next attempt
    return 0
  }
}

// =============================================================================
// Data Collection Documentation
// =============================================================================

/**
 * Get human-readable description of collected data
 */
export function getCollectedDataDescription(): string {
  return `
Proletariat Analytics - What We Collect
=======================================

When you opt-in to analytics, we collect anonymous usage data to improve
the tool. Here's exactly what we track:

WHAT WE COLLECT:
----------------
- Command names (e.g., "work start", "ticket create")
- Command success/failure status
- Command execution duration (milliseconds)
- Execution environment (host/devcontainer/docker)
- Feature usage (which features are being used)
- CLI version

WHAT WE NEVER COLLECT:
----------------------
- Your code or file contents
- File paths or directory names
- Git repository URLs or names
- Ticket titles, descriptions, or content
- Agent names or custom configurations
- IP addresses (disabled at collection)
- Usernames, emails, or any PII

IDENTIFICATION:
---------------
- We generate a random UUID per workspace
- This UUID is not linked to any personal information
- It's used only to understand usage patterns across sessions

DATA STORAGE:
-------------
- Events are queued locally in SQLite
- Sent to PostHog (privacy-focused analytics)
- Events older than 7 days are automatically deleted
- You can disable analytics at any time

HOW TO MANAGE:
--------------
- View status:    prlt config analytics
- Enable:         prlt config analytics --enable
- Disable:        prlt config analytics --disable
- See this info:  prlt config analytics --show
`.trim()
}
