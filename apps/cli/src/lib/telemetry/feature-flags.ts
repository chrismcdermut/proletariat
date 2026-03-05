/**
 * Feature Flags (Statsig Feature Gates)
 *
 * Wraps Statsig feature gate checks with a simple API for the CLI.
 * Feature flags are evaluated locally after SDK initialization,
 * so checks are near-instant after the initial fetch.
 *
 * Usage:
 *   import { isEnabled } from '../lib/telemetry/feature-flags.js'
 *   if (isEnabled('new_board_view')) { ... }
 *
 * Feature flags require Statsig to be initialized (via initAnalytics).
 * If Statsig is unavailable or telemetry is disabled, all flags return false.
 */

import { getMachineId, isTelemetryEnabled } from './analytics.js'

// Cache for flag values — populated on check, persists for the process lifetime
const flagCache = new Map<string, boolean>()

// Statsig module reference — set after dynamic import in initAnalytics
let statsigModule: StatsigModule | null = null

interface StatsigModule {
  checkGate(user: { userID: string }, gateName: string): boolean
  getConfig(user: { userID: string }, configName: string): { get<T>(key: string, defaultValue: T): T }
}

/**
 * Set the Statsig module reference (called from analytics.ts after init).
 * @internal
 */
export function setStatsigModule(mod: StatsigModule | null): void {
  statsigModule = mod
}

/**
 * Check if a feature gate is enabled for the current machine.
 *
 * Uses Statsig's local evaluation (near-zero latency after init).
 * Returns false if Statsig is not initialized or telemetry is disabled.
 *
 * @param gateName - The feature gate name (e.g., 'new_board_view')
 * @returns Whether the gate is enabled
 */
export function isEnabled(gateName: string): boolean {
  if (!isTelemetryEnabled() || !statsigModule) return false

  // Return cached value if available
  if (flagCache.has(gateName)) {
    return flagCache.get(gateName)!
  }

  try {
    const user = { userID: getMachineId() }
    const result = statsigModule.checkGate(user, gateName)
    flagCache.set(gateName, result)
    return result
  } catch {
    // Statsig not initialized or gate check failed — default to false
    flagCache.set(gateName, false)
    return false
  }
}

/**
 * Get a dynamic config value from Statsig.
 *
 * Useful for remote configuration (not just boolean flags).
 * Returns the default value if Statsig is unavailable.
 *
 * @param configName - The dynamic config name
 * @param key - The key within the config
 * @param defaultValue - Default value if unavailable
 * @returns The config value, or the default
 */
export function getConfigValue<T>(configName: string, key: string, defaultValue: T): T {
  if (!isTelemetryEnabled() || !statsigModule) return defaultValue

  try {
    const user = { userID: getMachineId() }
    const config = statsigModule.getConfig(user, configName)
    return config.get(key, defaultValue) as T
  } catch {
    return defaultValue
  }
}

/**
 * Clear the local flag cache.
 * Useful for testing or when you want to force re-evaluation.
 */
export function clearFlagCache(): void {
  flagCache.clear()
}
