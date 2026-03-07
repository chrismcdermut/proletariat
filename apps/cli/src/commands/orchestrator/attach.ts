import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  outputPromptAsJson,
  buildPromptConfig,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { getHostTmuxSessionNames } from '../../lib/execution/session-utils.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { findHQRoot } from '../../lib/workspace.js'
import { getHeadquartersNameFromPath } from '../../lib/machine-config.js'
import { loadExecutionConfig, shouldUseControlMode, buildTmuxAttachCommand } from '../../lib/execution/index.js'
import {
  buildOrchestratorSessionName,
  findRunningOrchestratorSessions,
  findHQOrchestratorSessions,
  extractOrchestratorNameFromSession,
} from './start.js'

/**
 * Detect the terminal emulator from environment variables.
 * Returns a terminal app name suitable for AppleScript tab creation,
 * or null if detection fails or we're in a remote/headless environment.
 */
export function detectTerminalApp(): string | null {
  // Remote sessions should never attempt AppleScript/GUI operations
  if (process.env.SSH_TTY || process.env.SSH_CONNECTION) {
    return null
  }

  // Headless / no display — skip GUI attempts
  if (process.platform !== 'darwin' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return null
  }

  const termProgram = process.env.TERM_PROGRAM

  switch (termProgram) {
    case 'iTerm.app':
      return 'iTerm'
    case 'ghostty':
      return 'Ghostty'
    case 'Apple_Terminal':
      return 'Terminal'
    case 'WezTerm':
      return 'WezTerm'
  }

  // TERM_PROGRAM is overwritten to 'tmux' inside tmux sessions.
  // Fall back to vars that persist through tmux to detect the outer terminal.
  if (process.env.LC_TERMINAL === 'iTerm2' || process.env.ITERM_SESSION_ID) {
    return 'iTerm'
  }

  return null
}

export default class OrchestratorAttach extends PromptCommand {
  static description = 'Attach to the running orchestrator tmux session'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --new-tab',
    '<%= config.bin %> <%= command.id %> --new-tab --terminal Ghostty',
  ]

  static flags = {
    ...machineOutputFlags,
    name: Flags.string({
      char: 'n',
      description: 'Name of the orchestrator session to attach to (default: main)',
    }),
    'new-tab': Flags.boolean({
      description: 'Open in a new terminal tab instead of attaching in the current terminal',
      default: false,
    }),
    terminal: Flags.string({
      char: 't',
      description: 'Terminal app to use for new tab (iTerm, Terminal, Ghostty). Auto-detected if not specified.',
    }),
    'current-terminal': Flags.boolean({
      char: 'c',
      description: '[deprecated] Attach in current terminal (this is now the default behavior)',
      hidden: true,
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(OrchestratorAttach)
    const jsonMode = shouldOutputJson(flags)
    const hostSessions = getHostTmuxSessionNames()

    // Resolve session name: try HQ-scoped first, fall back to discovery
    let sessionName: string | undefined
    const hqPath = findHQRoot(process.cwd())

    if (hqPath) {
      const hqName = getHeadquartersNameFromPath(hqPath)

      if (flags.name) {
        // Explicit --name: look for that specific orchestrator
        sessionName = buildOrchestratorSessionName(hqName, flags.name)
        if (!hostSessions.includes(sessionName)) {
          sessionName = undefined
        }
      } else {
        // No --name: discover ALL orchestrators in this HQ
        const hqSessions = findHQOrchestratorSessions(hostSessions, hqName)
        if (hqSessions.length === 1) {
          sessionName = hqSessions[0]
        } else if (hqSessions.length > 1) {
          const sessionChoices = hqSessions.map(s => ({
            name: extractOrchestratorNameFromSession(s, hqName) || s,
            value: s,
            command: `prlt orchestrator attach --name "${extractOrchestratorNameFromSession(s, hqName) || s}" --json`,
          }))
          const selectMessage = 'Multiple orchestrator sessions found. Select one to attach:'

          if (jsonMode) {
            outputPromptAsJson(
              buildPromptConfig('list', 'session', selectMessage, sessionChoices),
              createMetadata('orchestrator attach', flags),
            )
            return
          }

          const { session } = await this.prompt<{ session: string }>([{
            type: 'list',
            name: 'session',
            message: selectMessage,
            choices: sessionChoices,
          }])
          sessionName = session
        }
        // If 0 found, fall through to global discovery below
      }
    }

    // If not in HQ or session not found, discover running orchestrator sessions globally
    if (!sessionName) {
      const runningSessions = findRunningOrchestratorSessions(hostSessions)
      if (runningSessions.length === 0) {
        if (jsonMode) {
          outputErrorAsJson(
            'NOT_RUNNING',
            'Orchestrator is not running. Start it with: prlt orchestrator start',
            createMetadata('orchestrator attach', flags),
          )
          return
        }
        this.log('')
        this.log(styles.warning('Orchestrator is not running.'))
        this.log(styles.muted('Start it with: prlt orchestrator start'))
        this.log('')
        return
      } else if (runningSessions.length === 1) {
        sessionName = runningSessions[0]
      } else {
        // Multiple sessions — let user pick
        const sessionChoices = runningSessions.map(s => ({
          name: s,
          value: s,
          command: `prlt orchestrator attach --name "${s}" --json`,
        }))
        const selectMessage = 'Multiple orchestrator sessions found. Select one to attach:'

        if (jsonMode) {
          outputPromptAsJson(
            buildPromptConfig('list', 'session', selectMessage, sessionChoices),
            createMetadata('orchestrator attach', flags),
          )
          return
        }

        const { session } = await this.prompt<{ session: string }>([{
          type: 'list',
          name: 'session',
          message: selectMessage,
          choices: sessionChoices,
        }])
        sessionName = session
      }
    }

    if (!sessionName) {
      return
    }

    if (jsonMode) {
      outputSuccessAsJson({
        sessionId: sessionName,
        status: 'attaching',
      }, createMetadata('orchestrator attach', flags as Record<string, unknown>))
      return
    }

    if (flags['current-terminal']) {
      this.log(styles.warning('--current-terminal is deprecated. Direct tmux attach is now the default behavior.'))
    }

    if (flags.terminal && !flags['new-tab']) {
      this.log(styles.warning('--terminal has no effect without --new-tab. Ignoring.'))
    }

    this.log('')
    this.log(styles.info(`Attaching to orchestrator session: ${sessionName}`))

    // Determine if we should use tmux control mode (-u -CC) for iTerm
    let useControlMode = false
    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      const db = new Database(dbPath)
      try {
        const config = loadExecutionConfig(db)
        const termApp = detectTerminalApp()
        if (termApp === 'iTerm') {
          useControlMode = shouldUseControlMode('iTerm', config.tmux.controlMode)
        }
      } finally {
        db.close()
      }
    } catch {
      // Not in a workspace or DB not available - fall back to no control mode
    }

    if (flags['new-tab']) {
      // Determine terminal app: explicit flag > auto-detect > error
      const terminalApp = flags.terminal ?? detectTerminalApp()
      if (!terminalApp) {
        this.log(styles.warning('Could not detect terminal emulator for new tab.'))
        this.log(styles.muted('Falling back to direct tmux attach in current terminal.'))
        this.log(styles.muted('Tip: Use --terminal <app> to specify your terminal (iTerm, Terminal, Ghostty).'))
        this.log('')
        this.attachInCurrentTerminal(useControlMode, sessionName)
        return
      }
      await this.openInNewTab(terminalApp, useControlMode, sessionName)
    } else {
      this.attachInCurrentTerminal(useControlMode, sessionName)
    }
  }

  private attachInCurrentTerminal(_useControlMode: boolean, sessionName: string): void {
    try {
      // Always use regular attach (no -CC) in current terminal.
      // Control mode sends raw tmux protocol sequences (%begin, %output, %end)
      // that render as garbled text unless iTerm's native CC handler is active
      // (only happens in new tabs opened via AppleScript).
      // Mouse mode is always on for current-terminal attach (enables scroll in tmux).
      try {
        execSync(`tmux set-option -t "${sessionName}" mouse on`, { stdio: 'pipe' })
      } catch {
        // Non-fatal: mouse mode is a convenience, don't block attach
      }

      const tmuxAttach = buildTmuxAttachCommand(false)
      execSync(`${tmuxAttach} -t "${sessionName}"`, { stdio: 'inherit' })
    } catch {
      this.error(`Failed to attach to orchestrator session "${sessionName}"`)
    }
  }

  private async openInNewTab(terminalApp: string, useControlMode: boolean, sessionName: string): Promise<void> {
    const title = 'Orchestrator'
    const tmuxAttach = buildTmuxAttachCommand(useControlMode)
    const attachCmd = `${tmuxAttach} -t "${sessionName}"`
    const mouseMode = useControlMode ? 'off' : 'on'

    const baseDir = path.join(os.homedir(), '.proletariat', 'scripts')
    fs.mkdirSync(baseDir, { recursive: true })
    const scriptPath = path.join(baseDir, `attach-orch-${Date.now()}.sh`)

    const script = `#!/bin/bash
# Set terminal tab title
echo -ne "\\033]0;${title}\\007"
echo -ne "\\033]1;${title}\\007"

# Set mouse mode before attaching
tmux set-option -t "${sessionName}" mouse ${mouseMode} 2>/dev/null || true

echo "Attaching to: ${sessionName}"
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

      this.log(styles.success('Opened new tab and attaching to orchestrator'))
    } catch (error) {
      this.error(`Failed to open terminal tab: ${error instanceof Error ? error.message : error}`)
    }
  }
}
