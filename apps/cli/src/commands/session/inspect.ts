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
  }
  execution: {
    status: string
    startedAt: string
    elapsed: string
    executor: string
    displayMode: string
    permissionMode: string
    branch?: string
    logPath?: string
  }
  git: {
    branch: string
    uncommittedChanges: boolean
    commitsAheadOfMain: number
    worktreePath?: string
  } | null
  pr: {
    number: number
    state: string
    url: string
    ciStatus?: string
  } | null
  process: {
    alive: boolean
    pid?: string
  }
  output: {
    lastLines: string
    lineCount: number
  }
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
 * Run a shell command in an agent's worktree (or container).
 * Returns stdout or null on failure.
 */
function runInContext(command: string, worktreePath?: string, containerId?: string): string | null {
  try {
    if (containerId) {
      return execSync(
        `docker exec ${containerId} bash -c '${command}'`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 },
      ).trim()
    }
    return execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
      cwd: worktreePath || undefined,
    }).trim()
  } catch {
    return null
  }
}

/**
 * Check if a process (Claude Code) is running in a tmux session.
 */
function isProcessAlive(sessionId: string, containerId?: string): boolean {
  const cmd = `tmux list-panes -t "${sessionId}" -F "#{pane_pid}" 2>/dev/null`
  const result = runInContext(cmd, undefined, containerId)
  if (!result) return false

  // Check if the pane PID has child processes (Claude Code would be a child)
  const pid = result.trim().split('\n')[0]
  if (!pid) return false

  const childCheck = containerId
    ? `pgrep -P ${pid} 2>/dev/null`
    : `pgrep -P ${pid} 2>/dev/null`
  const children = runInContext(childCheck, undefined, containerId)
  return children !== null && children.trim().length > 0
}

/**
 * Get git info from a worktree path.
 */
function getGitInfo(worktreePath: string, containerId?: string): InspectResult['git'] {
  const branch = runInContext('git rev-parse --abbrev-ref HEAD 2>/dev/null', worktreePath, containerId)
  if (!branch) return null

  const statusOutput = runInContext('git status --porcelain 2>/dev/null', worktreePath, containerId)
  const uncommittedChanges = statusOutput !== null && statusOutput.length > 0

  // Count commits ahead of main
  let commitsAhead = 0
  const aheadOutput = runInContext('git rev-list --count main..HEAD 2>/dev/null || git rev-list --count origin/main..HEAD 2>/dev/null || echo 0', worktreePath, containerId)
  if (aheadOutput) {
    commitsAhead = parseInt(aheadOutput, 10) || 0
  }

  return {
    branch,
    uncommittedChanges,
    commitsAheadOfMain: commitsAhead,
    worktreePath,
  }
}

/**
 * Get PR info for a branch.
 */
function getPRInfo(branch: string, worktreePath?: string, containerId?: string): InspectResult['pr'] {
  const prJson = runInContext(
    `gh pr view --json number,state,url,statusCheckRollup --jq '{number,state,url,ciStatus: (.statusCheckRollup | if . then (if all(.conclusion == "SUCCESS") then "passing" elif any(.conclusion == "FAILURE") then "failing" else "pending" end) else "unknown" end)}' 2>/dev/null`,
    worktreePath,
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

// =============================================================================
// Command
// =============================================================================

export default class SessionInspect extends PMOCommand {
  static description = 'Get comprehensive agent status in a single call (git, PR, process, output)'

  static examples = [
    '<%= config.bin %> session inspect altman',
    '<%= config.bin %> session inspect TKT-123',
    '<%= config.bin %> session inspect altman --lines 200',
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

    // Resolve agent session
    let executionStorage: ExecutionStorage | null = null
    let db: Database.Database | null = null

    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new Database(dbPath)
      executionStorage = new ExecutionStorage(db)
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run from a proletariat HQ directory.', createMetadata('session inspect', flags))
        return
      }
      this.error('Not in a workspace. Run from a proletariat HQ directory.')
    }

    try {
      // Get active executions
      const runningExecutions = executionStorage.listExecutions({ status: 'running' })
      const startingExecutions = executionStorage.listExecutions({ status: 'starting' })
      const activeExecutions = [...runningExecutions, ...startingExecutions]

      // Find matching execution
      const exec = activeExecutions.find(e =>
        e.agentName === target || e.ticketId === target,
      )

      if (!exec) {
        if (jsonMode) {
          outputErrorAsJson('NO_ACTIVE_EXECUTION', `No active execution found for "${target}".`, createMetadata('session inspect', flags))
          return
        }
        this.error(`No active execution found for "${target}". Use \`prlt session list\` to see running sessions.`)
      }

      // Resolve tmux session
      const isContainer = exec.environment === 'devcontainer'
      let sessionId = exec.sessionId
      const containerId = isContainer ? exec.containerId : undefined

      if (!sessionId) {
        if (isContainer && exec.containerId) {
          const containerTmuxSessions = getContainerTmuxSessionMap()
          const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
          sessionId = findSessionForExecution(exec.ticketId, exec.agentName, containerSessions) || undefined
        } else {
          const hostTmuxSessions = getHostTmuxSessionNames()
          sessionId = findSessionForExecution(exec.ticketId, exec.agentName, hostTmuxSessions) || undefined
        }
      }

      // Get agent worktree path
      let worktreePath: string | undefined
      try {
        const workspaceInfo = getWorkspaceInfo()
        // Try to find the agent's worktree from workspace path
        if (exec.branch) {
          const branchWorktree = runInContext(
            `git worktree list --porcelain | grep -A2 "branch.*${exec.branch}" | head -1 | sed 's/worktree //'`,
            workspaceInfo.path,
            containerId,
          )
          if (branchWorktree) {
            worktreePath = branchWorktree
          }
        }
        // Fallback: look in agents directory
        if (!worktreePath) {
          const agentPath = path.join(workspaceInfo.path, 'agents', 'temp', exec.agentName)
          worktreePath = agentPath
        }
      } catch {
        // Workspace lookup failed
      }

      // Gather all info
      const gitInfo = worktreePath ? getGitInfo(worktreePath, containerId) : null
      const prInfo = gitInfo?.branch ? getPRInfo(gitInfo.branch, worktreePath, containerId) : null
      const alive = sessionId ? isProcessAlive(sessionId, containerId) : false
      const output = sessionId ? captureTmuxPane(sessionId, flags.lines, containerId) : null

      const result: InspectResult = {
        agent: {
          name: exec.agentName,
          ticketId: exec.ticketId,
          executionId: exec.id,
          sessionId: sessionId || 'unknown',
          environment: isContainer ? 'container' : 'host',
          containerId,
        },
        execution: {
          status: exec.status,
          startedAt: exec.startedAt.toISOString(),
          elapsed: formatElapsed(exec.startedAt),
          executor: exec.executor,
          displayMode: exec.displayMode,
          permissionMode: exec.permissionMode,
          branch: exec.branch,
          logPath: exec.logPath,
        },
        git: gitInfo,
        pr: prInfo,
        process: {
          alive,
          pid: exec.pid,
        },
        output: {
          lastLines: output || '',
          lineCount: output ? output.split('\n').length : 0,
        },
      }

      if (jsonMode) {
        outputSuccessAsJson(result as unknown as Record<string, unknown>, createMetadata('session inspect', flags))
        return
      }

      // Human-readable output
      this.log('')
      this.log(styles.header(`Agent Inspection: ${exec.agentName}`))
      this.log('═'.repeat(70))

      // Agent info
      this.log(`  Ticket:      ${exec.ticketId}`)
      this.log(`  Execution:   ${exec.id}`)
      this.log(`  Session:     ${sessionId || 'not found'}`)
      this.log(`  Environment: ${isContainer ? `container (${containerId || 'unknown'})` : 'host'}`)
      this.log(`  Status:      ${exec.status}`)
      this.log(`  Elapsed:     ${formatElapsed(exec.startedAt)}`)
      this.log(`  Process:     ${alive ? styles.success('alive') : styles.error('not detected')}`)

      // Git info
      if (gitInfo) {
        this.log('')
        this.log(styles.header('Git Status'))
        this.log('─'.repeat(70))
        this.log(`  Branch:      ${gitInfo.branch}`)
        this.log(`  Changes:     ${gitInfo.uncommittedChanges ? styles.warning('uncommitted changes') : styles.success('clean')}`)
        this.log(`  Ahead:       ${gitInfo.commitsAheadOfMain} commit(s) ahead of main`)
        if (gitInfo.worktreePath) {
          this.log(`  Worktree:    ${gitInfo.worktreePath}`)
        }
      }

      // PR info
      if (prInfo) {
        this.log('')
        this.log(styles.header('Pull Request'))
        this.log('─'.repeat(70))
        this.log(`  PR #${prInfo.number}: ${prInfo.state}`)
        this.log(`  CI:          ${prInfo.ciStatus || 'unknown'}`)
        this.log(`  URL:         ${prInfo.url}`)
      }

      // Output
      if (output) {
        this.log('')
        this.log(styles.header(`Last ${flags.lines} Lines of Output`))
        this.log('─'.repeat(70))
        this.log(output)
      }

      this.log('')
    } finally {
      db?.close()
    }
  }
}
