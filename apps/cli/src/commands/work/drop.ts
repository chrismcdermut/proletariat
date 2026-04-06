import { Args, Flags } from '@oclif/core'
import type Database from 'better-sqlite3'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
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
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import {
  checkGhCliStatus,
  closePR,
  getPRForBranch,
  getPRByNumber,
} from '../../lib/pr/index.js'
import { moveTicketByIntent } from '../../lib/work-lifecycle/transition.js'
import { SQLiteStorage } from '../../lib/pmo/storage/index.js'

export default class WorkDrop extends PromptCommand {
  static description = 'Drop work: kill agent, close PR, and move ticket off the board'

  static examples = [
    '<%= config.bin %> work drop TKT-001',
    '<%= config.bin %> work drop TKT-001 --json',
    '<%= config.bin %> work drop TKT-001 --no-transition',
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to drop',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output as JSON',
      default: false,
    }),
    'no-transition': Flags.boolean({
      description: 'Skip board state transition (still kills agent and closes PR)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkDrop)
    const jsonMode = shouldOutputJson(flags)
    const startTime = Date.now()

    const handleError = (code: string, message: string): void => {
      trackPrimitiveExecuted({ primitive: 'drop', durationMs: Date.now() - startTime, success: false, errorType: 'command_error' })
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work drop', flags))
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
    let db: Database.Database
    try {
      db = openWorkspaceDatabase(workspaceInfo.path)
    } catch {
      return handleError('DB_ERROR', 'Could not open workspace database.')
    }

    try {
      const executionStorage = new ExecutionStorage(db)

      // --- Step 1: Kill agent if running ---
      let agentKilled = false
      let agentName: string | undefined
      const execution = executionStorage.getRunningExecution(ticketId)

      if (execution) {
        agentName = execution.agentName

        // Kill tmux session
        if (execution.sessionId) {
          agentKilled = killTmuxSession(execution.sessionId)
        }

        // Kill Docker container
        if (execution.containerId) {
          try {
            const { execSync } = await import('node:child_process')
            execSync(`docker stop ${execution.containerId}`, { stdio: 'pipe', timeout: 15000 })
            agentKilled = true
          } catch {
            // Container may already be stopped
          }
        }

        // Mark execution as dropped
        executionStorage.updateStatus(execution.id, 'stopped')
        if (!jsonMode) {
          this.log(styles.muted(`   Agent ${execution.agentName} stopped`))
        }
      }

      // --- Step 2: Close PR if open ---
      let prClosed = false
      let prNumber: number | undefined

      if (checkGhCliStatus().available) {
        // Try to find PR from execution branch or ticket metadata
        let prInfo = null

        // Check ticket metadata for PR number
        try {
          const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
          if (fs.existsSync(dbPath)) {
            const storage = new SQLiteStorage(dbPath)
            try {
              const ticket = await storage.getTicket(ticketId)
              if (ticket?.metadata?.pr_number) {
                prNumber = parseInt(ticket.metadata.pr_number, 10)
                prInfo = getPRByNumber(prNumber)
              }
            } finally {
              await storage.close()
            }
          }
        } catch {
          // Non-fatal
        }

        // Fall back to branch-based PR lookup
        if (!prInfo && execution?.branch) {
          prInfo = getPRForBranch(execution.branch)
          if (prInfo) {
            prNumber = prInfo.number
          }
        }

        if (prInfo && prInfo.state === 'OPEN') {
          const closeResult = closePR(prInfo.number, {
            comment: 'Dropped via `prlt work drop`.',
          })
          if (closeResult.success) {
            prClosed = true
            if (!jsonMode) {
              this.log(styles.muted(`   PR #${prInfo.number} closed`))
            }
          } else if (!jsonMode) {
            this.log(styles.warning(`   Could not close PR #${prInfo.number}: ${closeResult.error}`))
          }
        }
      }

      // --- Step 3: Move ticket to dropped state ---
      let ticketMoved = false
      let targetColumn: string | undefined

      if (!flags['no-transition']) {
        try {
          const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
          if (fs.existsSync(dbPath)) {
            const storage = new SQLiteStorage(dbPath)
            try {
              const ticket = await storage.getTicket(ticketId)
              if (ticket) {
                const transition = await moveTicketByIntent({
                  db,
                  storage: storage as unknown as import('../../lib/providers/types.js').ProviderStorage,
                  ticket,
                  intent: 'dropped',
                  providerName: 'pmo',
                })
                if (transition.moved) {
                  ticketMoved = true
                  targetColumn = transition.targetColumn
                  if (!jsonMode) {
                    this.log(styles.muted(`   Ticket moved to: ${transition.targetColumn}`))
                  }
                }
              }
            } finally {
              await storage.close()
            }
          }
        } catch {
          // Non-fatal — don't block work drop for transition failures
        }
      }

      // Track primitive completion
      trackPrimitiveExecuted({ primitive: 'drop', durationMs: Date.now() - startTime, success: true })

      if (jsonMode) {
        outputSuccessAsJson({
          ticketId,
          executionId: execution?.id ?? null,
          agentName: agentName ?? null,
          status: 'dropped',
          agentKilled,
          prClosed,
          prNumber: prNumber ?? null,
          ticketMoved,
          targetColumn: targetColumn ?? null,
        }, createMetadata('work drop', flags))
        return
      }

      this.log(styles.success(`Dropped: ${ticketId}`))
      if (!agentKilled && !execution) {
        this.log(styles.muted('   No running agent found'))
      }
      if (!prClosed && !prNumber) {
        this.log(styles.muted('   No open PR found'))
      }
    } finally {
      db.close()
    }
  }
}
