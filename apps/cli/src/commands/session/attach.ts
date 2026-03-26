import { Args, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import type Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { ExecutionStorage, loadExecutionConfig, shouldUseControlMode, buildTmuxAttachCommand } from '../../lib/execution/index.js'
import { detectTerminalApp } from '../orchestrator/attach.js'
import {
  findSessionForExecution,
  getHostTmuxSessionNames,
  getContainerTmuxSessionMap,
  findContainerSessionsByPrefix,
  probeExecutionLiveness,
} from '../../lib/execution/session-utils.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

interface SessionChoice {
  name: string           // Session name (for display)
  sessionId: string      // Actual tmux session ID
  type: 'host' | 'container'
  containerId?: string
  ticketId: string
  agentName: string
}

export default class SessionAttach extends PMOCommand {
  static description = 'Attach to an active agent session (DB-tracked only)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TKT-347-implement-altman',
    '<%= config.bin %> <%= command.id %> --current-terminal',
  ]

  static args = {
    session: Args.string({
      description: 'Session name or ticket ID to attach to (optional - will prompt if not provided)',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    'new-tab': Flags.boolean({
      char: 'n',
      description: 'Open in a new terminal tab (default: true)',
      default: true,
    }),
    'current-terminal': Flags.boolean({
      char: 'c',
      description: 'Attach in current terminal instead of new tab',
      default: false,
    }),
    terminal: Flags.string({
      char: 't',
      description: 'Terminal app to use (iTerm, Terminal, Ghostty)',
      default: 'iTerm',
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SessionAttach)

    // Check for mutually exclusive flags
    const rawArgs = process.argv
    const hasCurrentTerminal = rawArgs.includes('--current-terminal') || rawArgs.includes('-c')
    const hasNewTab = rawArgs.includes('--new-tab') || rawArgs.includes('-n')

    if (hasCurrentTerminal && hasNewTab) {
      this.error('--current-terminal and --new-tab are mutually exclusive')
    }

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Get all available sessions (DB-driven only — no orphan discovery)
    const sessions = this.getVerifiedSessions()

    if (sessions.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_SESSIONS', 'No active sessions found.', createMetadata('session attach', flags))
        return
      }
      this.log('')
      this.log(styles.muted('No active sessions found.'))
      this.log('')
      this.log(styles.muted('Start work with: prlt work start <ticket-id>'))
      this.log('')
      return
    }

    // Determine which session to attach to
    let selectedSession: SessionChoice | undefined

    if (args.session) {
      // Find session by name, sessionId, or ticketId (partial match)
      selectedSession = sessions.find(s =>
        s.sessionId === args.session ||
        s.sessionId.includes(args.session!) ||
        s.ticketId === args.session ||
        s.ticketId.includes(args.session!)
      )

      if (!selectedSession) {
        if (jsonMode) {
          outputErrorAsJson('SESSION_NOT_FOUND', `Session "${args.session}" not found.`, createMetadata('session attach', flags))
          return
        }
        this.error(`Session "${args.session}" not found. Run "prlt session list" to see available sessions.`)
      }
    } else {
      // Use selectFromList helper for session selection
      const selected = await this.selectFromList({
        message: 'Select a session to attach to:',
        items: sessions,
        getName: (s) => `${s.sessionId} (${s.ticketId}) - ${s.agentName} [${s.type}]`,
        getValue: (s) => s.sessionId,
        getCommand: (s) => `prlt session attach "${s.sessionId}" --json`,
        jsonMode: jsonMode ? { flags, commandName: 'session attach' } : null,
      })

      if (!selected) {
        return
      }

      selectedSession = sessions.find(s => s.sessionId === selected)
    }

    if (!selectedSession) {
      this.error('No session selected')
    }

    // Attach to the session
    this.log('')
    this.log(styles.info(`Attaching to session: ${selectedSession.sessionId}`))

    // Determine if we should use tmux control mode (-u -CC) for iTerm
    let useControlMode = false
    try {
      const workspaceInfo = getWorkspaceInfo()
      const controlDb = openWorkspaceDatabase(workspaceInfo.path)
      try {
        const config = loadExecutionConfig(controlDb)
        const termApp = detectTerminalApp()
        if (termApp === 'iTerm') {
          useControlMode = shouldUseControlMode('iTerm', config.tmux.controlMode)
        }
      } finally {
        controlDb.close()
      }
    } catch {
      // Not in a workspace or DB not available - fall back to no control mode
    }

    // Default to new tab unless --current-terminal is specified
    if (flags['current-terminal']) {
      await this.attachInCurrentTerminal(selectedSession, useControlMode)
    } else {
      await this.attachInNewTab(selectedSession, flags.terminal, useControlMode)
    }
  }

  /**
   * Get verified sessions from DB that have alive runtimes.
   * DB-first: query executions, then probe liveness per runtime environment.
   * No orphan discovery — only DB-tracked sessions are attachable.
   */
  private getVerifiedSessions(): SessionChoice[] {
    const sessions: SessionChoice[] = []

    let executionStorage: ExecutionStorage | null = null
    let db: Database.Database | null = null

    try {
      const workspaceInfo = getWorkspaceInfo()
      db = openWorkspaceDatabase(workspaceInfo.path)
      executionStorage = new ExecutionStorage(db)
    } catch {
      return sessions
    }

    try {
      // Get active executions from DB
      const activeExecutions = [
        ...executionStorage.listExecutions({ status: 'running' }),
        ...executionStorage.listExecutions({ status: 'starting' }),
      ]

      // For session ID discovery when DB has NULL session_id
      const hostTmuxSessions = getHostTmuxSessionNames()
      const containerTmuxSessions = getContainerTmuxSessionMap()

      for (const exec of activeExecutions) {
        const isContainer = exec.environment === 'devcontainer' || exec.environment === 'docker'
        let actualSessionId = exec.sessionId

        // If sessionId is NULL, try to find by naming convention
        if (!actualSessionId) {
          if (isContainer && exec.containerId) {
            const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
            const match = findSessionForExecution(exec.ticketId, exec.agentName, containerSessions)
            if (match) actualSessionId = match
          } else {
            const match = findSessionForExecution(exec.ticketId, exec.agentName, hostTmuxSessions)
            if (match) actualSessionId = match
          }
        }

        // Probe runtime liveness
        const alive = probeExecutionLiveness(exec.environment, exec.containerId, actualSessionId)
        if (!alive || !actualSessionId) continue

        sessions.push({
          name: actualSessionId,
          sessionId: actualSessionId,
          type: isContainer ? 'container' : 'host',
          containerId: exec.containerId,
          ticketId: exec.ticketId,
          agentName: exec.agentName,
        })
      }
    } finally {
      db?.close()
    }

    return sessions
  }

  /**
   * Attach to session in current terminal
   */
  private async attachInCurrentTerminal(session: SessionChoice, useControlMode: boolean): Promise<void> {
    try {
      // Set mouse mode based on attach type:
      // - Plain terminal: mouse on (enables scroll in tmux; hold Shift/Option to bypass)
      // - iTerm -CC: mouse off (iTerm handles scrolling natively)
      const mouseMode = useControlMode ? 'off' : 'on'
      try {
        if (session.type === 'container' && session.containerId) {
          execSync(`docker exec ${session.containerId} tmux set-option -t "${session.sessionId}" mouse ${mouseMode}`, { stdio: 'pipe' })
        } else {
          execSync(`tmux set-option -t "${session.sessionId}" mouse ${mouseMode}`, { stdio: 'pipe' })
        }
      } catch {
        // Non-fatal: mouse mode is a convenience, don't block attach
      }

      const tmuxAttach = buildTmuxAttachCommand(useControlMode, session.type === 'container')
      if (session.type === 'container' && session.containerId) {
        execSync(`docker exec -it ${session.containerId} ${tmuxAttach} -t "${session.sessionId}"`, { stdio: 'inherit' })
      } else {
        execSync(`${tmuxAttach} -t "${session.sessionId}"`, { stdio: 'inherit' })
      }
    } catch {
      this.error(`Failed to attach to ${session.type} session "${session.sessionId}"`)
    }
  }

  /**
   * Attach to session in a new terminal tab
   */
  private async attachInNewTab(session: SessionChoice, terminalApp: string, useControlMode: boolean): Promise<void> {
    // Build a readable title for the tab
    const title = `${session.ticketId} (${session.agentName})`

    // Create a script that sets tab title and attaches to tmux
    const baseDir = path.join(os.homedir(), '.proletariat', 'scripts')
    fs.mkdirSync(baseDir, { recursive: true })
    const scriptPath = path.join(baseDir, `attach-${Date.now()}.sh`)

    // Different attach command for container vs host sessions
    const tmuxAttach = buildTmuxAttachCommand(useControlMode, session.type === 'container')
    const attachCmd = session.type === 'container' && session.containerId
      ? `docker exec -it ${session.containerId} ${tmuxAttach} -t "${session.sessionId}"`
      : `${tmuxAttach} -t "${session.sessionId}"`

    // Set mouse mode based on attach type
    const mouseMode = useControlMode ? 'off' : 'on'
    const mouseCmd = session.type === 'container' && session.containerId
      ? `docker exec ${session.containerId} tmux set-option -t "${session.sessionId}" mouse ${mouseMode} 2>/dev/null || true`
      : `tmux set-option -t "${session.sessionId}" mouse ${mouseMode} 2>/dev/null || true`

    const script = `#!/bin/bash
# Set terminal tab title
echo -ne "\\033]0;${title}\\007"
echo -ne "\\033]1;${title}\\007"

# Set mouse mode before attaching
${mouseCmd}

echo "Attaching to: ${session.sessionId} (${session.type})"
${attachCmd}

# Clean up
rm -f "${scriptPath}"
exec $SHELL
`
    fs.writeFileSync(scriptPath, script, { mode: 0o755 })

    // Open in new tab and run the attach script
    try {
      switch (terminalApp) {
        case 'iTerm':
          execSync(`osascript -e '
            tell application "iTerm"
              activate
              tell current window
                set newTab to (create tab with default profile)
                tell current session of newTab
                  set name to "${title}"
                  write text "${scriptPath}"
                end tell
              end tell
            end tell
          '`)
          break

        case 'Ghostty':
          execSync(`osascript -e '
            tell application "Ghostty"
              activate
            end tell
            tell application "System Events"
              tell process "Ghostty"
                keystroke "t" using command down
                delay 0.3
                keystroke "${scriptPath}"
                keystroke return
              end tell
            end tell
          '`)
          break

        case 'Terminal':
        default:
          execSync(`osascript -e '
            tell application "Terminal"
              activate
              tell application "System Events"
                tell process "Terminal"
                  keystroke "t" using command down
                end tell
              end tell
              delay 0.3
              do script "${scriptPath}" in front window
            end tell
          '`)
          break
      }

      this.log(styles.success('Opened new tab and attaching to session'))
    } catch (error) {
      this.error(`Failed to open terminal tab: ${error instanceof Error ? error.message : error}`)
    }
  }
}
