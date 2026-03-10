import { Args, Flags } from '@oclif/core'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import {
  getHostTmuxSessionNames,
  getContainerTmuxSessionMap,
  findContainerSessionsByPrefix,
  findSessionForExecution,
  captureTmuxPane,
} from '../../lib/execution/session-utils.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import type { AgentWork } from '../../lib/execution/types.js'

// =============================================================================
// Types
// =============================================================================

interface InspectResult {
  // Execution metadata
  executionId: string
  ticketId: string
  agentName: string
  status: string
  environment: string
  executor: string
  startedAt: string
  elapsed: string
  sessionId: string
  containerId?: string
  branch?: string
  pid?: string
  logPath?: string

  // Git status
  git?: {
    branch: string
    uncommittedChanges: number
    commitsAheadOfMain: number
    worktreePath?: string
  }

  // PR status
  pr?: {
    number: number
    state: string
    url: string
    ciStatus?: string
  } | null

  // Process liveness
  processAlive: boolean

  // Last N lines of output
  output?: string
  outputLines: number

  // Worktree
  worktreePath?: string
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format elapsed time from a start date to now.
 */
function formatElapsed(startedAt: Date): string {
  const ms = Date.now() - startedAt.getTime()
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

/**
 * Run a shell command in the agent's context (host or container).
 * Returns stdout or null on failure.
 */
function runInContext(command: string, containerId?: string): string | null {
  try {
    if (containerId) {
      return execSync(
        `docker exec ${containerId} bash -c '${command.replace(/'/g, "'\\''")}'`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 },
      ).trim()
    }
    return execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim()
  } catch {
    return null
  }
}

/**
 * Get git status for an agent's worktree.
 */
function getGitStatus(worktreePath: string | undefined, containerId?: string): InspectResult['git'] | undefined {
  if (!worktreePath) return undefined

  const branch = runInContext(`git -C "${worktreePath}" rev-parse --abbrev-ref HEAD`, containerId)
  if (!branch) return undefined

  const statusOutput = runInContext(`git -C "${worktreePath}" status --porcelain`, containerId)
  const uncommittedChanges = statusOutput ? statusOutput.split('\n').filter(l => l.trim()).length : 0

  // Count commits ahead of main
  let commitsAheadOfMain = 0
  const aheadOutput = runInContext(
    `git -C "${worktreePath}" rev-list --count main..HEAD 2>/dev/null || git -C "${worktreePath}" rev-list --count origin/main..HEAD 2>/dev/null || echo 0`,
    containerId,
  )
  if (aheadOutput) {
    commitsAheadOfMain = parseInt(aheadOutput, 10) || 0
  }

  return {
    branch,
    uncommittedChanges,
    commitsAheadOfMain,
    worktreePath,
  }
}

/**
 * Get PR status for a branch.
 */
function getPRStatus(branch: string | undefined, worktreePath: string | undefined, containerId?: string): InspectResult['pr'] | null {
  if (!branch || !worktreePath) return null

  const prJson = runInContext(
    `cd "${worktreePath}" && gh pr view --json number,state,url,statusCheckRollup --jq '{number: .number, state: .state, url: .url, ciStatus: (.statusCheckRollup | if length > 0 then (if all(.conclusion == "SUCCESS") then "passing" elif any(.conclusion == "FAILURE") then "failing" else "pending" end) else "none" end)}' 2>/dev/null`,
    containerId,
  )

  if (!prJson) return null

  try {
    const pr = JSON.parse(prJson)
    return {
      number: pr.number,
      state: pr.state,
      url: pr.url,
      ciStatus: pr.ciStatus,
    }
  } catch {
    return null
  }
}

/**
 * Check if a tmux session has an active process.
 */
function isProcessAlive(sessionId: string, containerId?: string): boolean {
  const result = runInContext(
    `tmux list-panes -t "${sessionId}" -F "#{pane_pid}" 2>/dev/null`,
    containerId,
  )
  return result !== null && result.trim().length > 0
}

// =============================================================================
// Command
// =============================================================================

export default class SessionInspect extends PMOCommand {
  static description = 'Comprehensive agent status inspection — git, PR, process, output, and execution metadata in one call'

  static examples = [
    '<%= config.bin %> session inspect altman',
    '<%= config.bin %> session inspect TKT-123',
    '<%= config.bin %> session inspect altman --lines 50',
    '<%= config.bin %> session inspect altman --json',
  ]

  static args = {
    target: Args.string({
      description: 'Agent name, ticket ID (e.g. TKT-123), or execution ID (e.g. WORK-XXXXXXXX)',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    lines: Flags.integer({
      char: 'l',
      description: 'Number of output lines to capture',
      default: 100,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SessionInspect)
    const jsonMode = shouldOutputJson(flags)
    const { target } = args

    // Open DB
    let executionStorage: ExecutionStorage | null = null
    let db: Database.Database | null = null

    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new Database(dbPath)
      executionStorage = new ExecutionStorage(db)
    } catch {
      if (jsonMode) {
        outputErrorAsJson(
          'NOT_IN_WORKSPACE',
          'Not in a workspace. Run from a proletariat HQ directory.',
          createMetadata('session inspect', flags),
        )
        return
      }
      this.error('Not in a workspace. Run from a proletariat HQ directory.')
    }

    try {
      // Find the matching execution
      const execution = this.findExecution(target, executionStorage)

      if (!execution) {
        if (jsonMode) {
          outputErrorAsJson(
            'NO_ACTIVE_EXECUTION',
            `No active execution found for "${target}".`,
            createMetadata('session inspect', flags),
          )
          return
        }
        this.error(`No active execution found for "${target}". Use \`prlt session list\` to see running sessions.`)
      }

      // Resolve tmux session
      const sessionInfo = this.resolveSession(execution)

      // Build inspection result
      const result = this.buildInspectResult(execution, sessionInfo, flags.lines)

      if (jsonMode) {
        outputSuccessAsJson(result as unknown as Record<string, unknown>, createMetadata('session inspect', flags))
        return
      }

      // Pretty-print for humans
      this.displayInspectResult(result)
    } finally {
      db?.close()
    }
  }

  /**
   * Find execution matching the target identifier.
   */
  private findExecution(target: string, storage: ExecutionStorage): AgentWork | null {
    // Get active executions
    const running = storage.listExecutions({ status: 'running' })
    const starting = storage.listExecutions({ status: 'starting' })
    const active = [...running, ...starting]

    // Try execution ID first (WORK-XXX)
    if (target.toUpperCase().startsWith('WORK-')) {
      const exec = storage.getExecution(target.toUpperCase())
      if (exec) return exec
    }

    // Try ticket ID match
    if (/^[A-Z]+-\d+$/i.test(target)) {
      const ticketTarget = target.toUpperCase()
      const match = active.find(e => e.ticketId === ticketTarget)
      if (match) return match
    }

    // Try agent name match
    const agentMatch = active.find(e => e.agentName === target)
    if (agentMatch) return agentMatch

    // Orchestrator prefix
    if (target === 'orchestrator') {
      const orchMatch = active.find(e =>
        e.agentName === 'orchestrator' || e.agentName.startsWith('orchestrator-'),
      )
      if (orchMatch) return orchMatch
    }

    // Partial match
    return active.find(e =>
      e.agentName.includes(target) || e.ticketId.includes(target.toUpperCase()),
    ) || null
  }

  /**
   * Resolve the tmux session for an execution.
   */
  private resolveSession(exec: AgentWork): { sessionId: string | null; containerId?: string } {
    const isContainer = exec.environment === 'devcontainer'
    let actualSessionId = exec.sessionId || null
    let containerId = isContainer ? exec.containerId : undefined

    if (!exec.sessionId) {
      if (isContainer && exec.containerId) {
        const containerTmuxSessions = getContainerTmuxSessionMap()
        const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
        const match = findSessionForExecution(exec.ticketId, exec.agentName, containerSessions)
        if (match) {
          actualSessionId = match
          containerId = exec.containerId
        }
      } else {
        const hostTmuxSessions = getHostTmuxSessionNames()
        const match = findSessionForExecution(exec.ticketId, exec.agentName, hostTmuxSessions)
        if (match) {
          actualSessionId = match
        }
      }
    }

    return { sessionId: actualSessionId, containerId }
  }

  /**
   * Build the comprehensive inspection result.
   */
  private buildInspectResult(
    exec: AgentWork,
    sessionInfo: { sessionId: string | null; containerId?: string },
    outputLines: number,
  ): InspectResult {
    const { sessionId, containerId } = sessionInfo

    // Determine worktree path from branch info
    const worktreePath = this.guessWorktreePath(exec, containerId)

    // Capture output
    let output: string | undefined
    if (sessionId) {
      const captured = captureTmuxPane(sessionId, outputLines, containerId)
      output = captured || undefined
    }

    // Git status
    const git = getGitStatus(worktreePath, containerId)

    // PR status
    const pr = getPRStatus(git?.branch || exec.branch, worktreePath, containerId)

    // Process liveness
    const processAlive = sessionId ? isProcessAlive(sessionId, containerId) : false

    return {
      executionId: exec.id,
      ticketId: exec.ticketId,
      agentName: exec.agentName,
      status: exec.status,
      environment: exec.environment,
      executor: exec.executor,
      startedAt: exec.startedAt.toISOString(),
      elapsed: formatElapsed(exec.startedAt),
      sessionId: sessionId || 'unknown',
      containerId,
      branch: exec.branch,
      pid: exec.pid,
      logPath: exec.logPath,
      git,
      pr,
      processAlive,
      output,
      outputLines,
      worktreePath,
    }
  }

  /**
   * Try to determine the agent's worktree path.
   */
  private guessWorktreePath(exec: AgentWork, containerId?: string): string | undefined {
    // For containers, the workspace is typically /workspace
    if (exec.environment === 'devcontainer' && containerId) {
      const result = runInContext('ls -d /workspace/* 2>/dev/null | head -1', containerId)
      return result || '/workspace'
    }

    // For host, try to find from the agent's workspace
    try {
      const workspaceInfo = getWorkspaceInfo()
      const agentDir = path.join(workspaceInfo.path, 'agents', 'temp', exec.agentName)
      // Check if agent dir exists and has repos
      const result = runInContext(`ls -d "${agentDir}"/* 2>/dev/null | head -1`)
      return result || undefined
    } catch {
      return undefined
    }
  }

  /**
   * Display the inspection result in human-friendly format.
   */
  private displayInspectResult(result: InspectResult): void {
    this.log('')
    this.log(styles.header(`Session Inspect: ${result.agentName} (${result.ticketId})`))
    this.log('═'.repeat(70))

    // Execution metadata
    this.log('')
    this.log(styles.info('  Execution'))
    this.log(`  ID:          ${result.executionId}`)
    this.log(`  Status:      ${result.status}`)
    this.log(`  Environment: ${result.environment}`)
    this.log(`  Executor:    ${result.executor}`)
    this.log(`  Started:     ${result.startedAt}`)
    this.log(`  Elapsed:     ${result.elapsed}`)
    this.log(`  Session:     ${result.sessionId}`)
    if (result.containerId) this.log(`  Container:   ${result.containerId}`)
    if (result.branch) this.log(`  Branch:      ${result.branch}`)
    if (result.pid) this.log(`  PID:         ${result.pid}`)
    if (result.logPath) this.log(`  Log:         ${result.logPath}`)

    // Process liveness
    this.log('')
    this.log(styles.info('  Process'))
    this.log(`  Alive:       ${result.processAlive ? styles.success('Yes') : styles.error('No')}`)

    // Git status
    if (result.git) {
      this.log('')
      this.log(styles.info('  Git'))
      this.log(`  Branch:      ${result.git.branch}`)
      this.log(`  Uncommitted: ${result.git.uncommittedChanges}`)
      this.log(`  Ahead:       ${result.git.commitsAheadOfMain} commits ahead of main`)
      if (result.git.worktreePath) this.log(`  Worktree:    ${result.git.worktreePath}`)
    }

    // PR status
    if (result.pr) {
      this.log('')
      this.log(styles.info('  Pull Request'))
      this.log(`  PR #${result.pr.number}: ${result.pr.state}`)
      this.log(`  URL:         ${result.pr.url}`)
      if (result.pr.ciStatus) this.log(`  CI:          ${result.pr.ciStatus}`)
    } else if (result.pr === null) {
      this.log('')
      this.log(styles.muted('  No pull request found'))
    }

    // Last output
    if (result.output) {
      this.log('')
      this.log(styles.info(`  Output (last ${result.outputLines} lines)`))
      this.log('  ' + '─'.repeat(68))
      // Show last 20 lines in compact view
      const lines = result.output.split('\n')
      const displayLines = lines.slice(-20)
      for (const line of displayLines) {
        this.log(`  ${line}`)
      }
      if (lines.length > 20) {
        this.log(styles.muted(`  ... (${lines.length - 20} more lines, use --json for full output)`))
      }
    }

    this.log('')
    this.log('═'.repeat(70))
    this.log('')
  }
}
