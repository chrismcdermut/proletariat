import { Args, Flags } from '@oclif/core'
import * as path from 'node:path'
import { SqliteDatabase } from '../../lib/database/sqlite.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  getWorkspaceInfo,
  killTmuxSession,
} from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { trackPrimitiveExecuted } from '../../lib/telemetry/analytics.js'

export default class WorkStop extends PMOCommand {
  static description = 'Stop a running agent working on a ticket'

  static examples = [
    '<%= config.bin %> work stop TKT-001',
    '<%= config.bin %> work stop TKT-001 --json',
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to stop',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output as JSON',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkStop)
    const jsonMode = shouldOutputJson(flags)
    const startTime = Date.now()

    const handleError = (code: string, message: string): void => {
      trackPrimitiveExecuted({ primitive: 'stop', durationMs: Date.now() - startTime, success: false, errorType: 'command_error' })
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work stop', flags))
        return
      }
      this.error(message)
    }

    const ticketId = args.ticketId
    if (!ticketId) {
      return handleError('MISSING_TICKET', 'Ticket ID is required.')
    }

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      return handleError('NO_WORKSPACE', 'Not in a workspace. Run "prlt new" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    let db: SqliteDatabase
    try {
      db = SqliteDatabase.open(dbPath)
    } catch {
      return handleError('DB_ERROR', 'Could not open workspace database.')
    }

    try {
      const executionStorage = new ExecutionStorage(db)

      // Find running execution for this ticket
      const execution = executionStorage.getRunningExecution(ticketId)
      if (!execution) {
        return handleError(
          'NO_RUNNING_EXECUTION',
          `No running agent found for ticket "${ticketId}".\nRun "prlt work status" to see active work.`
        )
      }

      // Kill the tmux session if we have a session ID
      let killed = false
      if (execution.sessionId) {
        killed = killTmuxSession(execution.sessionId)
      }

      // If container-based, try to stop the container
      if (execution.containerId) {
        try {
          const { execSync } = await import('node:child_process')
          execSync(`docker stop ${execution.containerId}`, { stdio: 'pipe', timeout: 15000 })
          killed = true
        } catch {
          // Container may already be stopped
        }
      }

      // Update execution status
      executionStorage.updateStatus(execution.id, 'stopped')

      // Track primitive completion
      trackPrimitiveExecuted({ primitive: 'stop', durationMs: Date.now() - startTime, success: true })

      if (jsonMode) {
        outputSuccessAsJson({
          ticketId,
          executionId: execution.id,
          agentName: execution.agentName,
          status: 'stopped',
          sessionKilled: killed,
        }, createMetadata('work stop', flags))
        return
      }

      this.log(styles.success(`Stopped agent ${execution.agentName} on ${ticketId} (${execution.id})`))
    } finally {
      db.close()
    }
  }
}
