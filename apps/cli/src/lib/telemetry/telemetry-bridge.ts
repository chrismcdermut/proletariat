/**
 * Telemetry Bridge — Subscribes to EventBus events and fires PostHog tracking calls.
 *
 * Centralizes instrumentation so individual commands/providers don't need to
 * import and call tracking functions directly. The bridge listens to typed
 * runtime events and translates them into PostHog telemetry events.
 *
 * Privacy rules:
 * - DO track: command names, action types, provider names, durations, success/failure, environment type
 * - DO NOT track: ticket descriptions, code content, file paths, API keys, branch names, usernames, ticket IDs
 */

import { getEventBus } from '../events/event-bus.js'
import {
  trackAgentCompleted,
  trackAgentErrored,
  _trackTicketOperation,
  trackPrimitiveExecuted,
} from './analytics.js'

// Track agent spawn times by sessionId for duration calculation
const agentSpawnTimes = new Map<string, { timestamp: Date; action: string }>()

// Track primitive start times by command ID
const primitiveStartTimes = new Map<string, { timestamp: Date; primitive: string }>()

let unsubscribers: Array<() => void> = []

/**
 * Start the telemetry bridge — subscribe to EventBus events and track them.
 * Safe to call multiple times; subsequent calls are no-ops.
 */
export function startTelemetryBridge(): void {
  if (unsubscribers.length > 0) return

  const bus = getEventBus()

  // ── Agent Lifecycle ─────────────────────────────────────────────────────

  // Track agent spawn time for duration calculation on completion
  unsubscribers.push(
    bus.on('agent:spawned', (event) => {
      agentSpawnTimes.set(event.sessionId, {
        timestamp: event.timestamp,
        action: 'unknown', // Will be enriched by work:started if available
      })
    }),
  )

  // Track agent completion
  unsubscribers.push(
    bus.on('agent:stopped', (event) => {
      const spawnInfo = agentSpawnTimes.get(event.sessionId)
      const durationMs = spawnInfo
        ? event.timestamp.getTime() - spawnInfo.timestamp.getTime()
        : 0

      // Map event reason ('manual' | 'completed' | 'error') to telemetry exit reasons
      if (event.reason === 'error') {
        trackAgentErrored({
          action: spawnInfo?.action ?? 'unknown',
          durationMs,
          exitReason: 'errored',
        })
      } else {
        trackAgentCompleted({
          action: spawnInfo?.action ?? 'unknown',
          durationMs,
          exitReason: event.reason === 'manual' ? 'stopped' : event.reason,
          prCreated: false,
        })
      }

      agentSpawnTimes.delete(event.sessionId)
    }),
  )

  // Track agent errors
  unsubscribers.push(
    bus.on('agent:error', (event) => {
      const spawnInfo = agentSpawnTimes.get(event.sessionId)
      const durationMs = spawnInfo
        ? event.timestamp.getTime() - spawnInfo.timestamp.getTime()
        : 0

      trackAgentErrored({
        action: spawnInfo?.action ?? 'unknown',
        durationMs,
        exitReason: 'errored',
        errorType: classifyError(event.error),
      })

      agentSpawnTimes.delete(event.sessionId)
    }),
  )
}

/**
 * Stop the telemetry bridge and clean up subscriptions.
 */
export function stopTelemetryBridge(): void {
  for (const unsub of unsubscribers) {
    unsub()
  }
  unsubscribers = []
  agentSpawnTimes.clear()
  primitiveStartTimes.clear()
}

/**
 * Record the start of a work primitive for duration tracking.
 * Call this at the beginning of a primitive command, then call
 * `endPrimitiveTracking()` when it completes.
 */
export function beginPrimitiveTracking(id: string, primitive: string): void {
  primitiveStartTimes.set(id, { timestamp: new Date(), primitive })
}

/**
 * Record the completion of a work primitive and fire the tracking event.
 */
export function endPrimitiveTracking(id: string, success: boolean, errorType?: string): void {
  const startInfo = primitiveStartTimes.get(id)
  if (!startInfo) return

  const durationMs = Date.now() - startInfo.timestamp.getTime()
  trackPrimitiveExecuted({
    primitive: startInfo.primitive,
    durationMs,
    success,
    errorType,
  })

  primitiveStartTimes.delete(id)
}

/**
 * Enrich an agent session with its action name (called from work:start).
 * This lets agent_completed/agent_errored events report the correct action.
 */
export function enrichAgentSession(sessionId: string, action: string): void {
  const existing = agentSpawnTimes.get(sessionId)
  if (existing) {
    existing.action = action
  }
}

/**
 * Classify an error message into a safe, non-PII error type.
 * Only returns generic categories — never includes the original message.
 */
function classifyError(errorMessage: string): string {
  const lower = errorMessage.toLowerCase()
  if (lower.includes('timeout')) return 'timeout'
  if (lower.includes('docker') || lower.includes('container')) return 'container'
  if (lower.includes('permission') || lower.includes('denied')) return 'permission'
  if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('fetch')) return 'network'
  if (lower.includes('spawn') || lower.includes('enoent')) return 'spawn_failure'
  if (lower.includes('oom') || lower.includes('memory')) return 'memory'
  return 'unknown'
}
