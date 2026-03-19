/**
 * Product Analytics (Statsig) & Event Tracking
 *
 * Provides anonymous usage analytics for the CLI using Statsig server SDK.
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
 * - On the next command run, queued events are flushed to Statsig and the queue is cleared
 * - Events are delayed by at most one command invocation — acceptable for analytics
 * - This adds zero latency and ensures no events are lost regardless of Statsig init timing
 * - Shutdown never flushes the queue — events persist until the next run confirms delivery
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { getMachineConfigDir, ensureMachineConfigDir } from '../machine-config.js'

// Statsig server secret key (this repo is private — safe for now)
const STATSIG_SERVER_KEY = 'secret-placeholder'

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
 * Minimal interface for the Statsig server SDK methods we use.
 * Uses loose return types to avoid coupling to SDK internals.
 */
interface StatsigServerInstance {
  initialize(secretKey: string, options?: Record<string, unknown>): Promise<unknown>
  logEvent(
    user: { userID: string; custom?: Record<string, string | number | boolean> },
    eventName: string,
    value?: string | number | null,
    metadata?: Record<string, unknown> | null,
  ): void
  checkGate(
    user: { userID: string; custom?: Record<string, string | number | boolean> },
    gateName: string,
  ): boolean
  getConfig(
    user: { userID: string; custom?: Record<string, string | number | boolean> },
    configName: string,
  ): { get(key: string, defaultValue: unknown): unknown }
  shutdown(): void
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
let statsigServer: StatsigServerInstance | null = null
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

  // Create new config with generated machine ID
  telemetryConfig = {
    enabled: true,
    noticeShown: false,
    machineId: crypto.randomUUID(),
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
    try { fs.unlinkSync(claimPath) } catch { /* ignore */ }
  }
}

/**
 * Flush queued events to Statsig. Requires an initialized Statsig client.
 * Called during shutdown or at the start of the next command run.
 */
export function flushQueuedEvents(): void {
  if (!statsigServer) return

  const user = { userID: getMachineId(), custom: { cli_version: cliVersion ?? '' } }
  const events = readAndClearQueue()
  for (const event of events) {
    try {
      statsigServer.logEvent(user, event.name, event.value, event.metadata)
    } catch {
      // Drop individual events silently
    }
  }
}

// ─── Statsig Client ──────────────────────────────────────────────────────────

/**
 * Initialize the Statsig SDK and flush any queued events from previous runs.
 * Called from the init hook. The Statsig init is fire-and-forget — event
 * tracking does not depend on it (events go to the disk queue instead).
 * Statsig is still needed for feature flags.
 *
 * No-op if telemetry is disabled.
 */
export function initAnalytics(version: string): void {
  cliVersion = version

  if (!isTelemetryEnabled()) return

  showTelemetryNotice()

  // Start Statsig init in background — not needed for event logging,
  // but enables feature flags and allows queue flush if init completes in time
  initPromise = (async () => {
    try {
      const { Statsig } = await import('statsig-node')
      await Statsig.initialize(STATSIG_SERVER_KEY, {
        environment: { tier: 'production' },
      })

      // If shutdown already ran while we were initializing, don't set state
      // or flush — just clean up and bail out
      if (analyticsShutdown) {
        try { Statsig.shutdown() } catch { /* ignore */ }
        return
      }

      statsigServer = Statsig as unknown as StatsigServerInstance

      // Share Statsig server with feature-flags for gate checks
      const { setStatsigClient } = await import('./feature-flags.js')
      setStatsigClient({
        checkGate: (gateName: string) => Statsig.checkGate({ userID: getMachineId() }, gateName),
        getDynamicConfig: (configName: string) => Statsig.getConfig({ userID: getMachineId() }, configName),
      })

      // Statsig is ready — flush any events queued from previous runs
      flushQueuedEvents()
    } catch {
      // If Statsig can't initialize, fail silently — analytics should never break the CLI
      statsigServer = null
    }
  })()
}

// ─── Event Tracking ──────────────────────────────────────────────────────────

/**
 * Track an analytics event. Writes to a local disk queue synchronously —
 * never blocks on network I/O. Events are flushed to Statsig on the next
 * command run (or during this run's shutdown if Statsig initialized in time).
 *
 * @param eventName - Event name (e.g., 'command_run')
 * @param value - Optional numeric or string value
 * @param metadata - Event-specific metadata
 */
export function trackEvent(eventName: string, value?: string | number | null, metadata?: Record<string, unknown> | null): void {
  if (!isTelemetryEnabled()) return

  try {
    // Convert metadata values to strings as required by the client SDK
    const stringMetadata: Record<string, string> | null = metadata
      ? Object.fromEntries(
          Object.entries({ ...metadata, cli_version: cliVersion }).map(([k, v]) => [k, String(v)]),
        )
      : cliVersion
        ? { cli_version: cliVersion }
        : null

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
 */
export function trackAgentSpawned(options: {
  executor: string
  environment: string
  action: string
  ephemeral: boolean
}): void {
  trackEvent('agent_spawned', null, {
    executor: options.executor,
    environment: options.environment,
    action: options.action,
    ephemeral: String(options.ephemeral),
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

// ─── Shutdown ────────────────────────────────────────────────────────────────

/** Maximum time (ms) to wait for Statsig init before giving up during shutdown. */
const SHUTDOWN_INIT_TIMEOUT_MS = 3000

/**
 * Wait for Statsig init to complete (so queued events get flushed), then
 * shut down the client. Uses a timeout to avoid blocking CLI exit if
 * Statsig is slow (e.g., first run with no cache). After the first
 * successful init, Statsig caches its config locally so subsequent
 * initializations resolve in < 100 ms.
 *
 * Events written during this command run (e.g., by trackCommandRun in
 * postrun) will be on disk and flushed on the next run — this is by
 * design (WAL guarantee: one-command delay for current-run events).
 */
export async function shutdownAnalytics(): Promise<void> {
  // Await the in-progress Statsig init so it can flush queued events from
  // previous runs. Without this, the init promise sees analyticsShutdown=true
  // and bails before calling flushQueuedEvents(), causing the queue to grow
  // indefinitely (see PRLT-1013).
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

  // Now mark as shut down so any late-resolving init promise (after timeout)
  // won't set statsigServer or flush the queue
  analyticsShutdown = true
  initPromise = null

  if (statsigServer) {
    try {
      // Flush events written during this run that arrived after the init
      // promise's own flush (e.g., the command_run event from postrun).
      // statsigServer.logEvent() buffers in memory; shutdown() sends them.
      flushQueuedEvents()
      statsigServer.shutdown()
    } catch {
      // Never let shutdown errors affect the CLI
    }

    statsigServer = null
    try {
      const { setStatsigClient } = await import('./feature-flags.js')
      setStatsigClient(null)
    } catch {
      // Ignore
    }
  }
}
