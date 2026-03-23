/**
 * Session Report Command (PRLT-1061)
 *
 * Called by Claude Code stop hook when an agent session ends.
 * Reads the execution record and cleanup policy to determine
 * whether to remove the container, update ticket status, and
 * log telemetry events.
 *
 * Usage (from stop hook):
 *   prlt session report --agent bold-turing --status exited
 */

import { Flags } from '@oclif/core'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { SqliteDatabase } from '../../lib/database/sqlite.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import { cleanupAgentContainer } from '../../lib/execution/container-cleanup.js'
import { trackEvent } from '../../lib/telemetry/analytics.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

type ReportStatus = 'started' | 'completed' | 'errored' | 'exited'

const VALID_STATUSES: ReadonlySet<string> = new Set(['started', 'completed', 'errored', 'exited'])

export default class SessionReport extends PMOCommand {
  static description = 'Report agent session lifecycle events and trigger cleanup'

  static examples = [
    '<%= config.bin %> session report --agent bold-turing --status exited',
    '<%= config.bin %> session report --agent bold-turing --status completed',
    '<%= config.bin %> session report --agent bold-turing --status errored',
  ]

  static flags = {
    ...pmoBaseFlags,
    agent: Flags.string({
      description: 'Agent name',
      required: true,
    }),
    status: Flags.string({
      description: 'Session status (started, completed, errored, exited)',
      required: true,
      options: ['started', 'completed', 'errored', 'exited'],
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(SessionReport)
    const jsonMode = shouldOutputJson(flags)
    const agentName = flags.agent
    const status = flags.status as ReportStatus

    if (!VALID_STATUSES.has(status)) {
      if (jsonMode) {
        outputErrorAsJson('INVALID_STATUS', `Invalid status: ${status}. Must be one of: started, completed, errored, exited`, createMetadata('session report', flags))
        return
      }
      this.error(`Invalid status: ${status}. Must be one of: started, completed, errored, exited`)
      return
    }

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace.', createMetadata('session report', flags))
        return
      }
      this.error('Not in a workspace.')
      return
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new SqliteDatabase(dbPath)
    const executionStorage = new ExecutionStorage(db)
    let needsSelfTerminate = false

    try {
      // Find the most recent execution for this agent
      const executions = executionStorage.getAgentRunningExecutions(agentName)

      if (executions.length === 0) {
        // No running executions — might be already cleaned up or stale
        // Track the event anyway for observability
        trackEvent('agent_session_report', null, {
          agent_name: agentName,
          report_status: status,
          action: 'no_execution_found',
        })

        if (jsonMode) {
          outputSuccessAsJson({
            message: `No running executions found for agent ${agentName}`,
            action: 'none',
          }, createMetadata('session report', flags))
          return
        }
        this.log(`No running executions found for agent ${agentName}`)
        return
      }

      // Use the most recent execution
      const execution = executions[0]
      const cleanupPolicy = execution.cleanupPolicy || 'on-exit'

      // Map report status to execution status
      let executionStatus: 'completed' | 'failed' | 'stopped'
      switch (status) {
        case 'completed':
          executionStatus = 'completed'
          break
        case 'errored':
          executionStatus = 'failed'
          break
        case 'exited':
        case 'started':
        default:
          executionStatus = 'stopped'
          break
      }

      // Update execution status
      executionStorage.updateStatus(execution.id, executionStatus)

      // Determine cleanup action based on policy
      let shouldCleanup = false
      let cleanupReason = ''

      switch (cleanupPolicy) {
        case 'on-exit':
          shouldCleanup = true
          cleanupReason = 'cleanup policy is on-exit'
          break
        case 'persistent':
          shouldCleanup = false
          cleanupReason = 'cleanup policy is persistent'
          break
        case 'on-error-keep':
          if (executionStatus === 'failed') {
            shouldCleanup = false
            cleanupReason = 'cleanup policy is on-error-keep and execution failed'
          } else {
            shouldCleanup = true
            cleanupReason = 'cleanup policy is on-error-keep and execution succeeded'
          }
          break
      }

      // Perform container cleanup if needed
      // First try docker rm -f (works when Docker socket is available, e.g., orchestrator containers).
      // If that fails (regular agent containers don't have Docker socket), signal the
      // container to stop by killing PID 1 (the sleep infinity process) after the report
      // completes. The stopped container will be removed by the next host-side cleanup.
      let cleanupResult: { success: boolean; error?: string } = { success: true }
      if (shouldCleanup) {
        cleanupResult = cleanupAgentContainer(agentName)
        if (!cleanupResult.success && process.env.DEVCONTAINER === 'true') {
          // Running inside a container without Docker socket — schedule self-termination
          needsSelfTerminate = true
          // Treat as success since the container will stop after this command finishes
          cleanupResult = { success: true }
        }
      }

      // Track telemetry event for agent lifecycle
      trackEvent('agent_session_report', null, {
        agent_name: agentName,
        report_status: status,
        execution_id: execution.id,
        ticket_id: execution.ticketId,
        cleanup_policy: cleanupPolicy,
        cleanup_performed: String(shouldCleanup),
        cleanup_success: String(cleanupResult.success),
        execution_status: executionStatus,
        environment: execution.environment,
        executor: execution.executor,
      })

      // Build result
      const result = {
        executionId: execution.id,
        ticketId: execution.ticketId,
        agentName,
        reportedStatus: status,
        executionStatus,
        cleanupPolicy,
        cleanupPerformed: shouldCleanup,
        cleanupReason,
        cleanupSuccess: cleanupResult.success,
        cleanupError: cleanupResult.error,
      }

      if (jsonMode) {
        outputSuccessAsJson(result, createMetadata('session report', flags))
        return
      }

      this.log(`Session report for ${agentName}:`)
      this.log(`  Execution: ${execution.id} (${execution.ticketId})`)
      this.log(`  Status: ${status} → ${executionStatus}`)
      this.log(`  Cleanup policy: ${cleanupPolicy}`)
      if (shouldCleanup) {
        if (cleanupResult.success) {
          this.log(`  Container: removed (${cleanupReason})`)
        } else {
          this.log(`  Container: cleanup failed - ${cleanupResult.error}`)
        }
      } else {
        this.log(`  Container: kept (${cleanupReason})`)
      }
    } finally {
      db.close()

      // Self-terminate the container if cleanup was requested but Docker wasn't available.
      // This kills the PID 1 process (sleep infinity) which stops the container.
      // Done after db.close() to ensure clean shutdown.
      if (needsSelfTerminate) {
        try {
          execSync('kill 1', { stdio: 'pipe' })
        } catch {
          // Best-effort — container may not allow killing PID 1
        }
      }
    }
  }
}
