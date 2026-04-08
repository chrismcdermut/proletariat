/**
 * Machine DB Mirror — bridges workspace.db executions to machine.db.
 *
 * `prlt work run` and `prlt orchestrate machine` write directly to machine.db.
 * `prlt work start` and `prlt orchestrator start` write to workspace.db for
 * ticket-linked state, but also need to mirror those executions to machine.db
 * so that:
 *
 *   - `prlt session list` from outside an HQ sees them
 *   - `prlt orchestrator status` from `/tmp` sees orchestrators in every HQ
 *   - The machine-level supervision story (PRLT-1249) actually works
 *
 * Machine.db writes are always best-effort. workspace.db is still authoritative
 * for ticketed work; if mirroring fails we silently swallow the error and keep
 * the primary flow running.
 */
import { MachineDB, type MachineExecution, type MachineExecutionStatus } from './machine-db.js'

export interface MirrorCreateInput {
  /** Ticket ID (e.g. TKT-123, PRLT-456). Use 'ORCH' / 'prlt' for orchestrators. */
  ticketId: string
  /** Agent name. For orchestrators use `orchestrator-{name}`. */
  agentName: string
  executor: string
  environment: string
  /** Working directory — repo path for work, HQ path for orchestrators. */
  repoPath: string
  branch?: string
  persistent?: boolean
  /** Optional human-readable prompt. Falls back to "ticketId agentName". */
  prompt?: string
  /**
   * Optional override for the machine.db path. When omitted, uses
   * `~/.proletariat/machine.db`. Used by tests to avoid colliding with the
   * user's real machine DB.
   */
  machineDbPath?: string
}

export interface MirrorHandle {
  machineDb: MachineDB
  execution: MachineExecution
}

/**
 * Create a machine.db execution row mirroring a workspace.db execution.
 *
 * Returns a handle for later status/process-info updates, or `null` if the
 * machine DB could not be opened or the row could not be inserted.
 *
 * Callers MUST pass the handle to {@link closeMirrorExecution} when done.
 */
export function createMirrorExecution(input: MirrorCreateInput): MirrorHandle | null {
  try {
    const machineDb = new MachineDB(input.machineDbPath)
    const execution = machineDb.createExecution({
      prompt: input.prompt ?? `${input.ticketId} ${input.agentName}`.trim(),
      repoPath: input.repoPath,
      agentName: input.agentName,
      executor: input.executor,
      environment: input.environment,
      branch: input.branch,
      ticketId: input.ticketId,
      persistent: input.persistent ?? false,
    })
    return { machineDb, execution }
  } catch {
    return null
  }
}

/**
 * Update a mirrored execution with new status and/or process info. All errors
 * are swallowed: machine.db is the secondary store and must never break the
 * primary flow.
 */
export function updateMirrorExecution(
  handle: MirrorHandle | null,
  update: {
    status?: MachineExecutionStatus
    sessionId?: string
    containerId?: string
    branch?: string
    errorMessage?: string
  }
): void {
  if (!handle) return
  try {
    if (update.status) {
      handle.machineDb.updateStatus(
        handle.execution.id,
        update.status,
        undefined,
        update.errorMessage,
      )
    }
    if (
      update.sessionId !== undefined ||
      update.containerId !== undefined ||
      update.branch !== undefined
    ) {
      handle.machineDb.updateProcessInfo(handle.execution.id, {
        sessionId: update.sessionId,
        containerId: update.containerId,
        branch: update.branch,
      })
    }
  } catch {
    // Non-fatal — machine.db is secondary.
  }
}

/** Close the underlying machine DB. Safe to call with a `null` handle. */
export function closeMirrorExecution(handle: MirrorHandle | null): void {
  if (!handle) return
  try {
    handle.machineDb.close()
  } catch {
    // ignore
  }
}
