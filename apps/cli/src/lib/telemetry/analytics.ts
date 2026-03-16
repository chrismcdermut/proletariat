/**
 * Product Analytics (Statsig) & Event Tracking
 *
 * Provides anonymous usage analytics for the CLI using Statsig client SDK.
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
 * - Events are fired async and never block command execution
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { getMachineConfigDir, ensureMachineConfigDir } from '../machine-config.js'

// Statsig client SDK key (public — safe to embed in open source repos)
const STATSIG_CLIENT_KEY = 'client-kvxMxRhn9NFSmH8orl7e2W9nYTfWVS7Kjf7yRTdIecc'

// Max time to wait for init + flush during shutdown — keeps CLI exit snappy
const SHUTDOWN_TIMEOUT_MS = 500

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
 * Minimal interface for the Statsig client instance methods we use.
 * Uses loose return types to avoid coupling to SDK internals.
 */
interface StatsigClientInstance {
  initializeAsync(): Promise<unknown>
  logEvent(
    eventName: string,
    value?: string | number | null,
    metadata?: Record<string, string> | null,
  ): void
  checkGate(gateName: string): boolean
  getDynamicConfig(configName: string): { get(key: string, defaultValue: unknown): unknown }
  shutdown(): void
}

// Module-level state
let statsigClient: StatsigClientInstance | null = null
let telemetryConfig: TelemetryConfig | null = null
let cliVersion: string | null = null
let initPromise: Promise<void> | null = null

// Events logged before the Statsig client finishes initializing.
// These are replayed once init completes (in shutdownAnalytics).
let pendingEvents: Array<{
  name: string
  value?: string | number | null
  metadata?: Record<string, string> | null
}> = []

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

// ─── Statsig Client ──────────────────────────────────────────────────────────

/**
 * Initialize the Statsig SDK. Called from the init hook.
 * No-op if telemetry is disabled.
 */
export function initAnalytics(version: string): Promise<void> {
  cliVersion = version

  if (!isTelemetryEnabled()) return Promise.resolve()

  showTelemetryNotice()

  initPromise = (async () => {
    try {
      const { StatsigClient: StatsigClientClass } = await import('@statsig/js-client')
      const client = new StatsigClientClass(
        STATSIG_CLIENT_KEY,
        { userID: getMachineId(), custom: { cli_version: version } },
      )
      await client.initializeAsync()
      statsigClient = client

      // Share Statsig client with feature-flags for synchronous gate checks
      const { setStatsigClient } = await import('./feature-flags.js')
      setStatsigClient(client)
    } catch {
      // If Statsig can't initialize, fail silently — analytics should never break the CLI
      statsigClient = null
    }
  })()

  return initPromise
}

// ─── Event Tracking ──────────────────────────────────────────────────────────

/**
 * Track an analytics event. Fire-and-forget — never blocks.
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

    if (statsigClient) {
      statsigClient.logEvent(eventName, value, stringMetadata)
    } else if (initPromise) {
      // Client is still initializing — buffer the event for replay at shutdown
      pendingEvents.push({ name: eventName, value, metadata: stringMetadata })
    }
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

/**
 * Replay events that were buffered while the Statsig client was initializing.
 */
function flushPendingEvents(): void {
  if (!statsigClient || pendingEvents.length === 0) return
  for (const event of pendingEvents) {
    try {
      statsigClient.logEvent(event.name, event.value, event.metadata)
    } catch {
      // Drop individual events silently
    }
  }
  pendingEvents = []
}

/**
 * Flush pending events and shut down the Statsig client.
 * Called from the postrun hook. Caps total wait at SHUTDOWN_TIMEOUT_MS
 * so analytics never adds more than 500ms to CLI exit time.
 */
export async function shutdownAnalytics(): Promise<void> {
  // Wait for init to complete so buffered events can be flushed,
  // but cap the wait to avoid blocking CLI exit.
  if (initPromise) {
    try {
      await Promise.race([
        initPromise,
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
      ])
    } catch {
      // Init may have failed — continue to cleanup
    }
    initPromise = null
  }

  // Replay any events that were buffered while init was in progress
  flushPendingEvents()

  if (!statsigClient) return

  try {
    statsigClient.shutdown()
  } catch {
    // Never let shutdown errors affect the CLI
  } finally {
    statsigClient = null
    // Clear feature-flags module reference
    try {
      const { setStatsigClient } = await import('./feature-flags.js')
      setStatsigClient(null)
    } catch {
      // Ignore
    }
  }
}
