/**
 * Feature Flags (stub)
 *
 * Previously backed by Statsig feature gates. Statsig has been removed
 * (PRLT-1050) so all flags now return their default values.
 *
 * The API surface is preserved so callers don't need to change.
 *
 * Usage:
 *   import { isEnabled } from '../lib/telemetry/feature-flags.js'
 *   if (isEnabled('new_board_view')) { ... }
 */

/**
 * Check if a feature gate is enabled.
 *
 * Always returns false now that Statsig has been removed.
 */
export function isEnabled(_gateName: string): boolean {
  return false
}

/**
 * Get a dynamic config value.
 *
 * Always returns the default value now that Statsig has been removed.
 */
export function getConfigValue<T>(_configName: string, _key: string, defaultValue: T): T {
  return defaultValue
}

/**
 * Clear the local flag cache (no-op without Statsig).
 */
export function clearFlagCache(): void {
  // No-op
}
