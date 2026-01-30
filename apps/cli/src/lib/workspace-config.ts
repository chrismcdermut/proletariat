/**
 * Workspace Config (config.json) Management
 *
 * Reads and writes settings from .proletariat/config.json.
 * This is distinct from execution config (stored in database).
 *
 * Config structure:
 * {
 *   "type": "hq",
 *   "name": "workspace-name",
 *   "version": "1.0.0",
 *   "schemaVersion": 1,
 *   "prlt": {
 *     "channel": "npm" | "npm:dev" | "gh" | "gh:dev" | "mount"
 *   }
 * }
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * prlt channel options:
 *
 * Public npm (npmjs.com) - no auth required:
 * - "npm": Install @proletariat/cli@latest from public npm (default)
 * - "npm:dev": Install @proletariat/cli@dev from public npm
 * - "npm:next": Install @proletariat/cli@next from public npm
 * - "npm:x.y.z": Install specific version from public npm
 *
 * Local development:
 * - "mount": Mount local prlt build from PRLT_REPO_PATH
 *
 * Legacy (deprecated, now uses npm):
 * - "gh": Alias for npm (GitHub Packages no longer used)
 */
export type PrltChannel = 'npm' | 'npm:dev' | 'npm:next' | 'gh' | 'gh:dev' | 'mount' | string

/**
 * Container configuration for agents
 */
export interface ContainerConfig {
  /**
   * Default languages to install in agent containers.
   * Comma-separated list: "node,python,go,rust,ruby,java"
   * Node is always included as it's required for prlt CLI.
   */
  languages?: string
}

export interface PrltConfig {
  /** prlt source: "npm", "npm:dev", "gh", "gh:dev", "mount", or specific version like "npm:1.2.3" */
  channel?: PrltChannel
  /** Container configuration for agents */
  container?: ContainerConfig
}

export interface WorkspaceConfig {
  type: 'hq' | 'workspace'
  name: string
  version?: string
  schemaVersion?: number
  /** prlt CLI configuration for containers */
  prlt?: PrltConfig
}

/**
 * Read workspace config from .proletariat/config.json
 */
export function readWorkspaceConfig(hqPath: string): WorkspaceConfig | null {
  const configPath = path.join(hqPath, '.proletariat', 'config.json')

  if (!fs.existsSync(configPath)) {
    return null
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    return JSON.parse(content) as WorkspaceConfig
  } catch {
    return null
  }
}

/**
 * Write workspace config to .proletariat/config.json
 */
export function writeWorkspaceConfig(hqPath: string, config: WorkspaceConfig): void {
  const configPath = path.join(hqPath, '.proletariat', 'config.json')
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
}

/**
 * Get prlt config from workspace, with defaults
 */
export function getPrltConfig(hqPath: string): PrltConfig {
  const config = readWorkspaceConfig(hqPath)
  return config?.prlt ?? {}
}

/**
 * Update prlt config section
 */
export function updatePrltConfig(hqPath: string, prltConfig: Partial<PrltConfig>): void {
  const config = readWorkspaceConfig(hqPath)
  if (!config) {
    throw new Error('No workspace config found')
  }

  config.prlt = {
    ...config.prlt,
    ...prltConfig,
  }

  writeWorkspaceConfig(hqPath, config)
}

/**
 * Get the prlt channel to use for container builds.
 * Priority: override > workspace config > default "npm"
 */
export function getPrltChannel(hqPath: string, override?: string): string {
  if (override) {
    return override
  }

  const prltConfig = getPrltConfig(hqPath)
  return prltConfig.channel ?? 'npm'
}

/**
 * Get container config from workspace, with defaults
 */
export function getContainerConfig(hqPath: string): ContainerConfig {
  const config = readWorkspaceConfig(hqPath)
  return config?.prlt?.container ?? {}
}

/**
 * Get the default container languages from workspace config.
 * Returns the configured languages string or undefined for default (node only).
 */
export function getDefaultLanguages(hqPath: string): string | undefined {
  const containerConfig = getContainerConfig(hqPath)
  return containerConfig.languages
}

/**
 * Update container config section
 */
export function updateContainerConfig(hqPath: string, containerConfig: Partial<ContainerConfig>): void {
  const config = readWorkspaceConfig(hqPath)
  if (!config) {
    throw new Error('No workspace config found')
  }

  config.prlt = {
    ...config.prlt,
    container: {
      ...config.prlt?.container,
      ...containerConfig,
    },
  }

  writeWorkspaceConfig(hqPath, config)
}

/**
 * Parse a prlt channel string into registry and version components.
 * Examples:
 *   "npm" -> { registry: "npm", version: "latest" }
 *   "npm:dev" -> { registry: "npm", version: "dev" }
 *   "npm:1.2.3" -> { registry: "npm", version: "1.2.3" }
 *   "gh" -> { registry: "gh", version: "latest" }
 *   "gh:dev" -> { registry: "gh", version: "dev" }
 *   "mount" -> { registry: "mount", version: null }
 */
export function parseChannel(channel: string): { registry: 'npm' | 'gh' | 'mount'; version: string | null } {
  if (channel === 'mount') {
    return { registry: 'mount', version: null }
  }

  if (channel.startsWith('gh')) {
    const version = channel.includes(':') ? channel.split(':')[1] : 'latest'
    return { registry: 'gh', version }
  }

  // Default to npm
  if (channel.startsWith('npm')) {
    const version = channel.includes(':') ? channel.split(':')[1] : 'latest'
    return { registry: 'npm', version }
  }

  // Bare version numbers default to npm
  return { registry: 'npm', version: channel }
}
