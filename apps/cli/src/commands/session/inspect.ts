import { Args, Flags } from '@oclif/core'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import {
  parseSessionName,
  getHostTmuxSessionNames,
  getContainerTmuxSessionMap,
  flattenContainerSessions,
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

interface VerifiedSession {
  sessionId: string
  ticketId: string
  agentName: string
  environment: 'host' | 'container'
  containerId?: string
  source: 'db' | 'discovered'
  executionId?: string
  branch?: string
  status?: string
  startedAt?: Date
  pid?: string
  logPath?: string
}

interface GitStatus {
  branch: string
  uncommittedChanges: number
  commitsAheadOfMain: number
  hasUnpushedCommits: boolean
}

interface PRStatus {
  number: number | null
  state: string | null
  url: string | null
  ciStatus: string | null
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Run a shell command in an agent's worktree/container context.
 */
function runInContext(command: string, containerId?: string, timeoutMs = 10000): string | null {
  try {
    if (containerId) {
      return execSync(
        `docker exec ${containerId} bash -c '${command.replace(/'/g, "'\\''")}'`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: timeoutMs },
      ).trim()
    }
    return execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    }).trim()
  } catch {
    return null
  }
}

/**
 * Check if tmux session has an active running process (not just a shell prompt).
 */
function checkProcessLiveness(sessionId: string, containerId?: string): boolean {
  // Check if there's a foreground process in the tmux pane
  const pidOutput = runInContext(
    `tmux list-panes -t "${sessionId}" -F "#{pane_pid}" 2>/dev/null`,
    containerId,
  )
  if (!pidOutput) return false

  const panePid = pidOutput.trim().split('\n')[0]
  if (!panePid) return false

  // Check if the process has children (meaning something is running beyond the shell)
  const childCheck = runInContext(
    `pgrep -P ${panePid} 2>/dev/null | head -1`,
    containerId,
  )
  return childCheck !== null && childCheck.trim().length > 0
}

/**
 * Get git status for the agent's worktree.
 */
function getGitStatus(branch: string | undefined, containerId?: string): GitStatus | null {
  if (!branch) return null

  const gitBranch = runInContext('git rev-parse --abbrev-ref HEAD 2>/dev/null', containerId)
  if (!gitBranch) return null

  const diffOutput = runInContext('git status --porcelain 2>/dev/null | wc -l', containerId)
  const uncommittedChanges = diffOutput ? parseInt(diffOutput.trim(), 10) : 0

  const aheadOutput = runInContext('git rev-list --count main..HEAD 2>/dev/null', containerId)
  const commitsAheadOfMain = aheadOutput ? parseInt(aheadOutput.trim(), 10) : 0

  const unpushedOutput = runInContext(
    `git rev-list --count @{upstream}..HEAD 2>/dev/null`,
    containerId,
  )
  const hasUnpushedCommits = unpushedOutput ? parseInt(unpushedOutput.trim(), 10) > 0 : false

  return {
    branch: gitBranch,
    uncommittedChanges,
    commitsAheadOfMain,
    hasUnpushedCommits,
  }
}

/**
 * Get PR status if agent created one.
 */
function getPRStatus(branch: string | undefined, containerId?: string): PRStatus | null {
  if (!branch) return null

  const prJson = runInContext(
    `gh pr view --json number,state,url,statusCheckRollup 2>/dev/null`,
    containerId,
    15000,
  )
  if (!prJson) return null

  try {
    const pr = JSON.parse(prJson)
    let ciStatus: string | null = null
    if (pr.statusCheckRollup && pr.statusCheckRollup.length > 0) {
      const states = pr.statusCheckRollup.map((c: { conclusion?: string; status?: string }) =>
        c.conclusion || c.status || 'unknown',
      )
      if (states.every((s: string) => s === 'SUCCESS' || s === 'NEUTRAL' || s === 'SKIPPED')) {
        ciStatus = 'passing'
      } else if (states.some((s: string) => s === 'FAILURE' || s === 'ERROR')) {
        ciStatus = 'failing'
      } else {
        ciStatus = 'pending'
      }
    }
    return {
      number: pr.number || null,
      state: pr.state || null,
      url: pr.url || null,
      ciStatus,
    }
  } catch {
    return null
  }
}

// =============================================================================
// Command
// =============================================================================

export default class SessionInspect extends PMOCommand {
  static description = 'Comprehensive agent status inspection — git, PR, process, output in one call'

  static examples = [
    '<%= config.bin %> session inspect altman',
    '<%= config.bin %> session inspect TKT-123',
    '<%= config.bin %> session inspect altman --lines 200',
    '<%= config.bin %> session inspect altman --json',
  ]

  static args = {
    target: Args.string({
      description: 'Agent name, ticket ID (e.g. TKT-123), or execution ID (e.g. WORK-XXXXXXXX)',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    lines: Flags.integer({
      char: 'l',
      description: 'Number of scrollback lines to capture',
      default: 100,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SessionInspect)
    const jsonMode = shouldOutputJson(flags)

    const sessions = this.getVerifiedSessions()

    if (sessions.length === 0) {
      if (jsonMode) {
        outputErrorAsJson(
          'NO_SESSIONS',
          'No active sessions found.',
          createMetadata('session inspect', flags),
        )
        return
      }
      this.log('')
      this.log(styles.muted('No active sessions found.'))
      this.log(styles.muted('Start work with: prlt work start <ticket-id>'))
      this.log('')
      return
    }

    let session: VerifiedSession | undefined

    if (args.target) {
      const matched = this.resolveTarget(args.target, sessions)
      if (matched.length === 0) {
        if (jsonMode) {
          outputErrorAsJson(
            'SESSION_NOT_FOUND',
            `No matching session found for "${args.target}".`,
            createMetadata('session inspect', flags),
          )
          return
        }
        this.error(`No matching session found for "${args.target}". Run "prlt session list" to see available sessions.`)
      }
      session = matched[0]
    } else {
      const selected = await this.selectFromList({
        message: 'Select a session to inspect:',
        items: sessions,
        getName: (s) => `${s.sessionId} (${s.ticketId}) - ${s.agentName} [${s.environment}]`,
        getValue: (s) => s.sessionId,
        getCommand: (s) => `prlt session inspect "${s.sessionId}" --json`,
        jsonMode: jsonMode ? { flags, commandName: 'session inspect' } : null,
      })

      if (!selected) return
      session = sessions.find(s => s.sessionId === selected)
      if (!session) this.error('No session selected')
    }

    this.outputInspect(session!, flags.lines, jsonMode, flags)
  }

  private outputInspect(
    session: VerifiedSession,
    lines: number,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): void {
    const containerId = session.environment === 'container' ? session.containerId : undefined

    // Gather all inspection data
    const processAlive = checkProcessLiveness(session.sessionId, containerId)
    const gitStatus = getGitStatus(session.branch, containerId)
    const prStatus = getPRStatus(session.branch, containerId)
    const output = captureTmuxPane(session.sessionId, lines, containerId)

    const result = {
      sessionId: session.sessionId,
      ticketId: session.ticketId,
      agentName: session.agentName,
      environment: session.environment,
      containerId: session.containerId,
      source: session.source,
      execution: {
        id: session.executionId || null,
        status: session.status || null,
        startedAt: session.startedAt?.toISOString() || null,
        pid: session.pid || null,
        logPath: session.logPath || null,
        branch: session.branch || null,
      },
      process: {
        alive: processAlive,
      },
      git: gitStatus,
      pr: prStatus,
      output: {
        lines,
        content: output,
        captureError: output === null ? 'Failed to capture pane content' : undefined,
      },
    }

    if (jsonMode) {
      outputSuccessAsJson(result, createMetadata('session inspect', flags))
      return
    }

    // Human-readable output
    this.log('')
    this.log(styles.header(`Session Inspect: ${session.agentName} (${session.ticketId})`))
    this.log('═'.repeat(70))

    // Execution metadata
    this.log('')
    this.log(styles.header('Execution'))
    this.log(`  ID:         ${session.executionId || styles.muted('n/a')}`)
    this.log(`  Session:    ${session.sessionId}`)
    this.log(`  Status:     ${session.status || styles.muted('n/a')}`)
    this.log(`  Started:    ${session.startedAt?.toISOString() || styles.muted('n/a')}`)
    this.log(`  Environment: ${session.environment}${containerId ? ` (${containerId})` : ''}`)
    this.log(`  Process:    ${processAlive ? styles.success('alive') : styles.warning('no foreground process')}`)

    // Git status
    this.log('')
    this.log(styles.header('Git'))
    if (gitStatus) {
      this.log(`  Branch:     ${gitStatus.branch}`)
      this.log(`  Uncommitted: ${gitStatus.uncommittedChanges > 0 ? styles.warning(String(gitStatus.uncommittedChanges)) : styles.success('0')} changes`)
      this.log(`  Ahead of main: ${gitStatus.commitsAheadOfMain} commits`)
      this.log(`  Unpushed:   ${gitStatus.hasUnpushedCommits ? styles.warning('yes') : styles.success('no')}`)
    } else {
      this.log(styles.muted('  Not available'))
    }

    // PR status
    this.log('')
    this.log(styles.header('Pull Request'))
    if (prStatus && prStatus.number) {
      this.log(`  PR #${prStatus.number}: ${prStatus.state}`)
      this.log(`  URL:        ${prStatus.url}`)
      this.log(`  CI:         ${prStatus.ciStatus || 'n/a'}`)
    } else {
      this.log(styles.muted('  No PR found'))
    }

    // Last output
    this.log('')
    this.log(styles.header(`Output (last ${lines} lines)`))
    if (output) {
      // Show last 20 lines in human mode
      const outputLines = output.split('\n')
      const displayLines = outputLines.slice(-20)
      for (const line of displayLines) {
        this.log(`  ${line}`)
      }
      if (outputLines.length > 20) {
        this.log(styles.muted(`  ... (${outputLines.length - 20} more lines, use --json for full output)`))
      }
    } else {
      this.log(styles.muted('  Failed to capture output'))
    }
    this.log('')
  }

  /**
   * Resolve a target identifier to matching sessions.
   */
  private resolveTarget(target: string, sessions: VerifiedSession[]): VerifiedSession[] {
    const exactSession = sessions.filter(s => s.sessionId === target)
    if (exactSession.length > 0) return exactSession

    if (/^[A-Z]+-\d+$/i.test(target)) {
      const ticketTarget = target.toUpperCase()
      const ticketMatches = sessions.filter(s => s.ticketId === ticketTarget)
      if (ticketMatches.length > 0) return ticketMatches
    }

    if (target.toUpperCase().startsWith('WORK-')) {
      const executionMatch = this.resolveFromExecution(target.toUpperCase(), sessions)
      if (executionMatch.length > 0) return executionMatch
    }

    const agentMatches = sessions.filter(s => s.agentName === target)
    if (agentMatches.length > 0) return agentMatches

    return sessions.filter(s =>
      s.sessionId.includes(target) ||
      s.ticketId.includes(target.toUpperCase()) ||
      s.agentName.includes(target),
    )
  }

  private resolveFromExecution(executionId: string, sessions: VerifiedSession[]): VerifiedSession[] {
    let db: Database.Database | null = null
    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new Database(dbPath)
      const executionStorage = new ExecutionStorage(db)
      const execution = executionStorage.getExecution(executionId)
      if (execution) {
        return sessions.filter(s =>
          s.ticketId === execution.ticketId && s.agentName === execution.agentName,
        )
      }
    } catch {
      // Workspace not available
    } finally {
      db?.close()
    }
    return []
  }

  /**
   * Get verified sessions with execution metadata.
   */
  private getVerifiedSessions(): VerifiedSession[] {
    const sessions: VerifiedSession[] = []

    let executionStorage: ExecutionStorage | null = null
    let db: Database.Database | null = null

    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new Database(dbPath)
      executionStorage = new ExecutionStorage(db)
    } catch {
      // Not in workspace
    }

    try {
      const hostTmuxSessions = getHostTmuxSessionNames()
      const containerTmuxSessions = getContainerTmuxSessionMap()
      const allContainerSessions = flattenContainerSessions(containerTmuxSessions)

      const matchedHostSessions = new Set<string>()
      const matchedContainerSessions = new Set<string>()

      const activeExecutions = executionStorage ? [
        ...(executionStorage.listExecutions({ status: 'running' }) || []),
        ...(executionStorage.listExecutions({ status: 'starting' }) || []),
      ] : []

      for (const exec of activeExecutions) {
        const isContainer = exec.environment === 'devcontainer'
        let exists = false
        let containerId: string | undefined
        let actualSessionId = exec.sessionId

        if (!exec.sessionId) {
          if (isContainer && exec.containerId) {
            const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
            const match = findSessionForExecution(exec.ticketId, exec.agentName, containerSessions)
            if (match) {
              actualSessionId = match
              exists = true
              containerId = exec.containerId
            }
          } else {
            const match = findSessionForExecution(exec.ticketId, exec.agentName, hostTmuxSessions)
            if (match) {
              actualSessionId = match
              exists = true
            }
          }
          if (!actualSessionId) continue
        } else {
          if (isContainer && exec.containerId) {
            const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
            exists = containerSessions.includes(exec.sessionId)
            containerId = exec.containerId
          } else {
            exists = hostTmuxSessions.includes(exec.sessionId)
          }
        }

        if (exists && actualSessionId) {
          if (isContainer && containerId) {
            matchedContainerSessions.add(`${containerId}:${actualSessionId}`)
          } else {
            matchedHostSessions.add(actualSessionId)
          }

          sessions.push({
            sessionId: actualSessionId,
            ticketId: exec.ticketId,
            agentName: exec.agentName,
            environment: isContainer ? 'container' : 'host',
            containerId,
            source: 'db',
            executionId: exec.id,
            branch: exec.branch,
            status: exec.status,
            startedAt: exec.startedAt,
            pid: exec.pid,
            logPath: exec.logPath,
          })
        }
      }

      // Discover orphan sessions
      for (const sessionName of hostTmuxSessions) {
        if (matchedHostSessions.has(sessionName)) continue
        const parsed = parseSessionName(sessionName)
        if (parsed) {
          sessions.push({
            sessionId: sessionName,
            ticketId: parsed.ticketId,
            agentName: parsed.agentName,
            environment: 'host',
            source: 'discovered',
          })
        }
      }

      for (const { sessionName, containerId } of allContainerSessions) {
        if (matchedContainerSessions.has(`${containerId}:${sessionName}`)) continue
        const parsed = parseSessionName(sessionName)
        if (parsed) {
          sessions.push({
            sessionId: sessionName,
            ticketId: parsed.ticketId,
            agentName: parsed.agentName,
            environment: 'container',
            containerId,
            source: 'discovered',
          })
        }
      }
    } finally {
      db?.close()
    }

    return sessions
  }
}
