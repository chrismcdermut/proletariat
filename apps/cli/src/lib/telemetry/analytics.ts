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
 * - Events are fired async and never block command execution
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { getMachineConfigDir, ensureMachineConfigDir } from '../machine-config.js'

// Statsig server SDK key (placeholder — replace with real key in production)
const STATSIG_SERVER_KEY = 'secret-placeholder'

// Flush timeout — don't let analytics delay CLI exit
const FLUSH_TIMEOUT_MS = 2000

/**
 * Telemetry configuration stored in ~/.proletariat/telemetry.json
 */
interface TelemetryConfig {
  /** Whether telemetry is enabled (default: true) */
  enabled: boolean
  /** Anonymous machine ID (UUID v4) */
  machineId: string
  /** When telemetry was first initialized */
  createdAt: string
  /** When the enabled status was last changed */
  updatedAt: string
}

/**
 * Minimal interface for the Statsig singleton methods we use.
 * Avoids importing the full Statsig type at the module level.
 */
interface StatsigClient {
  logEvent(
    user: { userID: string; custom?: Record<string, unknown> },
    eventName: string,
    value?: string | number | null,
    metadata?: Record<string, unknown> | null,
  ): void
  checkGate(user: { userID: string }, gateName: string): boolean
  getConfig(user: { userID: string }, configName: string): { get<T>(key: string, defaultValue: T): T }
  flush(timeout?: number): Promise<void>
  shutdown(timeout?: number): void
}

// Module-level state
let statsigClient: StatsigClient | null = null
let telemetryConfig: TelemetryConfig | null = null
let cliVersion: string | null = null

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

// ─── Machine ID ──────────────────────────────────────────────────────────────

/**
 * Get the anonymous machine ID for this installation.
 */
export function getMachineId(): string {
  return readTelemetryConfig().machineId
}

// ─── Statsig Client ──────────────────────────────────────────────────────────

/**
 * Get the Statsig user object for the current machine.
 */
function getStatsigUser(): { userID: string; custom?: Record<string, unknown> } {
  return {
    userID: getMachineId(),
    ...(cliVersion ? { custom: { cli_version: cliVersion } } : {}),
  }
}

/**
 * Initialize the Statsig SDK. Called from the init hook.
 * No-op if telemetry is disabled.
 */
export async function initAnalytics(version: string): Promise<void> {
  cliVersion = version

  if (!isTelemetryEnabled()) return

  try {
    const statsigModule = await import('statsig-node')
    // statsig-node exports a CJS-style module; the Statsig singleton is on .default
    const Statsig = statsigModule.default as unknown as StatsigClient & {
      initialize(key: string, options?: { initTimeoutMs?: number }): Promise<unknown>
    }
    await Statsig.initialize(STATSIG_SERVER_KEY, {
      initTimeoutMs: 3000,
    })
    statsigClient = Statsig

    // Share Statsig module with feature-flags for synchronous gate checks
    const { setStatsigModule } = await import('./feature-flags.js')
    setStatsigModule(Statsig)
  } catch {
    // If Statsig can't initialize, fail silently — analytics should never break the CLI
    statsigClient = null
  }
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
  if (!statsigClient || !isTelemetryEnabled()) return

  try {
    const user = getStatsigUser()
    statsigClient.logEvent(user, eventName, value, {
      ...metadata,
      cli_version: cliVersion,
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

/**
 * Flush pending events and shut down the Statsig client.
 * Called from the postrun hook. Times out to avoid blocking CLI exit.
 */
export async function shutdownAnalytics(): Promise<void> {
  if (!statsigClient) return

  try {
    await Promise.race([
      statsigClient.flush(FLUSH_TIMEOUT_MS),
      new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
    ])
    statsigClient.shutdown()
  } catch {
    // Never let shutdown errors affect the CLI
  } finally {
    statsigClient = null
    // Clear feature-flags module reference
    try {
      const { setStatsigModule } = await import('./feature-flags.js')
      setStatsigModule(null)
    } catch {
      // Ignore
    }
  }
}
