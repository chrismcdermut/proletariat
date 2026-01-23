import { Args, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
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
  static description = 'Attach to an active tmux session'

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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
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

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Get all available sessions (DB-driven)
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

    // Default to new tab unless --current-terminal is specified
    if (flags['current-terminal']) {
      await this.attachInCurrentTerminal(selectedSession)
    } else {
      await this.attachInNewTab(selectedSession, flags.terminal)
    }
  }

  /**
   * Get verified sessions from DB that have actual tmux processes
   * DB-driven approach: Start with executions, verify tmux sessions exist
   */
  private getVerifiedSessions(): SessionChoice[] {
    const sessions: SessionChoice[] = []

    let executionStorage: ExecutionStorage | null = null
    let db: Database.Database | null = null

    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new Database(dbPath)
      executionStorage = new ExecutionStorage(db)
    } catch {
      return sessions  // Not in workspace
    }

    try {
      // Get active executions from DB
      const activeExecutions = [
        ...(executionStorage.listExecutions({ status: 'running' }) || []),
        ...(executionStorage.listExecutions({ status: 'starting' }) || []),
      ]

      // Get actual tmux sessions for verification
      const hostTmuxSessions = this.getHostTmuxSessionNames()
      const containerTmuxSessions = this.getContainerTmuxSessionMap()

      for (const exec of activeExecutions) {
        if (!exec.sessionId) continue

        const isContainer = exec.environment === 'devcontainer'
        let exists = false

        if (isContainer && exec.containerId) {
          const containerSessions = containerTmuxSessions.get(exec.containerId)
          exists = containerSessions?.includes(exec.sessionId) ?? false
        } else {
          exists = hostTmuxSessions.includes(exec.sessionId)
        }

        // Only include sessions that actually exist
        if (exists) {
          sessions.push({
            name: exec.sessionId,
            sessionId: exec.sessionId,
            type: isContainer ? 'container' : 'host',
            containerId: exec.containerId,
            ticketId: exec.ticketId,
            agentName: exec.agentName,
          })
        }
      }
    } finally {
      db?.close()
    }

    return sessions
  }

  /**
   * Get list of host tmux session names
   */
  private getHostTmuxSessionNames(): string[] {
    try {
      execSync('which tmux', { stdio: 'pipe' })
      const output = execSync(
        'tmux list-sessions -F "#{session_name}"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()

      if (!output) return []
      return output.split('\n')
    } catch {
      return []
    }
  }

  /**
   * Get map of containerId -> tmux session names
   */
  private getContainerTmuxSessionMap(): Map<string, string[]> {
    const sessionMap = new Map<string, string[]>()

    try {
      const containersOutput = execSync(
        'docker ps --filter "label=devcontainer.local_folder" --format "{{.ID}}"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()

      if (!containersOutput) return sessionMap

      for (const containerId of containersOutput.split('\n')) {
        try {
          const tmuxOutput = execSync(
            `docker exec ${containerId} tmux list-sessions -F "#{session_name}" 2>/dev/null`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
          ).trim()

          if (tmuxOutput) {
            sessionMap.set(containerId, tmuxOutput.split('\n'))
          }
        } catch {
          // Container has no tmux sessions
        }
      }
    } catch {
      // Docker not available
    }

    return sessionMap
  }

  /**
   * Attach to session in current terminal
   */
  private async attachInCurrentTerminal(session: SessionChoice): Promise<void> {
    try {
      if (session.type === 'container' && session.containerId) {
        execSync(`docker exec -it ${session.containerId} tmux attach -t "${session.sessionId}"`, { stdio: 'inherit' })
      } else {
        execSync(`tmux attach -t "${session.sessionId}"`, { stdio: 'inherit' })
      }
    } catch {
      this.error(`Failed to attach to ${session.type} session "${session.sessionId}"`)
    }
  }

  /**
   * Attach to session in a new terminal tab
   */
  private async attachInNewTab(session: SessionChoice, terminalApp: string): Promise<void> {
    // Build a readable title for the tab
    const title = `${session.ticketId} (${session.agentName})`

    // Create a script that sets tab title and attaches to tmux
    const baseDir = path.join(os.homedir(), '.proletariat', 'scripts')
    fs.mkdirSync(baseDir, { recursive: true })
    const scriptPath = path.join(baseDir, `attach-${Date.now()}.sh`)

    // Different attach command for container vs host sessions
    const attachCmd = session.type === 'container' && session.containerId
      ? `docker exec -it ${session.containerId} tmux -u attach -t "${session.sessionId}"`
      : `tmux attach -t "${session.sessionId}"`

    const script = `#!/bin/bash
# Set terminal tab title
echo -ne "\\033]0;${title}\\007"
echo -ne "\\033]1;${title}\\007"

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
