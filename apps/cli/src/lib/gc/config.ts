/**
 * GC Configuration
 *
 * DB-backed configuration for the garbage collection system.
 * All settings are stored in workspace_settings with the `gc.` prefix
 * so they are shared across agents, sessions, and the daemon.
 *
 * Sensible defaults are provided for all settings. Users can override
 * via `prlt config set gc.<key> <value>`.
 */

import { SettingsStore } from '../database/settings-store.js'

// =============================================================================
// Types
// =============================================================================

export interface GCConfig {
  /** Daemon sweep interval (e.g. '5m', '10m', '1h') */
  sweepInterval: string
  /** Staleness thresholds */
  staleness: {
    /** TTL for agents with no tmux session (e.g. '5m') */
    sessionlessTtl: string
    /** TTL for containers with no active execution (e.g. '10m') */
    containerNoExecTtl: string
    /** TTL for idle agents before cleanup (e.g. '24h') */
    idleAgentTtl: string
  }
  /** Retention policies */
  retention: {
    /** Whether to keep branches after PR merge */
    keepBranchesAfterMerge: boolean
    /** How long to keep execution records (e.g. '30d') */
    executionRetention: string
  }
  /** Cascade step toggles */
  cascade: {
    /** Whether to delete branches (local + remote) during cascade */
    branch: boolean
    /** Whether to archive/delete execution records during cascade */
    executionRecords: boolean
  }
}

// =============================================================================
// Defaults
// =============================================================================

export const GC_DEFAULTS: Readonly<GCConfig> = {
  sweepInterval: '5m',
  staleness: {
    sessionlessTtl: '5m',
    containerNoExecTtl: '10m',
    idleAgentTtl: '24h',
  },
  retention: {
    keepBranchesAfterMerge: false,
    executionRetention: '30d',
  },
  cascade: {
    branch: true,
    executionRecords: true,
  },
}

// =============================================================================
// Settings Keys
// =============================================================================

const KEYS = {
  sweepInterval: 'gc.sweep_interval',
  sessionlessTtl: 'gc.staleness.sessionless_ttl',
  containerNoExecTtl: 'gc.staleness.container_no_exec_ttl',
  idleAgentTtl: 'gc.staleness.idle_agent_ttl',
  keepBranchesAfterMerge: 'gc.retention.keep_branches_after_merge',
  executionRetention: 'gc.retention.execution_retention',
  cascadeBranch: 'gc.cascade.branch',
  cascadeExecutionRecords: 'gc.cascade.execution_records',
} as const

// =============================================================================
// Duration Parsing
// =============================================================================

/**
 * Parse a duration string like '5m', '10m', '1h', '24h', '30d' into milliseconds.
 * Supports: s (seconds), m (minutes), h (hours), d (days).
 * Returns null if the string is not a valid duration.
 */
export function parseDuration(duration: string): number | null {
  const match = duration.trim().match(/^(\d+)\s*(s|m|h|d)$/i)
  if (!match) return null

  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()

  switch (unit) {
    case 's': return value * 1000
    case 'm': return value * 60 * 1000
    case 'h': return value * 60 * 60 * 1000
    case 'd': return value * 24 * 60 * 60 * 1000
    default: return null
  }
}

/**
 * Parse a duration string to milliseconds, falling back to a default if invalid.
 */
export function parseDurationOrDefault(duration: string, defaultDuration: string): number {
  return parseDuration(duration) ?? parseDuration(defaultDuration)!
}

// =============================================================================
// Config Access
// =============================================================================

/**
 * Load the full GC configuration from workspace_settings.
 * Falls back to GC_DEFAULTS for any unset keys.
 */
export function getGCConfig(settings: SettingsStore): GCConfig {
  return {
    sweepInterval: settings.get(KEYS.sweepInterval) ?? GC_DEFAULTS.sweepInterval,
    staleness: {
      sessionlessTtl: settings.get(KEYS.sessionlessTtl) ?? GC_DEFAULTS.staleness.sessionlessTtl,
      containerNoExecTtl: settings.get(KEYS.containerNoExecTtl) ?? GC_DEFAULTS.staleness.containerNoExecTtl,
      idleAgentTtl: settings.get(KEYS.idleAgentTtl) ?? GC_DEFAULTS.staleness.idleAgentTtl,
    },
    retention: {
      keepBranchesAfterMerge: parseBool(settings.get(KEYS.keepBranchesAfterMerge), GC_DEFAULTS.retention.keepBranchesAfterMerge),
      executionRetention: settings.get(KEYS.executionRetention) ?? GC_DEFAULTS.retention.executionRetention,
    },
    cascade: {
      branch: parseBool(settings.get(KEYS.cascadeBranch), GC_DEFAULTS.cascade.branch),
      executionRecords: parseBool(settings.get(KEYS.cascadeExecutionRecords), GC_DEFAULTS.cascade.executionRecords),
    },
  }
}

/**
 * Set a GC configuration value.
 * Accepts any gc.* key and persists it to workspace_settings.
 */
export function setGCConfigValue(settings: SettingsStore, key: string, value: string): void {
  // Validate the key is a known GC key
  const validKeys = Object.values(KEYS)
  if (!validKeys.includes(key as typeof validKeys[number])) {
    throw new Error(`Unknown GC config key: ${key}. Valid keys: ${validKeys.join(', ')}`)
  }
  settings.set(key, value)
}

/**
 * Get all GC configuration keys and their current values (for display).
 */
export function getGCConfigEntries(settings: SettingsStore): Array<{ key: string; value: string; default: string }> {
  const config = getGCConfig(settings)
  return [
    { key: KEYS.sweepInterval, value: config.sweepInterval, default: GC_DEFAULTS.sweepInterval },
    { key: KEYS.sessionlessTtl, value: config.staleness.sessionlessTtl, default: GC_DEFAULTS.staleness.sessionlessTtl },
    { key: KEYS.containerNoExecTtl, value: config.staleness.containerNoExecTtl, default: GC_DEFAULTS.staleness.containerNoExecTtl },
    { key: KEYS.idleAgentTtl, value: config.staleness.idleAgentTtl, default: GC_DEFAULTS.staleness.idleAgentTtl },
    { key: KEYS.keepBranchesAfterMerge, value: String(config.retention.keepBranchesAfterMerge), default: String(GC_DEFAULTS.retention.keepBranchesAfterMerge) },
    { key: KEYS.executionRetention, value: config.retention.executionRetention, default: GC_DEFAULTS.retention.executionRetention },
    { key: KEYS.cascadeBranch, value: String(config.cascade.branch), default: String(GC_DEFAULTS.cascade.branch) },
    { key: KEYS.cascadeExecutionRecords, value: String(config.cascade.executionRecords), default: String(GC_DEFAULTS.cascade.executionRecords) },
  ]
}

/** All known GC config keys (for validation and tab-completion). */
export const GC_CONFIG_KEYS = Object.values(KEYS)

// =============================================================================
// Helpers
// =============================================================================

function parseBool(value: string | null, defaultValue: boolean): boolean {
  if (value === null) return defaultValue
  return value === 'true' || value === '1' || value === 'yes'
}
