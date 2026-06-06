/**
 * Switchboard Agent Hooks
 *
 * Lifecycle hooks for agents to integrate with the switchboard.
 * Called during agent spawn and teardown to set up/clean up
 * switchboard connections.
 *
 * See: PRLT-1371
 */

import { SwitchboardClient, type SwitchboardClientOptions } from '../client.js'
import type { SwitchboardAddress } from '../types.js'

// =============================================================================
// Types
// =============================================================================

export interface AgentSwitchboardConfig {
  /** The agent's switchboard address. */
  address: SwitchboardAddress
  /** Path to switchboard.db (in container, this is a volume mount). */
  dbPath?: string
  /** Path to switchboard.sock (in container, this is a volume mount). */
  socketPath?: string
  /** Topics to auto-subscribe to on startup. */
  autoSubscribe?: string[]
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Initialize the switchboard client for an agent.
 * Called during agent spawn to set up the connection.
 *
 * Returns the client instance — the caller is responsible for
 * storing it and calling close() on teardown.
 */
export function initAgentSwitchboard(config: AgentSwitchboardConfig): SwitchboardClient {
  const client = new SwitchboardClient({
    address: config.address,
    dbPath: config.dbPath,
    socketPath: config.socketPath,
  })

  // Auto-subscribe to configured topics
  if (config.autoSubscribe) {
    for (const topic of config.autoSubscribe) {
      client.subscribe(topic)
    }
  }

  return client
}

/**
 * Tear down the switchboard client for an agent.
 * Called during agent teardown to clean up connections.
 */
export function teardownAgentSwitchboard(client: SwitchboardClient): void {
  client.stopPolling()
  client.close()
}

/**
 * Build the switchboard config for an agent from execution context.
 */
export function buildAgentSwitchboardConfig(params: {
  executionId: string
  agentName: string
  containerId?: string
  dbPath?: string
  socketPath?: string
}): AgentSwitchboardConfig {
  return {
    address: {
      kind: 'agent',
      id: params.executionId,
      containerId: params.containerId,
    },
    dbPath: params.dbPath,
    socketPath: params.socketPath,
    autoSubscribe: [
      'agent:spawned',
      'agent:stopped',
      'work:pr_merged',
    ],
  }
}
