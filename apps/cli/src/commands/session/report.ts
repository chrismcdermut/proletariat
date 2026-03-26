/**
 * Session Report Command (PRLT-1061, PRLT-1129)
 *
 * Called by Claude Code stop hook when an agent session ends.
 * Reads the execution record and cleanup policy to determine
 * whether to remove the container, update ticket status, and
 * log telemetry events.
 *
 * PRLT-1129: Safety net — when an agent exits without proposing,
 * checks for uncommitted changes (warns) and commits without a PR
 * (auto-proposes via `prlt work propose`).
 *
 * Usage (from stop hook):
 *   prlt session report --agent bold-turing --status exited
 */

import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { ExecutionStorage, type AgentWork } from '../../lib/execution/index.js'
import { cleanupAgentContainer } from '../../lib/execution/container-cleanup.js'
import { trackEvent } from '../../lib/telemetry/analytics.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

interface SafetyNetResult {
  hasUncommittedChanges: boolean
  hasCommitsWithoutPR: boolean
  autoProposed: boolean
  autoProposeFailed: boolean
  error?: string
}

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
    const db = openWorkspaceDatabase(workspaceInfo.path)
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

      // PRLT-1129: Safety net — catch agents that exit without proposing work.
      // Runs before status update so we can upgrade 'stopped' → 'completed' if auto-propose succeeds.
      let safetyNetResult: SafetyNetResult | undefined
      if (status === 'exited' && execution.ticketId) {
        safetyNetResult = this.runSafetyNet(execution)

        // If auto-propose succeeded, upgrade execution status
        if (safetyNetResult.autoProposed) {
          executionStatus = 'completed'
        }

        // Track safety net telemetry
        trackEvent('agent_safety_net', null, {
          agent_name: agentName,
          ticket_id: execution.ticketId,
          has_uncommitted_changes: String(safetyNetResult.hasUncommittedChanges),
          has_commits_without_pr: String(safetyNetResult.hasCommitsWithoutPR),
          auto_proposed: String(safetyNetResult.autoProposed),
          auto_propose_failed: String(safetyNetResult.autoProposeFailed),
          error: safetyNetResult.error || '',
        })
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
        safetyNet: safetyNetResult,
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
      if (safetyNetResult) {
        if (safetyNetResult.hasUncommittedChanges) {
          this.log(`  ⚠ Safety net: uncommitted changes detected`)
        }
        if (safetyNetResult.autoProposed) {
          this.log(`  ✓ Safety net: auto-proposed work (PR created)`)
        } else if (safetyNetResult.autoProposeFailed) {
          this.log(`  ⚠ Safety net: auto-propose failed — ${safetyNetResult.error}`)
        }
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

  /**
   * Safety net: detect abandoned work and auto-propose (PRLT-1129).
   *
   * When an agent exits without having explicitly called `prlt work propose`
   * or `prlt work ready`, this method checks:
   * 1. Uncommitted changes in workspace repos → warn
   * 2. Commits on feature branch with no PR → auto-propose
   *
   * This is best-effort — failures are logged but never block cleanup.
   */
  private runSafetyNet(execution: AgentWork): SafetyNetResult {
    const result: SafetyNetResult = {
      hasUncommittedChanges: false,
      hasCommitsWithoutPR: false,
      autoProposed: false,
      autoProposeFailed: false,
    }

    try {
      // Find repo directories in workspace (same pattern as work/ready.ts)
      const repoDirs = this.findWorkspaceRepoDirs()
      if (repoDirs.length === 0) return result

      for (const repoDir of repoDirs) {
        // Check for uncommitted changes
        try {
          const status = execSync('git status --porcelain', {
            cwd: repoDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf-8',
          }).trim()
          if (status) {
            result.hasUncommittedChanges = true
          }
        } catch {
          // git not available or not a repo — skip
          continue
        }

        // Check if we're on a feature branch with commits but no PR
        try {
          const branch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: repoDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf-8',
          }).trim()

          // Skip if on main/master or detached HEAD
          if (!branch || branch === 'HEAD' || branch === 'main' || branch === 'master') {
            continue
          }

          // Check for commits ahead of the default branch
          let baseBranch = 'main'
          try {
            execSync('git rev-parse --verify origin/main', {
              cwd: repoDir,
              stdio: ['pipe', 'pipe', 'pipe'],
            })
          } catch {
            baseBranch = 'master'
          }

          const commitCount = execSync(`git rev-list --count origin/${baseBranch}..HEAD`, {
            cwd: repoDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf-8',
          }).trim()

          if (parseInt(commitCount, 10) === 0) {
            // No commits ahead — nothing to propose
            continue
          }

          // Check if a PR already exists for this branch
          try {
            const prState = execSync(`gh pr view "${branch}" --json state --jq '.state'`, {
              cwd: repoDir,
              stdio: ['pipe', 'pipe', 'pipe'],
              encoding: 'utf-8',
            }).trim()

            if (prState === 'OPEN' || prState === 'MERGED') {
              // PR already exists — agent likely proposed normally
              continue
            }
          } catch {
            // No PR found — this is the case we want to catch
          }

          // Agent has commits but no PR — auto-propose
          result.hasCommitsWithoutPR = true

          // Push any unpushed commits first
          try {
            execSync(`git push origin HEAD`, {
              cwd: repoDir,
              stdio: ['pipe', 'pipe', 'pipe'],
            })
          } catch {
            // Push may fail if already pushed or no remote — continue with propose
          }

          // Auto-propose via prlt work propose
          const ticketId = execution.ticketId
          try {
            execSync(`prlt work propose ${ticketId}`, {
              cwd: repoDir,
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: 30000, // 30s timeout for safety
            })
            result.autoProposed = true
          } catch (err) {
            result.autoProposeFailed = true
            result.error = err instanceof Error ? err.message : String(err)
          }
        } catch {
          // Git operations failed — skip this repo
          continue
        }
      }
    } catch (err) {
      // Top-level safety net failure — never block the report
      result.error = err instanceof Error ? err.message : String(err)
    }

    return result
  }

  /**
   * Find git repository directories in the workspace.
   * In devcontainers, repos live under /workspace/.
   * On host, uses the execution's worktree path.
   */
  private findWorkspaceRepoDirs(): string[] {
    const dirs: string[] = []

    if (process.env.DEVCONTAINER === 'true') {
      // Devcontainer: repos are under /workspace/
      try {
        const entries = fs.readdirSync('/workspace', { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            const candidate = path.join('/workspace', entry.name)
            // Verify it's a git repo
            if (fs.existsSync(path.join(candidate, '.git'))) {
              dirs.push(candidate)
            }
          }
        }
      } catch {
        // /workspace not readable — skip
      }
    } else {
      // Host mode: try current working directory
      const cwd = process.cwd()
      if (fs.existsSync(path.join(cwd, '.git'))) {
        dirs.push(cwd)
      }
    }

    return dirs
  }
}
