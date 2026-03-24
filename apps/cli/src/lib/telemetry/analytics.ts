/**
 * Product Analytics (PostHog) & Event Tracking
 *
 * Provides anonymous usage analytics for the CLI using PostHog.
 * All data is anonymous — identified by a machine UUID only, no PII is ever sent.
 *
 * Telemetry can be disabled via:
 * - `prlt telemetry disable`
 * - `DO_NOT_TRACK=1` environment variable
 * - `PRLT_TELEMETRY_DISABLED=1` environment variable
 *
 * Privacy:
 * - Anonymous machine ID (UUID) stored in ~/.proletariat/telemetry.json
 * - No file paths, usernames, or ticket content ever sent
 * - Events are written to a local queue file and flushed on the next run
 *
 * Write-ahead log:
 * - trackEvent() writes events to ~/.proletariat/telemetry-queue.json synchronously
 * - On the next command run, queued events are flushed to PostHog and the queue is cleared
 * - Events are delayed by at most one command invocation — acceptable for analytics
 * - This adds zero latency and ensures no events are lost regardless of backend init timing
 * - Shutdown never flushes the queue — events persist until the next run confirms delivery
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { getMachineConfigDir, ensureMachineConfigDir } from '../machine-config.js'

// PostHog API key (public — PostHog client keys are meant to be public)
const POSTHOG_API_KEY = 'phc_ihCp4i3ZWlk2KQxFbcE6odylZGtISEaCNKAVklMwAkV'

// Cap the queue size to prevent unbounded growth if events never flush
const MAX_QUEUE_SIZE = 1000

/**
 * Telemetry configuration stored in ~/.proletariat/telemetry.json
 */
interface TelemetryConfig {
  /** Whether telemetry is enabled (default: true) */
  enabled: boolean
  /** Whether the first-run notice has been shown */
  noticeShown: boolean
  /** Anonymous machine ID (UUID v4) */
  machineId: string
  /** When telemetry was first initialized */
  createdAt: string
  /** When the enabled status was last changed */
  updatedAt: string
}

/**
 * Minimal interface for the PostHog client instance methods we use.
 */
interface PostHogClientInstance {
  capture(message: { distinctId: string; event: string; properties?: Record<string, unknown> }): void
  shutdown(shutdownTimeoutMs?: number): void
}

/**
 * A queued telemetry event persisted to disk.
 */
interface QueuedEvent {
  name: string
  value?: string | number | null
  metadata?: Record<string, string> | null
  timestamp: string
}

// Module-level state
let posthogClient: PostHogClientInstance | null = null
let telemetryConfig: TelemetryConfig | null = null
let cliVersion: string | null = null
let initPromise: Promise<void> | null = null
let analyticsShutdown = false

// ─── Telemetry Config ────────────────────────────────────────────────────────

function getTelemetryConfigPath(): string {
  return path.join(getMachineConfigDir(), 'telemetry.json')
}

function readTelemetryConfig(): TelemetryConfig {
  if (telemetryConfig) return telemetryConfig

  const configPath = getTelemetryConfigPath()

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8')
      telemetryConfig = JSON.parse(content) as TelemetryConfig
      return telemetryConfig
    } catch {
      // Fall through to create new config
    }
  }

  // Use inherited machine ID from host (Docker containers), or generate a new one
  const machineId = process.env.PRLT_TELEMETRY_MACHINE_ID || crypto.randomUUID()

  telemetryConfig = {
    enabled: true,
    noticeShown: false,
    machineId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  writeTelemetryConfig(telemetryConfig)
  return telemetryConfig
}

function writeTelemetryConfig(config: TelemetryConfig): void {
  ensureMachineConfigDir()
  const configPath = getTelemetryConfigPath()
  const tempPath = `${configPath}.tmp.${process.pid}`

  try {
    fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf-8')
    fs.renameSync(tempPath, configPath)
  } catch {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ─── Opt-out Detection ───────────────────────────────────────────────────────

/**
 * Check if telemetry is disabled by environment variables or config.
 */
export function isTelemetryEnabled(): boolean {
  // Environment variable opt-outs (standard + prlt-specific)
  if (process.env.DO_NOT_TRACK === '1' || process.env.DO_NOT_TRACK === 'true') return false
  if (process.env.PRLT_TELEMETRY_DISABLED === '1' || process.env.PRLT_TELEMETRY_DISABLED === 'true') return false

  // Config-based opt-out
  const config = readTelemetryConfig()
  return config.enabled
}

/**
 * Enable telemetry.
 */
export function enableTelemetry(): void {
  const config = readTelemetryConfig()
  config.enabled = true
  config.updatedAt = new Date().toISOString()
  telemetryConfig = config
  writeTelemetryConfig(config)
}

/**
 * Disable telemetry.
 */
export function disableTelemetry(): void {
  const config = readTelemetryConfig()
  config.enabled = false
  config.updatedAt = new Date().toISOString()
  telemetryConfig = config
  writeTelemetryConfig(config)
}

/**
 * Get current telemetry status for display.
 */
export function getTelemetryStatus(): {
  enabled: boolean
  machineId: string
  envOverride: boolean
  envVar?: string
} {
  const config = readTelemetryConfig()

  // Check for env var overrides
  if (process.env.DO_NOT_TRACK === '1' || process.env.DO_NOT_TRACK === 'true') {
    return { enabled: false, machineId: config.machineId, envOverride: true, envVar: 'DO_NOT_TRACK' }
  }
  if (process.env.PRLT_TELEMETRY_DISABLED === '1' || process.env.PRLT_TELEMETRY_DISABLED === 'true') {
    return { enabled: false, machineId: config.machineId, envOverride: true, envVar: 'PRLT_TELEMETRY_DISABLED' }
  }

  return { enabled: config.enabled, machineId: config.machineId, envOverride: false }
}

// ─── First-Run Notice ────────────────────────────────────────────────────────

/**
 * Show a one-time notice that telemetry is active.
 * Only shown in interactive TTY sessions.
 */
function showTelemetryNotice(): void {
  const config = readTelemetryConfig()
  if (config.noticeShown) return
  if (!process.stdout.isTTY) {
    // Mark as shown so we don't try again, but don't print in non-TTY
    config.noticeShown = true
    writeTelemetryConfig(config)
    return
  }

  console.log('')
  console.log('Proletariat collects anonymous usage analytics to improve the CLI.')
  console.log('Only command names and durations are tracked — no values, arguments, or personal data.')
  console.log('You can opt out at any time:')
  console.log('')
  console.log('  prlt telemetry disable')
  console.log('')

  config.noticeShown = true
  telemetryConfig = config
  writeTelemetryConfig(config)
}

// ─── Machine ID ──────────────────────────────────────────────────────────────

/**
 * Get the anonymous machine ID for this installation.
 */
export function getMachineId(): string {
  return readTelemetryConfig().machineId
}

// ─── Event Queue (Write-Ahead Log) ───────────────────────────────────────────

function getQueuePath(): string {
  return path.join(getMachineConfigDir(), 'telemetry-queue.json')
}

/**
 * Append an event to the on-disk queue. Synchronous — adds zero async latency.
 */
function writeEventToQueue(event: QueuedEvent): void {
  try {
    ensureMachineConfigDir()
    const queuePath = getQueuePath()
    let queue: QueuedEvent[] = []

    if (fs.existsSync(queuePath)) {
      try {
        const raw = fs.readFileSync(queuePath, 'utf-8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) queue = parsed
      } catch {
        // Corrupted file — start fresh
      }
    }

    queue.push(event)

    // Cap queue size to prevent unbounded growth
    if (queue.length > MAX_QUEUE_SIZE) {
      queue = queue.slice(queue.length - MAX_QUEUE_SIZE)
    }

    // Atomic write via temp file + rename
    const tempPath = `${queuePath}.tmp.${process.pid}`
    fs.writeFileSync(tempPath, JSON.stringify(queue), 'utf-8')
    fs.renameSync(tempPath, queuePath)
  } catch {
    // Never let queue errors affect the CLI
  }
}

/**
 * Atomically read and clear the queue file.
 * Uses rename to claim the file so concurrent processes don't double-send.
 */
function readAndClearQueue(): QueuedEvent[] {
  const queuePath = getQueuePath()
  const claimPath = `${queuePath}.flush.${process.pid}`

  try {
    // Atomic rename — only one process can claim the file
    fs.renameSync(queuePath, claimPath)
  } catch {
    // File doesn't exist or another process already claimed it
    return []
  }

  try {
    const raw = fs.readFileSync(claimPath, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  } finally {
    try { fs.unlinkSync(claimPath) } catch { /* claimed file cleanup is best-effort — another process may have removed it */ }
  }
}

/**
 * Flush queued events to PostHog. Requires an initialized PostHog client.
 * Called during shutdown or at the start of the next command run.
 */
export function flushQueuedEvents(): void {
  if (!posthogClient) return

  const events = readAndClearQueue()
  const machineId = getMachineId()
  for (const event of events) {
    try {
      posthogClient.capture({
        distinctId: machineId,
        event: event.name,
        properties: {
          ...event.metadata,
          ...(event.value != null ? { value: event.value } : {}),
          timestamp: event.timestamp,
        },
      })
    } catch {
      // Drop individual events silently
    }
  }
}

// ─── PostHog Client ──────────────────────────────────────────────────────────

/**
 * Initialize PostHog and flush any queued events from previous runs.
 * Called from the init hook. The PostHog init is fire-and-forget — event
 * tracking does not depend on it (events go to the disk queue instead).
 *
 * No-op if telemetry is disabled.
 */
export function initAnalytics(version: string): void {
  cliVersion = version

  if (!isTelemetryEnabled()) return

  showTelemetryNotice()

  // Start PostHog init in background — not needed for event logging,
  // but allows queue flush if init completes in time
  initPromise = (async () => {
    try {
      const { PostHog } = await import('posthog-node')
      const ph = new PostHog(POSTHOG_API_KEY, {
        flushAt: 20,
        flushInterval: 10000,
      })

      if (analyticsShutdown) {
        try { ph.shutdown() } catch { /* PostHog shutdown is best-effort — process is exiting anyway */ }
      } else {
        posthogClient = ph as unknown as PostHogClientInstance
      }
    } catch {
      // If PostHog can't initialize, fail silently
      posthogClient = null
    }

    // Backend is ready — flush any events queued from previous runs
    if (posthogClient && !analyticsShutdown) {
      flushQueuedEvents()
    }
  })()
}

// ─── Event Tracking ──────────────────────────────────────────────────────────

/**
 * Track an analytics event. Writes to a local disk queue synchronously —
 * never blocks on network I/O. Events are flushed to PostHog on the next
 * command run (or during this run's shutdown if PostHog initialized in time).
 *
 * @param eventName - Event name (e.g., 'command_run')
 * @param value - Optional numeric or string value
 * @param metadata - Event-specific metadata
 */
export function trackEvent(eventName: string, value?: string | number | null, metadata?: Record<string, unknown> | null): void {
  if (!isTelemetryEnabled()) return

  try {
    // Derive telemetry source context from environment
    const telemetrySource = process.env.PRLT_AGENT_NAME ? 'agent' : 'host'
    const runtimeEnvironment = process.env.PRLT_AGENT_NAME ? 'docker' : 'host'
    const sourceContext: Record<string, unknown> = {
      telemetry_source: telemetrySource,
      runtime_environment: runtimeEnvironment,
      ...(process.env.PRLT_AGENT_NAME ? { agent_name: process.env.PRLT_AGENT_NAME } : {}),
    }

    // Convert metadata values to strings as required by the client SDK
    // Source context merges first so caller metadata takes precedence on key collisions
    const stringMetadata: Record<string, string> | null = metadata
      ? Object.fromEntries(
          Object.entries({ ...sourceContext, ...metadata, cli_version: cliVersion }).map(([k, v]) => [k, String(v)]),
        )
      : Object.fromEntries(
          Object.entries({ ...sourceContext, ...(cliVersion ? { cli_version: cliVersion } : {}) }).map(([k, v]) => [k, String(v)]),
        )

    writeEventToQueue({
      name: eventName,
      value,
      metadata: stringMetadata,
      timestamp: new Date().toISOString(),
    })
  } catch {
    // Never let analytics errors affect the CLI
  }
}

/**
 * Track a command execution.
 */
export function trackCommandRun(options: {
  command: string
  durationMs: number
  success: boolean
  flags?: string[]
}): void {
  trackEvent('command_run', options.durationMs, {
    command: options.command,
    success: options.success,
    flags_used: (options.flags ?? []).join(','),
  })
}

/**
 * Track an agent being spawned.
 *
 * Privacy: No ticket IDs, branch names, or usernames.
 */
export function trackAgentSpawned(options: {
  executor: string
  environment: string
  action: string
  ephemeral: boolean
  provider?: string
}): void {
  trackEvent('agent_spawned', null, {
    executor: options.executor,
    environment: options.environment,
    action: options.action,
    ephemeral: String(options.ephemeral),
    ...(options.provider ? { provider: options.provider } : {}),
  })
}

/**
 * Track an orchestrator being started.
 */
export function trackOrchestratorStarted(options: {
  executor: string
  name: string
  displayMode: string
}): void {
  trackEvent('orchestrator_started', null, {
    executor: options.executor,
    name: options.name,
    display_mode: options.displayMode,
  })
}

/**
 * Track work being completed.
 */
export function trackWorkCompleted(options: {
  durationMs: number
  prCreated: boolean
}): void {
  trackEvent('work_completed', options.durationMs, {
    pr_created: String(options.prCreated),
  })
}

/**
 * Track a PR being created.
 */
export function trackPRCreated(options: {
  source: 'prlt' | 'manual'
}): void {
  trackEvent('pr_created', null, {
    source: options.source,
  })
}

/**
 * Track an MCP tool call.
 */
export function trackMCPToolCalled(options: {
  toolName: string
  success: boolean
}): void {
  trackEvent('mcp_tool_called', null, {
    tool_name: options.toolName,
    success: String(options.success),
  })
}

// ─── Granular Telemetry Events ────────────────────────────────────────────────

/**
 * Track a work primitive completing (groom, resolve, implement, review, peek, poke, stop).
 *
 * Privacy: No ticket IDs, descriptions, file paths, or code content.
 */
export function trackPrimitiveExecuted(options: {
  primitive: string
  durationMs: number
  success: boolean
  errorType?: string
}): void {
  trackEvent('primitive_executed', options.durationMs, {
    primitive: options.primitive,
    success: options.success,
    ...(options.errorType ? { error_type: options.errorType } : {}),
  })
}

/**
 * Track an agent completing successfully.
 *
 * Privacy: No ticket IDs, branch names, or usernames.
 */
export function trackAgentCompleted(options: {
  action: string
  durationMs: number
  exitReason: 'completed' | 'errored' | 'stopped' | 'orphaned'
  prCreated: boolean
}): void {
  trackEvent('agent_completed', options.durationMs, {
    action: options.action,
    exit_reason: options.exitReason,
    pr_created: options.prCreated,
  })
}

/**
 * Track an agent encountering an error.
 *
 * Privacy: No ticket IDs, error messages (may contain PII), or stack traces.
 */
export function trackAgentErrored(options: {
  action: string
  durationMs: number
  exitReason: 'errored'
  errorType?: string
}): void {
  trackEvent('agent_errored', options.durationMs, {
    action: options.action,
    exit_reason: options.exitReason,
    ...(options.errorType ? { error_type: options.errorType } : {}),
  })
}

/**
 * Track a ticket operation (fetch, move, update, comment, create, list).
 *
 * Privacy: No ticket IDs, descriptions, or ticket content.
 */
export function trackTicketOperation(options: {
  operation: 'fetch' | 'move' | 'update' | 'comment' | 'create' | 'list'
  provider: string
  durationMs: number
  success: boolean
}): void {
  trackEvent('ticket_operation', options.durationMs, {
    operation: options.operation,
    provider: options.provider,
    success: options.success,
  })
}

// ─── Shutdown ────────────────────────────────────────────────────────────────

/** Maximum time (ms) to wait for PostHog init before giving up during shutdown. */
const SHUTDOWN_INIT_TIMEOUT_MS = 3000

/**
 * Wait for PostHog init to complete (so queued events get flushed), then
 * shut down the client. Uses a timeout to avoid blocking CLI exit if
 * PostHog is slow.
 *
 * Events written during this command run (e.g., by trackCommandRun in
 * postrun) will be on disk and flushed on the next run — this is by
 * design (WAL guarantee: one-command delay for current-run events).
 */
export async function shutdownAnalytics(): Promise<void> {
  if (initPromise) {
    try {
      await Promise.race([
        initPromise,
        new Promise<void>(resolve => setTimeout(resolve, SHUTDOWN_INIT_TIMEOUT_MS)),
      ])
    } catch {
      // Ignore init errors — events are safely on disk
    }
  }

  analyticsShutdown = true
  initPromise = null

  if (posthogClient) {
    try {
      flushQueuedEvents()
    } catch {
      // Never let flush errors affect the CLI
    }

    try {
      posthogClient.shutdown()
    } catch {
      // Never let shutdown errors affect the CLI
    }
    posthogClient = null
  }
}
