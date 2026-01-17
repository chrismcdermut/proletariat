import { Args, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import inquirer from 'inquirer'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'

interface SessionChoice {
  name: string
  value: string
  type: 'host' | 'container'
  containerId?: string
  ticketId?: string
  agentName?: string
}

export default class SessionAttach extends PMOCommand {
  static description = 'Attach to an active tmux session'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> prlt-TKT-347-implement',
    '<%= config.bin %> <%= command.id %> --new-tab',
  ]

  static args = {
    session: Args.string({
      description: 'Session name to attach to (optional - will prompt if not provided)',
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

    // Get all available sessions
    const sessions = this.getAllSessions()

    if (sessions.length === 0) {
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
      // Find session by name (partial match)
      selectedSession = sessions.find(s =>
        s.name === args.session ||
        s.name.includes(args.session!) ||
        s.value === args.session
      )

      if (!selectedSession) {
        this.error(`Session "${args.session}" not found. Run "prlt session list" to see available sessions.`)
      }
    } else {
      // Prompt user to select
      const { session } = await inquirer.prompt([
        {
          type: 'list',
          name: 'session',
          message: 'Select a session to attach to:',
          choices: sessions.map(s => ({
            name: `${s.name}${s.ticketId ? ` (${s.ticketId})` : ''}${s.agentName ? ` - ${s.agentName}` : ''} [${s.type}]`,
            value: s.value,
          })),
        },
      ])

      selectedSession = sessions.find(s => s.value === session)
    }

    if (!selectedSession) {
      this.error('No session selected')
    }

    // Attach to the session
    this.log('')
    this.log(styles.info(`Attaching to session: ${selectedSession.name}`))

    // Default to new tab unless --current-terminal is specified
    if (flags['current-terminal']) {
      await this.attachInCurrentTerminal(selectedSession)
    } else {
      await this.attachInNewTab(selectedSession, flags.terminal)
    }
  }

  /**
   * Get all available sessions (container tmux only - simplified)
   */
  private getAllSessions(): SessionChoice[] {
    const sessions: SessionChoice[] = []

    // Get workspace info for execution records
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
      // Get running executions for metadata
      const activeExecutions = [
        ...(executionStorage?.listExecutions({ status: 'running' }) || []),
        ...(executionStorage?.listExecutions({ status: 'starting' }) || []),
      ]
      const executionBySession = new Map(
        activeExecutions
          .filter(e => e.sessionId)
          .map(e => [e.sessionId!, e])
      )

      // Get container tmux sessions (no host tmux - simplified architecture)
      try {
        const containersOutput = execSync(
          'docker ps --filter "label=devcontainer.local_folder" --format "{{.ID}}|{{.Labels}}"',
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim()

        if (containersOutput) {
          for (const line of containersOutput.split('\n')) {
            const [containerId, labels] = line.split('|')

            // Extract agent name from local_folder label
            const localFolderMatch = labels.match(/devcontainer\.local_folder=([^,]+)/)
            const localFolder = localFolderMatch ? localFolderMatch[1] : ''
            const agentName = localFolder.split('/').pop() || 'unknown'

            // Check for tmux sessions inside this container
            try {
              const tmuxOutput = execSync(
                `docker exec ${containerId} tmux list-sessions -F "#{session_name}" 2>/dev/null`,
                { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
              ).trim()

              if (tmuxOutput) {
                for (const sessionName of tmuxOutput.split('\n')) {
                  const exec = executionBySession.get(sessionName)
                  sessions.push({
                    name: sessionName,
                    value: `container:${containerId}:${sessionName}`,
                    type: 'container',
                    containerId,
                    ticketId: exec?.ticketId || extractTicketFromSession(sessionName),
                    agentName,
                  })
                }
              }
            } catch {
              // No tmux in container
            }
          }
        }
      } catch {
        // Docker not available
      }
    } finally {
      db?.close()
    }

    return sessions
  }

  /**
   * Attach to session in current terminal
   */
  private async attachInCurrentTerminal(session: SessionChoice): Promise<void> {
    // Container session - docker exec into container and attach to tmux
    const { containerId, name } = session
    try {
      execSync(`docker exec -it ${containerId} tmux attach -t "${name}"`, { stdio: 'inherit' })
    } catch {
      this.error(`Failed to attach to container session "${name}"`)
    }
  }

  /**
   * Attach to session in a new terminal tab
   *
   * For iTerm with tmux -CC (control mode):
   * - We run the attach command in the CURRENT terminal
   * - iTerm's tmux integration automatically creates a new window/tab based on user's iTerm preferences
   * - User can configure this in: iTerm Settings > General > tmux > "When attaching, restore windows as"
   *
   * For other terminals (or non-CC mode):
   * - We create a new tab via AppleScript and run the attach command there
   */
  private async attachInNewTab(session: SessionChoice, terminalApp: string): Promise<void> {
    // Build a readable title for the tab
    const title = session.ticketId
      ? `${session.ticketId}${session.agentName ? ` (${session.agentName})` : ''}`
      : session.name

    // For iTerm, use tmux -CC which handles its own window/tab creation
    if (terminalApp === 'iTerm') {
      this.log('')
      this.log(styles.muted('Using iTerm tmux integration (control mode).'))
      this.log(styles.muted('Tip: Configure tab/window behavior in iTerm Settings > General > tmux'))
      this.log('')

      // Rename the tmux window to show a readable title, then attach
      // This ensures iTerm picks up the correct tab name via tmux integration
      try {
        execSync(
          `docker exec ${session.containerId} tmux rename-window -t "${session.name}" "${title}"`,
          { stdio: 'pipe' }
        )
      } catch {
        // Window rename failed - not critical, continue with attach
      }

      // Run directly - iTerm's tmux integration will create the window/tab
      try {
        execSync(
          `docker exec -it ${session.containerId} tmux -u -CC attach -t "${session.name}"`,
          { stdio: 'inherit' }
        )
      } catch {
        // User detached or session ended - this is normal
      }
      return
    }

    // For other terminals, create a new tab and run the attach command there
    const baseDir = path.join(os.homedir(), '.proletariat', 'scripts')
    fs.mkdirSync(baseDir, { recursive: true })
    const scriptPath = path.join(baseDir, `attach-${Date.now()}.sh`)

    const attachCmd = `docker exec -it ${session.containerId} tmux -u attach -t "${session.name}"`

    const script = `#!/bin/bash
# Set terminal tab title
echo -ne "\\033]0;${title}\\007"
echo -ne "\\033]1;${title}\\007"

echo "Attaching to: ${session.name}"
${attachCmd}

# Clean up
rm -f "${scriptPath}"
exec $SHELL
`
    fs.writeFileSync(scriptPath, script, { mode: 0o755 })

    // Open in new tab
    try {
      switch (terminalApp) {
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

/**
 * Try to extract ticket ID from session name
 */
function extractTicketFromSession(sessionName: string | null | undefined): string | undefined {
  if (!sessionName) return undefined
  const name = sessionName.replace(/^prlt-/, '')
  const match = name.match(/^(TKT-\d+)/)
  return match ? match[1] : undefined
}
