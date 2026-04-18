/**
 * PRLT-1337: Mark execution as completed/failed with exit code.
 *
 * Called by tmux runner scripts when the executor process exits.
 * This is the mechanism that writes completed_at, exit_code, and
 * transitions status from 'running' to 'completed' or 'failed'.
 */

import { Args, Flags, Command } from '@oclif/core'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import type { ExecutionStatus } from '../../lib/execution/types.js'

export default class ExecutionComplete extends Command {
  static description = 'Mark an execution as completed or failed (called by runner scripts)'

  static hidden = true // Internal command — not shown in help

  static args = {
    id: Args.string({
      description: 'Execution ID (e.g., WORK-A1B2C3D4)',
      required: true,
    }),
  }

  static flags = {
    'exit-code': Flags.integer({
      description: 'Exit code of the executor process',
      required: true,
    }),
    status: Flags.string({
      description: 'Override status (default: inferred from exit code)',
      options: ['completed', 'failed'],
      required: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ExecutionComplete)

    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      // Not in a workspace — can't update. Silently exit.
      return
    }

    let db
    try {
      db = openWorkspaceDatabase(workspaceInfo.path)
    } catch {
      // DB not available — silently exit.
      return
    }

    try {
      const executionStorage = new ExecutionStorage(db)
      const execution = executionStorage.getExecution(args.id)

      if (!execution) {
        // Execution not found — may have been cleaned up already. Not an error.
        return
      }

      // Don't re-complete if already in a terminal state
      if (['completed', 'failed', 'stopped'].includes(execution.status)) {
        return
      }

      const exitCode = flags['exit-code']
      const status: ExecutionStatus = (flags.status as ExecutionStatus)
        || (exitCode === 0 ? 'completed' : 'failed')

      executionStorage.updateStatus(args.id, status, exitCode)
    } catch {
      // Best-effort — don't crash if DB write fails
    } finally {
      try { db.close() } catch { /* ignore */ }
    }
  }
}
