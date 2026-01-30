/**
 * PostHog Analytics Client
 *
 * Wrapper around the PostHog SDK with:
 * - Lazy initialization (only when analytics is enabled)
 * - Offline queue fallback for network failures
 * - Graceful error handling that never blocks the CLI
 */

import { PostHog } from 'posthog-node'
import Database from 'better-sqlite3'
import { AnalyticsEventType, CommandEventProperties, WorkEventProperties, FeatureEventProperties } from './types.js'
import { isAnalyticsEnabled, getWorkspaceUUID } from './config.js'
import { queueEvent, getQueuedEvents, removeEvents, purgeOldEvents } from './queue.js'

// PostHog project API key (public, safe to commit)
// This is the write-only key for event ingestion
const POSTHOG_API_KEY = 'phc_proletariat_cli_analytics'
const POSTHOG_HOST = 'https://us.i.posthog.com'

// Batch size for flushing queued events
const BATCH_SIZE = 50

// Singleton PostHog client instance
let posthogClient: PostHog | null = null
let isInitialized = false

/**
 * Get or create the PostHog client instance
 * Returns null if analytics is disabled
 */
function getClient(db: Database.Database): PostHog | null {
  if (!isAnalyticsEnabled(db)) {
    return null
  }

  if (!isInitialized) {
    try {
      posthogClient = new PostHog(POSTHOG_API_KEY, {
        host: POSTHOG_HOST,
        // Disable automatic flushing - we control when to flush
        flushAt: 1,
        flushInterval: 0,
      })
      isInitialized = true
    } catch {
      // Failed to initialize - analytics will be disabled
      posthogClient = null
      isInitialized = true
    }
  }

  return posthogClient
}

/**
 * Track an analytics event
 *
 * Events are sent immediately if online, or queued for later if offline.
 * This function never throws - failures are silently handled.
 */
export async function trackEvent(
  db: Database.Database,
  event: AnalyticsEventType,
  properties: CommandEventProperties | WorkEventProperties | FeatureEventProperties | Record<string, string | number | boolean | null>
): Promise<void> {
  // Check if analytics is enabled
  if (!isAnalyticsEnabled(db)) {
    return
  }

  const workspaceId = getWorkspaceUUID(db)
  const timestamp = Date.now()

  // Add common properties
  const enrichedProperties = {
    ...properties,
    timestamp,
    cli_version: process.env.npm_package_version || 'unknown',
  }

  const client = getClient(db)

  if (client) {
    try {
      // Try to send directly to PostHog
      client.capture({
        distinctId: workspaceId,
        event,
        properties: enrichedProperties,
      })

      // Flush immediately (non-blocking)
      // We don't await this - let it happen in the background
      client.flush().catch(() => {
        // If flush fails, queue the event for later
        queueEvent(db, event, enrichedProperties)
      })
    } catch {
      // Network error - queue for later
      queueEvent(db, event, enrichedProperties)
    }
  } else {
    // No client available - queue the event
    queueEvent(db, event, enrichedProperties)
  }
}

/**
 * Track a command execution event
 */
export async function trackCommand(
  db: Database.Database,
  command: string,
  success: boolean,
  options: {
    durationMs?: number
    exitCode?: number
    errorCode?: string
  } = {}
): Promise<void> {
  const eventType: AnalyticsEventType = success ? 'command.completed' : 'command.failed'

  const properties: CommandEventProperties = {
    command,
    success,
    ...(options.durationMs !== undefined && { duration_ms: options.durationMs }),
    ...(options.exitCode !== undefined && { exit_code: options.exitCode }),
    ...(options.errorCode !== undefined && { error_code: options.errorCode }),
  }

  await trackEvent(db, eventType, properties)
}

/**
 * Track a work lifecycle event
 */
export async function trackWork(
  db: Database.Database,
  eventType: 'work.started' | 'work.completed' | 'work.failed' | 'work.stopped',
  properties: WorkEventProperties
): Promise<void> {
  await trackEvent(db, eventType, properties)
}

/**
 * Track feature usage
 */
export async function trackFeature(
  db: Database.Database,
  feature: string,
  category?: string
): Promise<void> {
  const properties: FeatureEventProperties = {
    feature,
    ...(category && { category }),
  }

  await trackEvent(db, 'feature.used', properties)
}

/**
 * Flush queued events to PostHog
 *
 * Call this on successful command completion to send any queued events.
 * Returns the number of events successfully sent.
 */
export async function flushQueue(db: Database.Database): Promise<number> {
  // Check if analytics is enabled
  if (!isAnalyticsEnabled(db)) {
    return 0
  }

  // First, purge old events (older than 7 days)
  purgeOldEvents(db)

  const client = getClient(db)
  if (!client) {
    return 0
  }

  const workspaceId = getWorkspaceUUID(db)
  const events = getQueuedEvents(db, BATCH_SIZE)

  if (events.length === 0) {
    return 0
  }

  const successfulIds: string[] = []

  for (const queuedEvent of events) {
    try {
      const properties = JSON.parse(queuedEvent.properties)

      client.capture({
        distinctId: workspaceId,
        event: queuedEvent.event,
        properties,
        timestamp: new Date(queuedEvent.created_at),
      })

      successfulIds.push(queuedEvent.id)
    } catch {
      // Skip malformed events
      successfulIds.push(queuedEvent.id) // Remove them anyway
    }
  }

  // Try to flush to PostHog
  try {
    await client.flush()
    // Success - remove sent events from queue
    removeEvents(db, successfulIds)
    return successfulIds.length
  } catch {
    // Flush failed - keep events in queue for next time
    return 0
  }
}

/**
 * Shutdown the analytics client
 *
 * Call this when the CLI is exiting to ensure all events are flushed.
 */
export async function shutdown(): Promise<void> {
  if (posthogClient) {
    try {
      await posthogClient.shutdown()
    } catch {
      // Ignore shutdown errors
    }
    posthogClient = null
    isInitialized = false
  }
}
