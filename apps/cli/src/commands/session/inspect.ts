import { Args, Flags } from '@oclif/core'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { SqliteDatabase } from '../../lib/database/sqlite.js'
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

// =============================================================================
// Types
// =============================================================================

interface InspectResult {
  agent: {
    name: string
    ticketId: string
    executionId: string
    sessionId: string
    environment: 'host' | 'container'
    containerId?: string
    status: string
    startedAt: string
    branch?: string
  }
  git: {
    branch: string
    uncommittedChanges: number
    commitsAheadOfMain: number
    status: string
  } | null
  pr: {
    number: number
    state: string
    url: string
    ciStatus: string
  } | null
  process: {
    alive: boolean
    pid?: string
    lastOutputLines: string[]
  }
  execution: {
    id: string
    executor: string
    permissionMode: string
    displayMode: string
    sessionId: string
    startedAt: string
    elapsed: string
  }
  worktree: {
    path: string
    state: string
  } | null
}

// =============================================================================
// Helpers
// =============================================================================

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
 * Get git status info for the agent's worktree.
 */
function getGitInfo(worktreePath: string, containerId?: string): InspectResult['git'] {
  const gitDir = containerId ? '/workspace' : worktreePath

  const branch = runInContext(`git -C "${gitDir}" branch --show-current 2>/dev/null`, containerId)
  if (!branch) return null

  const statusOutput = runInContext(`git -C "${gitDir}" status --porcelain 2>/dev/null`, containerId)
  const uncommittedChanges = statusOutput ? statusOutput.split('\n').filter(l => l.trim()).length : 0

  const aheadOutput = runInContext(
    `git -C "${gitDir}" rev-list --count main..HEAD 2>/dev/null || git -C "${gitDir}" rev-list --count origin/main..HEAD 2>/dev/null || echo 0`,
    containerId,
  )
  const commitsAheadOfMain = parseInt(aheadOutput || '0', 10) || 0

  const statusSummary = runInContext(`git -C "${gitDir}" status --short 2>/dev/null`, containerId) || ''

  return {
    branch,
    uncommittedChanges,
    commitsAheadOfMain,
    status: statusSummary,
  }
}

/**
 * Get PR info for the agent's branch.
 */
function getPrInfo(branch: string, containerId?: string): InspectResult['pr'] {
  const prJson = runInContext(
    `gh pr view "${branch}" --json number,state,url,statusCheckRollup 2>/dev/null`,
    containerId,
  )
  if (!prJson) return null

  try {
    const pr = JSON.parse(prJson)
    let ciStatus = 'unknown'
    if (pr.statusCheckRollup && Array.isArray(pr.statusCheckRollup)) {
      const checks = pr.statusCheckRollup as Array<{ conclusion?: string; status?: string }>
      if (checks.length === 0) {
        ciStatus = 'none'
      } else if (checks.every((c: { conclusion?: string }) => c.conclusion === 'SUCCESS')) {
        ciStatus = 'passing'
      } else if (checks.some((c: { conclusion?: string }) => c.conclusion === 'FAILURE')) {
        ciStatus = 'failing'
      } else {
        ciStatus = 'pending'
      }
    }

    return {
      number: pr.number,
      state: pr.state,
      url: pr.url,
      ciStatus,
    }
  } catch {
    return null
  }
}

/**
 * Check if the process inside the tmux session is alive.
 */
function checkProcessLiveness(sessionId: string, containerId?: string): boolean {
  // Check if tmux session has running processes
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
  static description = 'Comprehensive agent status inspection (git, PR, process, output) in one call'

  static examples = [
    '<%= config.bin %> session inspect altman',
    '<%= config.bin %> session inspect TKT-123',
    '<%= config.bin %> session inspect altman --lines 50',
    '<%= config.bin %> session inspect altman --json',
  ]

  static args = {
    target: Args.string({
      description: 'Agent name or ticket ID',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    lines: Flags.integer({
      char: 'l',
      description: 'Number of output lines to include',
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

    // Resolve the agent's active session
    let executionStorage: ExecutionStorage | null = null
    let db: SqliteDatabase | null = null

    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new SqliteDatabase(dbPath)
      executionStorage = new ExecutionStorage(db)
    } catch {
      if (jsonMode) {
        outputErrorAsJson(
          'NOT_IN_WORKSPACE',
          'Not in a workspace. Run from a proletariat HQ directory.',
          createMetadata('session inspect', flags),
        )
        return
      } else {
        this.log('')
        this.log(styles.error('Not in a workspace. Run from a proletariat HQ directory.'))
        this.log('')
      }
      return
    }

    try {
      // Get active executions
      const runningExecutions = executionStorage.listExecutions({ status: 'running' })
      const startingExecutions = executionStorage.listExecutions({ status: 'starting' })
      const activeExecutions = [...runningExecutions, ...startingExecutions]

      // Find matching execution
      let match = activeExecutions.find(exec =>
        exec.agentName === target || exec.ticketId === target,
      )

      // Try partial match
      if (!match) {
        match = activeExecutions.find(exec =>
          exec.agentName.includes(target) || exec.ticketId.includes(target.toUpperCase()),
        )
      }

      if (!match) {
        if (jsonMode) {
          outputErrorAsJson(
            'NO_ACTIVE_EXECUTION',
            `No active session found for "${target}".`,
            createMetadata('session inspect', flags),
          )
          return
        } else {
          this.log('')
          this.log(styles.error(`No active session found for "${target}".`))
          this.log(styles.muted('Use `prlt session list` to see running sessions.'))
          this.log('')
        }
        return
      }

      // Resolve tmux session
      const isContainer = match.environment === 'devcontainer'
      let actualSessionId = match.sessionId
      let containerId = isContainer ? match.containerId : undefined

      if (!match.sessionId) {
        const hostTmuxSessions = getHostTmuxSessionNames()
        const containerTmuxSessions = getContainerTmuxSessionMap()

        if (isContainer && match.containerId) {
          const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, match.containerId)
          const found = findSessionForExecution(match.ticketId, match.agentName, containerSessions)
          if (found) {
            actualSessionId = found
            containerId = match.containerId
          }
        } else {
          const found = findSessionForExecution(match.ticketId, match.agentName, hostTmuxSessions)
          if (found) actualSessionId = found
        }
      }

      if (!actualSessionId) {
        if (jsonMode) {
          outputErrorAsJson(
            'SESSION_NOT_FOUND',
            `Could not find tmux session for agent "${match.agentName}".`,
            createMetadata('session inspect', flags),
          )
          return
        } else {
          this.log('')
          this.log(styles.error(`Could not find tmux session for agent "${match.agentName}".`))
          this.log('')
        }
        return
      }

      // Gather all inspection data
      const paneContent = captureTmuxPane(actualSessionId, flags.lines, containerId)
      const lastOutputLines = paneContent ? paneContent.split('\n') : []
      const alive = checkProcessLiveness(actualSessionId, containerId)

      // Get worktree path from agent directory
      const workspaceInfo = getWorkspaceInfo()
      const worktreePath = path.join(workspaceInfo.path, 'agents', 'temp', match.agentName)

      const gitInfo = getGitInfo(worktreePath, containerId)
      const prInfo = gitInfo?.branch ? getPrInfo(gitInfo.branch, containerId) : null

      const result: InspectResult = {
        agent: {
          name: match.agentName,
          ticketId: match.ticketId,
          executionId: match.id,
          sessionId: actualSessionId,
          environment: isContainer ? 'container' : 'host',
          containerId,
          status: match.status,
          startedAt: match.startedAt.toISOString(),
          branch: match.branch,
        },
        git: gitInfo,
        pr: prInfo,
        process: {
          alive,
          pid: match.pid,
          lastOutputLines,
        },
        execution: {
          id: match.id,
          executor: match.executor,
          permissionMode: match.permissionMode,
          displayMode: match.displayMode,
          sessionId: actualSessionId,
          startedAt: match.startedAt.toISOString(),
          elapsed: formatElapsed(match.startedAt),
        },
        worktree: {
          path: worktreePath,
          state: alive ? 'active' : 'idle',
        },
      }

      if (jsonMode) {
        outputSuccessAsJson(result as unknown as Record<string, unknown>, createMetadata('session inspect', flags))
        return
      }

      // Human-readable output
      this.log('')
      this.log(styles.header(`Agent Inspection: ${match.agentName}`))
      this.log('='.repeat(70))

      // Agent info
      this.log('')
      this.log(styles.info('  Agent'))
      this.log(`    Name:         ${match.agentName}`)
      this.log(`    Ticket:       ${match.ticketId}`)
      this.log(`    Execution:    ${match.id}`)
      this.log(`    Session:      ${actualSessionId}`)
      this.log(`    Environment:  ${isContainer ? 'container' : 'host'}${containerId ? ` (${containerId.substring(0, 12)})` : ''}`)
      this.log(`    Status:       ${match.status}`)
      this.log(`    Started:      ${match.startedAt.toISOString()}`)
      this.log(`    Elapsed:      ${formatElapsed(match.startedAt)}`)

      // Git info
      if (gitInfo) {
        this.log('')
        this.log(styles.info('  Git'))
        this.log(`    Branch:       ${gitInfo.branch}`)
        this.log(`    Uncommitted:  ${gitInfo.uncommittedChanges} file(s)`)
        this.log(`    Ahead of main: ${gitInfo.commitsAheadOfMain} commit(s)`)
      }

      // PR info
      if (prInfo) {
        this.log('')
        this.log(styles.info('  Pull Request'))
        this.log(`    PR #${prInfo.number}: ${prInfo.state}`)
        this.log(`    CI:           ${prInfo.ciStatus}`)
        this.log(`    URL:          ${prInfo.url}`)
      }

      // Process info
      this.log('')
      this.log(styles.info('  Process'))
      this.log(`    Alive:        ${alive ? styles.success('yes') : styles.error('no')}`)
      if (match.pid) {
        this.log(`    PID:          ${match.pid}`)
      }

      // Last output
      if (lastOutputLines.length > 0) {
        this.log('')
        this.log(styles.info(`  Last ${Math.min(lastOutputLines.length, 10)} lines of output`))
        const displayLines = lastOutputLines.slice(-10)
        for (const line of displayLines) {
          this.log(styles.muted(`    ${line}`))
        }
      }

      this.log('')
      this.log('='.repeat(70))
      this.log('')
    } finally {
      db?.close()
    }
  }
}
