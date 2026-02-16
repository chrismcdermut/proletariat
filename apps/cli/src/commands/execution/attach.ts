import { Args, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import {
  getHostTmuxSessionNames,
  getContainerTmuxSessionMap,
  findSessionForExecution,
} from '../../lib/execution/session-utils.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import type { AgentWork } from '../../lib/execution/types.js'

interface AttachableExecution {
  execution: AgentWork
  sessionId: string
  type: 'host' | 'container'
  containerId?: string
}

export default class ExecutionAttach extends PMOCommand {
  static description = 'Attach to a running execution\'s tmux session'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> WORK-001',
    '<%= config.bin %> <%= command.id %> --current-terminal',
  ]

  static args = {
    id: Args.string({
      description: 'Execution ID or ticket ID to attach to (optional - will prompt if not provided)',
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
    const { args, flags } = await this.parse(ExecutionAttach)

    // Check for mutually exclusive flags
    const rawArgs = process.argv
    const hasCurrentTerminal = rawArgs.includes('--current-terminal') || rawArgs.includes('-c')
    const hasNewTab = rawArgs.includes('--new-tab') || rawArgs.includes('-n')

    if (hasCurrentTerminal && hasNewTab) {
      this.error('--current-terminal and --new-tab are mutually exclusive')
    }

    const jsonMode = shouldOutputJson(flags)

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt init" first.', createMetadata('execution attach', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    const executionStorage = new ExecutionStorage(db)

    try {
      // Get attachable executions (running/starting with verified tmux sessions)
      const attachable = this.getAttachableExecutions(executionStorage)

      if (attachable.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_EXECUTIONS', 'No running executions with active sessions found.', createMetadata('execution attach', flags))
          return
        }
        this.log('')
        this.log(styles.muted('No running executions with active sessions found.'))
        this.log('')
        this.log(styles.muted('Start work with: prlt work start <ticket-id>'))
        this.log('')
        return
      }

      // Determine which execution to attach to
      let selected: AttachableExecution | undefined

      if (args.id) {
        // Find by execution ID or ticket ID (partial match)
        selected = attachable.find(a =>
          a.execution.id === args.id ||
          a.execution.id.includes(args.id!) ||
          a.execution.ticketId === args.id ||
          a.execution.ticketId.includes(args.id!)
        )

        if (!selected) {
          if (jsonMode) {
            outputErrorAsJson('NOT_FOUND', `No running execution found for "${args.id}".`, createMetadata('execution attach', flags))
            return
          }
          this.error(`No running execution found for "${args.id}". Run "prlt execution list" to see executions.`)
        }
      } else {
        // Prompt user to select
        const selectedValue = await this.selectFromList({
          message: 'Select an execution to attach to:',
          items: attachable,
          getName: (a) => `${a.execution.id} - ${a.execution.ticketId} (${a.execution.agentName}) [${a.type}]`,
          getValue: (a) => a.execution.id,
          getCommand: (a) => `prlt execution attach "${a.execution.id}" --json`,
          jsonMode: jsonMode ? { flags, commandName: 'execution attach' } : null,
        })

        if (!selectedValue) {
          return
        }

        selected = attachable.find(a => a.execution.id === selectedValue)
      }

      if (!selected) {
        this.error('No execution selected')
      }

      // Attach to the session
      this.log('')
      this.log(styles.info(`Attaching to execution ${selected.execution.id} (${selected.execution.ticketId})`))
      this.log(styles.muted(`Session: ${selected.sessionId} [${selected.type}]`))

      if (flags['current-terminal']) {
        await this.attachInCurrentTerminal(selected)
      } else {
        await this.attachInNewTab(selected, flags.terminal)
      }
    } finally {
      db.close()
    }
  }

  /**
   * Get running/starting executions that have verified tmux sessions.
   * Looks up executions from DB, then verifies their tmux sessions actually exist.
   * For executions without a sessionId, attempts to find a matching session by naming convention.
   */
  private getAttachableExecutions(executionStorage: ExecutionStorage): AttachableExecution[] {
    const attachable: AttachableExecution[] = []

    // Get active executions from DB
    const activeExecutions = [
      ...executionStorage.listExecutions({ status: 'running' }),
      ...executionStorage.listExecutions({ status: 'starting' }),
    ]

    if (activeExecutions.length === 0) {
      return []
    }

    // Get actual tmux sessions for verification
    const hostTmuxSessions = getHostTmuxSessionNames()
    const containerTmuxSessions = getContainerTmuxSessionMap()

    for (const exec of activeExecutions) {
      const isContainer = exec.environment === 'devcontainer' || exec.environment === 'docker'
      let actualSessionId = exec.sessionId
      let containerId = exec.containerId
      let exists = false

      if (!exec.sessionId) {
        // Try to find session by naming convention
        if (isContainer && exec.containerId) {
          const containerSessions = containerTmuxSessions.get(exec.containerId) || []
          const match = findSessionForExecution(exec.ticketId, exec.agentName, containerSessions)
          if (match) {
            actualSessionId = match
            exists = true
          }
        } else {
          const match = findSessionForExecution(exec.ticketId, exec.agentName, hostTmuxSessions)
          if (match) {
            actualSessionId = match
            exists = true
          }
        }
      } else {
        // sessionId is set, verify it exists
        if (isContainer && exec.containerId) {
          const containerSessions = containerTmuxSessions.get(exec.containerId)
          exists = containerSessions?.includes(exec.sessionId) ?? false
        } else {
          exists = hostTmuxSessions.includes(exec.sessionId)
        }
      }

      if (exists && actualSessionId) {
        attachable.push({
          execution: exec,
          sessionId: actualSessionId,
          type: isContainer ? 'container' : 'host',
          containerId: isContainer ? containerId : undefined,
        })
      }
    }

    return attachable
  }

  /**
   * Attach to execution's tmux session in current terminal
   */
  private async attachInCurrentTerminal(target: AttachableExecution): Promise<void> {
    try {
      if (target.type === 'container' && target.containerId) {
        execSync(`docker exec -it ${target.containerId} tmux attach -t "${target.sessionId}"`, { stdio: 'inherit' })
      } else {
        execSync(`tmux attach -t "${target.sessionId}"`, { stdio: 'inherit' })
      }
    } catch {
      this.error(`Failed to attach to ${target.type} session "${target.sessionId}"`)
    }
  }

  /**
   * Attach to execution's tmux session in a new terminal tab
   */
  private async attachInNewTab(target: AttachableExecution, terminalApp: string): Promise<void> {
    const title = `${target.execution.ticketId} (${target.execution.agentName})`

    // Create a script that sets tab title and attaches to tmux
    const baseDir = path.join(os.homedir(), '.proletariat', 'scripts')
    fs.mkdirSync(baseDir, { recursive: true })
    const scriptPath = path.join(baseDir, `attach-${Date.now()}.sh`)

    const attachCmd = target.type === 'container' && target.containerId
      ? `docker exec -it ${target.containerId} tmux -u attach -t "${target.sessionId}"`
      : `tmux attach -t "${target.sessionId}"`

    const script = `#!/bin/bash
# Set terminal tab title
echo -ne "\\033]0;${title}\\007"
echo -ne "\\033]1;${title}\\007"

echo "Attaching to: ${target.execution.id} - ${target.sessionId} (${target.type})"
${attachCmd}

# Clean up
rm -f "${scriptPath}"
exec $SHELL
`
    fs.writeFileSync(scriptPath, script, { mode: 0o755 })

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

      this.log(styles.success('Opened new tab and attaching to execution'))
    } catch (error) {
      this.error(`Failed to open terminal tab: ${error instanceof Error ? error.message : error}`)
    }
  }
}
