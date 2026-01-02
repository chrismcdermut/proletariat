/**
 * Spawn Agent Action
 *
 * Executes the spawn_agent action which triggers auto-spawn
 * for tickets when hooks fire.
 */

import Database from 'better-sqlite3'
import { SpawnAgentAction, HookExecutionContext, TicketMovedPayload, TicketCreatedPayload } from '../types.js'
import { SQLiteStorage } from '../../pmo/storage-sqlite.js'
import { ExecutionStorage } from '../../execution/storage.js'
import { getWorkspaceInfo } from '../../agents/commands.js'
import { spawnAgentForTicket, selectAgent, getAvailableAgents } from '../../execution/spawner.js'
import { getDatabasePath, openWorkspaceDatabase } from '../../database/index.js'
import { Ticket } from '../../pmo/types.js'

export interface SpawnResult {
  spawned: boolean
  agentName?: string
  executionId?: string
  ticketId?: string
  error?: string
}

/**
 * Execute a spawn_agent action
 */
export async function executeSpawnAction(
  action: SpawnAgentAction,
  context: HookExecutionContext
): Promise<SpawnResult> {
  const { payload, workspacePath, pmoPath, log } = context

  // Get ticket from payload - different events have different payload structures
  let ticket: Ticket | undefined

  if ('ticket' in payload) {
    ticket = (payload as TicketMovedPayload | TicketCreatedPayload).ticket
  }

  if (!ticket) {
    return {
      spawned: false,
      error: 'No ticket found in event payload',
    }
  }

  try {
    // Open database
    const dbPath = getDatabasePath(workspacePath)
    const db = openWorkspaceDatabase(workspacePath)

    // Get workspace info
    const workspaceInfo = getWorkspaceInfo()
    if (!workspaceInfo) {
      db.close()
      return {
        spawned: false,
        ticketId: ticket.id,
        error: 'Could not get workspace info',
      }
    }

    // Initialize storage instances
    const storage = new SQLiteStorage(dbPath, payload.projectId)
    const executionStorage = new ExecutionStorage(db)

    // Check if ticket already has a running execution
    const runningExec = executionStorage.getRunningExecution(ticket.id)
    if (runningExec) {
      await storage.close()
      db.close()
      return {
        spawned: false,
        ticketId: ticket.id,
        error: `Ticket already has running execution: ${runningExec.id}`,
      }
    }

    // Get available agents
    const availableAgents = action.agent
      ? [action.agent]
      : getAvailableAgents(workspaceInfo, executionStorage)

    if (availableAgents.length === 0) {
      await storage.close()
      db.close()
      return {
        spawned: false,
        ticketId: ticket.id,
        error: 'No agents available',
      }
    }

    // Select agent using strategy
    const strategy = action.strategy || 'round-robin'
    const agentName = action.agent || selectAgent(strategy, availableAgents, executionStorage)

    if (!agentName) {
      await storage.close()
      db.close()
      return {
        spawned: false,
        ticketId: ticket.id,
        error: 'Could not select an agent',
      }
    }

    // Spawn agent for ticket
    const spawnResult = await spawnAgentForTicket(
      ticket,
      agentName,
      storage,
      executionStorage,
      workspaceInfo,
      db,
      pmoPath,
      {
        environment: action.environment,
        displayMode: action.displayMode,
        skipPermissions: action.skipPermissions,
        createPR: action.createPR,
        log,
      }
    )

    await storage.close()
    db.close()

    if (spawnResult.success) {
      log(`Hook spawned agent ${agentName} for ticket ${ticket.id}`)
      return {
        spawned: true,
        agentName,
        executionId: spawnResult.executionId,
        ticketId: ticket.id,
      }
    } else {
      return {
        spawned: false,
        agentName,
        ticketId: ticket.id,
        error: spawnResult.error || 'Spawn failed',
      }
    }
  } catch (error) {
    return {
      spawned: false,
      ticketId: ticket?.id,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
