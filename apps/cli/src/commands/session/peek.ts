import { Args, Flags } from '@oclif/core'
import * as path from 'node:path'
import { SqliteDatabase } from '../../lib/database/sqlite.js'
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
import { onShutdown } from '../../lib/signal-handler.js'

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
}

// =============================================================================
// Command
// =============================================================================

export default class SessionPeek extends PMOCommand {
  static description = 'View agent tmux pane content without attaching (non-interactive)'

  static examples = [
    '<%= config.bin %> session peek altman',
    '<%= config.bin %> session peek TKT-123',
    '<%= config.bin %> session peek WORK-ABCD1234',
    '<%= config.bin %> session peek altman --lines 100',
    '<%= config.bin %> session peek altman --full',
    '<%= config.bin %> session peek altman --follow',
    '<%= config.bin %> session peek altman --since 2025-01-01T12:00:00Z',
    '<%= config.bin %> session peek TKT-123 --json',
    '<%= config.bin %> session peek altman | grep error',
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
      default: 200,
    }),
    full: Flags.boolean({
      description: 'Capture entire scrollback buffer (up to 32768 lines)',
      default: false,
    }),
    since: Flags.string({
      description: 'Filter output to lines after this timestamp (ISO 8601)',
    }),
    follow: Flags.boolean({
      char: 'f',
      description: 'Stream output continuously (like tail -f)',
      default: false,
    }),
    interval: Flags.integer({
      description: 'Polling interval in seconds for --follow mode',
      default: 2,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SessionPeek)
    const jsonMode = shouldOutputJson(flags)

    // Determine effective line count
    const effectiveLines = flags.full ? 32768 : flags.lines

    // Discover all verified sessions
    const sessions = this.getVerifiedSessions()

    if (sessions.length === 0) {
      if (jsonMode) {
        outputErrorAsJson(
          'NO_SESSIONS',
          'No active sessions found.',
          createMetadata('session peek', flags),
        )
        return
      }
      this.log('')
      this.log(styles.muted('No active sessions found.'))
      this.log('')
      this.log(styles.muted('Start work with: prlt work start <ticket-id>'))
      this.log('')
      return
    }

    if (args.target) {
      // Resolve target to matching session(s)
      const matched = this.resolveTarget(args.target, sessions)

      if (matched.length === 0) {
        if (jsonMode) {
          outputErrorAsJson(
            'SESSION_NOT_FOUND',
            `No matching session found for "${args.target}".`,
            createMetadata('session peek', flags),
          )
          return
        }
        this.error(`No matching session found for "${args.target}". Run "prlt session list" to see available sessions.`)
      }

      // Handle --follow mode for streaming output
      if (flags.follow && matched.length === 1) {
        await this.followMode(matched[0], effectiveLines, flags.interval)
        return
      }

      // Output all matched sessions
      if (jsonMode && matched.length > 1) {
        // Collect all captures into a single JSON response
        const results = matched.map(session => {
          const containerId = session.environment === 'container' ? session.containerId : undefined
          const content = captureTmuxPane(session.sessionId, effectiveLines, containerId)
          const filteredContent = flags.since ? this.filterSince(content, flags.since) : content
          return {
            sessionId: session.sessionId,
            ticketId: session.ticketId,
            agentName: session.agentName,
            environment: session.environment,
            containerId: session.containerId,
            lines: effectiveLines,
            content: filteredContent,
            captureError: content === null
              ? `Failed to capture pane content for session "${session.sessionId}".`
              : undefined,
          }
        })
        outputSuccessAsJson({ sessions: results }, createMetadata('session peek', flags))
        return
      }

      for (const session of matched) {
        this.outputPeek(session, effectiveLines, jsonMode, flags)
      }
    } else {
      // No target: interactive selection
      const selected = await this.selectFromList({
        message: 'Select a session to peek at:',
        items: sessions,
        getName: (s) => `${s.sessionId} (${s.ticketId}) - ${s.agentName} [${s.environment}]`,
        getValue: (s) => s.sessionId,
        getCommand: (s) => `prlt session peek "${s.sessionId}" --json`,
        jsonMode: jsonMode ? { flags, commandName: 'session peek' } : null,
      })

      if (!selected) {
        return
      }

      const session = sessions.find(s => s.sessionId === selected)
      if (!session) {
        this.error('No session selected')
      }

      if (flags.follow) {
        await this.followMode(session, effectiveLines, flags.interval)
        return
      }

      this.outputPeek(session, effectiveLines, jsonMode, flags)
    }
  }

  /**
   * Resolve a target identifier to matching sessions.
   * Supports: agent name, ticket ID (TKT-XXX), execution ID (WORK-XXX), or session ID.
   */
  private resolveTarget(target: string, sessions: VerifiedSession[]): VerifiedSession[] {
    // Try exact session ID match
    const exactSession = sessions.filter(s => s.sessionId === target)
    if (exactSession.length > 0) return exactSession

    // Try ticket ID match (e.g. TKT-123)
    if (/^[A-Z]+-\d+$/i.test(target)) {
      const ticketTarget = target.toUpperCase()
      const ticketMatches = sessions.filter(s => s.ticketId === ticketTarget)
      if (ticketMatches.length > 0) return ticketMatches
    }

    // Try execution ID match (WORK-XXX) — resolve via DB to find session
    if (target.toUpperCase().startsWith('WORK-')) {
      const executionMatch = this.resolveFromExecution(target.toUpperCase(), sessions)
      if (executionMatch.length > 0) return executionMatch
    }

    // Try agent name match
    const agentMatches = sessions.filter(s => s.agentName === target)
    if (agentMatches.length > 0) return agentMatches

    // Try partial session ID match
    const partialMatches = sessions.filter(s =>
      s.sessionId.includes(target) ||
      s.ticketId.includes(target.toUpperCase()) ||
      s.agentName.includes(target)
    )
    return partialMatches
  }

  /**
   * Resolve an execution ID (WORK-XXX) to matching sessions.
   */
  private resolveFromExecution(executionId: string, sessions: VerifiedSession[]): VerifiedSession[] {
    let db: SqliteDatabase | null = null
    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new SqliteDatabase(dbPath)
      const executionStorage = new ExecutionStorage(db)
      const execution = executionStorage.getExecution(executionId)

      if (execution) {
        return sessions.filter(s =>
          s.ticketId === execution.ticketId && s.agentName === execution.agentName
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
   * Output peek content for a session.
   * In raw mode: outputs plain text to stdout.
   * In JSON mode: outputs structured JSON.
   */
  private outputPeek(
    session: VerifiedSession,
    lines: number,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): void {
    const containerId = session.environment === 'container' ? session.containerId : undefined
    const content = captureTmuxPane(session.sessionId, lines, containerId)

    if (content === null) {
      if (jsonMode) {
        outputErrorAsJson(
          'CAPTURE_FAILED',
          `Failed to capture pane content for session "${session.sessionId}". The session may no longer exist or tmux may not be available.`,
          createMetadata('session peek', flags),
        )
        return
      }
      this.error(
        `Failed to capture pane content for session "${session.sessionId}". ` +
        'The session may no longer exist or tmux may not be available.'
      )
    }

    // Apply --since filtering if provided
    const sinceFlag = flags.since as string | undefined
    const filteredContent = sinceFlag ? this.filterSince(content, sinceFlag) : content

    if (jsonMode) {
      outputSuccessAsJson({
        sessionId: session.sessionId,
        ticketId: session.ticketId,
        agentName: session.agentName,
        environment: session.environment,
        containerId: session.containerId,
        lines,
        content: filteredContent,
        ...(sinceFlag ? { filteredSince: sinceFlag } : {}),
      }, createMetadata('session peek', flags))
      return
    } else {
      // Raw text output — pipeable and scriptable
      process.stdout.write((filteredContent || '') + '\n')
    }
  }

  /**
   * Filter content to only include lines after a given timestamp.
   * Looks for timestamp patterns in lines and filters accordingly.
   * If no timestamps found, returns all content (best effort).
   */
  private filterSince(content: string | null, since: string): string | null {
    if (!content) return content

    const sinceDate = new Date(since)
    if (isNaN(sinceDate.getTime())) return content

    const sinceMs = sinceDate.getTime()
    const lines = content.split('\n')
    const filteredLines: string[] = []
    let pastThreshold = false

    // Common timestamp patterns in terminal output
    const timestampPatterns = [
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,  // ISO 8601
      /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/,   // SQL-like
      /\[\d{2}:\d{2}:\d{2}\]/,                    // [HH:MM:SS]
    ]

    for (const line of lines) {
      if (pastThreshold) {
        filteredLines.push(line)
        continue
      }

      for (const pattern of timestampPatterns) {
        const match = line.match(pattern)
        if (match) {
          try {
            const lineDate = new Date(match[0])
            if (!isNaN(lineDate.getTime()) && lineDate.getTime() >= sinceMs) {
              pastThreshold = true
              filteredLines.push(line)
            }
          } catch {
            // Not a valid date, skip
          }
          break
        }
      }
    }

    // If no timestamps were found, return all content
    return filteredLines.length > 0 ? filteredLines.join('\n') : content
  }

  /**
   * Follow mode: continuously stream new output (like tail -f).
   * Captures pane content at regular intervals and outputs only new lines.
   */
  private async followMode(
    session: VerifiedSession,
    lines: number,
    intervalSeconds: number,
  ): Promise<void> {
    const containerId = session.environment === 'container' ? session.containerId : undefined
    let previousContent = ''

    // Initial capture
    const initial = captureTmuxPane(session.sessionId, lines, containerId)
    if (initial) {
      process.stdout.write(initial + '\n')
      previousContent = initial
    }

    const intervalMs = intervalSeconds * 1000

    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const content = captureTmuxPane(session.sessionId, lines, containerId)
        if (content === null) {
          // Session ended
          process.stdout.write('\n[Session ended]\n')
          clearInterval(timer)
          resolve()
          return
        }

        // Find new content by comparing with previous
        if (content !== previousContent) {
          // Find the divergence point
          const prevLines = previousContent.split('\n')
          const currLines = content.split('\n')

          // Look for the last matching line to find new content
          let newStartIndex = 0
          if (prevLines.length > 0) {
            const lastPrevLine = prevLines[prevLines.length - 1]
            const lastPrevIdx = currLines.lastIndexOf(lastPrevLine)
            if (lastPrevIdx >= 0) {
              newStartIndex = lastPrevIdx + 1
            }
          }

          const newLines = currLines.slice(newStartIndex)
          if (newLines.length > 0) {
            process.stdout.write(newLines.join('\n') + '\n')
          }
          previousContent = content
        }
      }, intervalMs)

      onShutdown(() => {
        clearInterval(timer)
        resolve()
      })
    })
  }

  /**
   * Get verified sessions from DB that have actual tmux processes.
   * Same discovery pattern as attach.ts and list.ts.
   */
  private getVerifiedSessions(): VerifiedSession[] {
    const sessions: VerifiedSession[] = []

    let executionStorage: ExecutionStorage | null = null
    let db: SqliteDatabase | null = null

    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new SqliteDatabase(dbPath)
      executionStorage = new ExecutionStorage(db)
    } catch {
      // Not in workspace — can still discover tmux sessions
    }

    try {
      const hostTmuxSessions = getHostTmuxSessionNames()
      const containerTmuxSessions = getContainerTmuxSessionMap()
      const allContainerSessions = flattenContainerSessions(containerTmuxSessions)

      const matchedHostSessions = new Set<string>()
      const matchedContainerSessions = new Set<string>()

      // Get active executions from DB
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
          })
        }
      }

      // Discover orphan sessions matching prlt pattern
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
