/**
 * Switchboard Agent Startup
 *
 * Generates the MCP server configuration that gets injected into
 * agents at spawn time. This enables agents to communicate via
 * the switchboard from day 1.
 *
 * The startup config includes:
 * - Path to switchboard.db (volume-mounted for Docker agents)
 * - Path to switchboard.sock (volume-mounted for Docker agents)
 * - The agent's switchboard address
 *
 * See: PRLT-1371
 */

import * as path from 'node:path'
import * as os from 'node:os'

// =============================================================================
// Types
// =============================================================================

export interface SwitchboardMcpConfig {
  /** Path to the switchboard database file. */
  dbPath: string
  /** Path to the switchboard socket file. */
  socketPath: string
  /** The agent's address kind. */
  addressKind: string
  /** The agent's address ID (execution ID). */
  addressId: string
  /** Container ID (if running in Docker). */
  containerId?: string
}

// =============================================================================
// Config Generation
// =============================================================================

/**
 * Build the switchboard MCP config for a host-based agent.
 */
export function buildHostMcpConfig(executionId: string): SwitchboardMcpConfig {
  const proletariatDir = path.join(os.homedir(), '.proletariat')
  return {
    dbPath: path.join(proletariatDir, 'switchboard.db'),
    socketPath: path.join(proletariatDir, 'switchboard.sock'),
    addressKind: 'agent',
    addressId: executionId,
  }
}

/**
 * Build the switchboard MCP config for a Docker container agent.
 * Uses the container-internal mount paths.
 */
export function buildContainerMcpConfig(
  executionId: string,
  containerId: string,
): SwitchboardMcpConfig {
  // Inside the container, .proletariat is mounted at /root/.proletariat
  // (matching the host bind mount pattern)
  return {
    dbPath: '/root/.proletariat/switchboard.db',
    socketPath: '/root/.proletariat/switchboard.sock',
    addressKind: 'agent',
    addressId: executionId,
    containerId,
  }
}

/**
 * Get the volume mount arguments needed to expose switchboard
 * files inside a Docker container.
 *
 * Returns an array of Docker -v mount strings.
 */
export function getSwitchboardVolumeMounts(): string[] {
  const proletariatDir = path.join(os.homedir(), '.proletariat')
  return [
    `${proletariatDir}/switchboard.db:/root/.proletariat/switchboard.db`,
    `${proletariatDir}/switchboard.db-wal:/root/.proletariat/switchboard.db-wal`,
    `${proletariatDir}/switchboard.db-shm:/root/.proletariat/switchboard.db-shm`,
    `${proletariatDir}/switchboard.sock:/root/.proletariat/switchboard.sock`,
  ]
}

/**
 * Generate environment variables for the switchboard config.
 * These are passed to the container and read by the agent startup.
 */
export function getSwitchboardEnvVars(config: SwitchboardMcpConfig): Record<string, string> {
  const vars: Record<string, string> = {
    SWITCHBOARD_DB_PATH: config.dbPath,
    SWITCHBOARD_SOCKET_PATH: config.socketPath,
    SWITCHBOARD_ADDRESS_KIND: config.addressKind,
    SWITCHBOARD_ADDRESS_ID: config.addressId,
  }
  if (config.containerId) {
    vars.SWITCHBOARD_CONTAINER_ID = config.containerId
  }
  return vars
}
