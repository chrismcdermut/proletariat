import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
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
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { loadExecutionConfig, shouldUseControlMode, buildTmuxAttachCommand } from '../../lib/execution/index.js'
import {
  collectAllSessions,
  groupSessionsByHQ,
  tildifyPath,
  type UnifiedSession,
} from '../../lib/session/renderer.js'
import { formatAvailableSessions } from '../../lib/orchestrator/format.js'

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
      description: 'Name of the orchestrator to attach to (matches agentName)',
    }),
    scope: Flags.string({
      char: 's',
      description: 'Scope of orchestrator sessions to show (current HQ or all HQs)',
      options: ['current', 'all'],
      default: 'current',
    }),
    here: Flags.boolean({
      description: '[deprecated] Now the default behavior. Use --scope all to see all HQs.',
      default: false,
      hidden: true,
    }),
    hq: Flags.string({
      description: 'Filter to orchestrators in a specific HQ path',
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

    // Resolve scope: --hq overrides --scope, --here is deprecated (now the default)
    const scopeAll = flags.scope === 'all'

    // Resolve explicit HQ filter (--hq flag takes precedence over scope)
    let hqPathFilter: string | undefined
    if (flags.hq) {
      hqPathFilter = flags.hq
    }

    // Collect ALL orchestrator sessions machine-wide first, then apply scoping
    const allOrchestrators = collectAllSessions({
      hqPathFilter,
      roleFilter: 'orchestrator',
      includeAll: false,
    })

    // Optional --name filter
    let filteredOrchestrators = allOrchestrators
    if (flags.name) {
      const needle = flags.name.toLowerCase()
      filteredOrchestrators = filteredOrchestrators.filter(
        s =>
          s.agentName.toLowerCase() === needle ||
          s.agentName.toLowerCase().includes(needle) ||
          s.sessionId.toLowerCase().includes(needle),
      )

      // Named session not found — surface available sessions instead of a generic "not running"
      if (filteredOrchestrators.length === 0 && allOrchestrators.length > 0) {
        const available = formatAvailableSessions(allOrchestrators)
        const message = `No orchestrator session matches --name "${flags.name}". Available: ${available}`
        if (jsonMode) {
          outputErrorAsJson(
            'NAME_NOT_FOUND',
            message,
            createMetadata('orchestrator attach', flags),
          )
          return
        }
        this.log('')
        this.log(styles.warning(`No orchestrator session matches --name "${flags.name}".`))
        this.log(styles.muted(`Available: ${available}`))
        this.log('')
        return
      }
    }

    // Group sessions by HQ for scope filtering
    const grouped = groupSessionsByHQ(filteredOrchestrators)
    const currentHqPath = grouped.currentHq

    // Apply scope filtering: default is current-HQ only
    let orchestrators: UnifiedSession[]
    let hiddenElsewhereCount = 0

    if (scopeAll || !currentHqPath) {
      // --scope all or not in any HQ: show everything
      orchestrators = filteredOrchestrators
    } else {
      // Default (--scope current): show only current-HQ sessions
      orchestrators = grouped.here
      hiddenElsewhereCount = grouped.elsewhere.length
    }

    // Handle empty results with scope awareness
    if (orchestrators.length === 0) {
      // Check if there are sessions in other HQs that were filtered out
      if (hiddenElsewhereCount > 0) {
        if (jsonMode) {
          outputErrorAsJson(
            'NO_CURRENT_HQ_SESSION',
            `No orchestrator running in current HQ. ${hiddenElsewhereCount} orchestrator${hiddenElsewhereCount === 1 ? '' : 's'} in other HQs. Use --scope all to see them, or start one with: prlt orchestrator start`,
            createMetadata('orchestrator attach', flags),
          )
          return
        }
        this.log('')
        this.log(styles.warning('No orchestrator running in current HQ.'))
        this.log(styles.muted(`${hiddenElsewhereCount} orchestrator${hiddenElsewhereCount === 1 ? '' : 's'} in other HQs. Use --scope all to see ${hiddenElsewhereCount === 1 ? 'it' : 'them'}.`))
        this.log(styles.muted('Start one here with: prlt orchestrator start'))
        this.log('')
        return
      }

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
    }

    // Pick a single orchestrator
    let picked: UnifiedSession | undefined
    if (orchestrators.length === 1) {
      // Show a note about hidden sessions even when auto-picking
      if (hiddenElsewhereCount > 0 && !jsonMode) {
        this.log('')
        this.log(styles.muted(`${hiddenElsewhereCount} orchestrator${hiddenElsewhereCount === 1 ? '' : 's'} in other HQs. Use --scope all to see ${hiddenElsewhereCount === 1 ? 'it' : 'them'}.`))
      }
      picked = orchestrators[0]
    } else {
      const selectMessage = 'Select orchestrator session:'
      const sessionChoices = orchestrators.map(s => {
        const hqLabel = s.hqPath ? tildifyPath(s.hqPath) : '(no HQ)'
        const tag = s.environment === 'container' ? ' (Docker)' : ''
        const hqTag = scopeAll && currentHqPath && s.hqPath === currentHqPath ? ' (current HQ)' : ''
        return {
          name: `${s.agentName}${tag} — ${hqLabel}${hqTag}`,
          value: s.sessionId,
          command: `prlt orchestrator attach --name "${s.agentName}" --json`,
        }
      })

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'session', selectMessage, sessionChoices),
          createMetadata('orchestrator attach', flags),
        )
        return
      }

      this.log('')
      if (hiddenElsewhereCount > 0) {
        this.log(styles.muted(`${hiddenElsewhereCount} orchestrator${hiddenElsewhereCount === 1 ? '' : 's'} in other HQs. Use --scope all to see ${hiddenElsewhereCount === 1 ? 'it' : 'them'}.`))
        this.log('')
      }

      const { session } = await this.prompt<{ session: string }>([{
        type: 'list',
        name: 'session',
        message: selectMessage,
        choices: sessionChoices,
      }])
      picked = orchestrators.find(s => s.sessionId === session)
    }

    if (!picked) {
      return
    }

    const sessionName: string = picked.sessionId
    const isDockerSession = picked.environment === 'container'
    const dockerContainerId = picked.containerId

    if (jsonMode) {
      outputSuccessAsJson({
        sessionId: sessionName,
        containerId: dockerContainerId,
        environment: isDockerSession ? 'docker' : 'host',
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
    this.log(styles.info(`Attaching to orchestrator session: ${sessionName}${isDockerSession ? ' (Docker)' : ''}`))

    // Docker-based orchestrator: attach via docker exec
    if (isDockerSession && dockerContainerId) {
      if (flags['new-tab']) {
        const terminalApp = flags.terminal ?? detectTerminalApp()
        if (!terminalApp) {
          this.log(styles.warning('Could not detect terminal emulator for new tab.'))
          this.log(styles.muted('Falling back to direct attach in current terminal.'))
        } else {
          await this.openDockerInNewTab(terminalApp, dockerContainerId, sessionName)
          return
        }
      }
      // Attach directly in current terminal
      try {
        execSync(`docker exec -it ${dockerContainerId} tmux attach -t "${sessionName}"`, { stdio: 'inherit' })
      } catch {
        this.error(`Failed to attach to Docker orchestrator session "${sessionName}"`)
      }
      return
    }

    // Host-based orchestrator: attach via tmux
    // Determine if we should use tmux control mode (-u -CC) for iTerm
    let useControlMode = false
    try {
      const workspaceInfo = getWorkspaceInfo()
      const db = openWorkspaceDatabase(workspaceInfo.path)
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

  private async openDockerInNewTab(terminalApp: string, containerId: string, sessionName: string): Promise<void> {
    const title = 'Orchestrator (Docker)'
    const baseDir = path.join(os.homedir(), '.proletariat', 'scripts')
    fs.mkdirSync(baseDir, { recursive: true })
    const scriptPath = path.join(baseDir, `attach-orch-docker-${Date.now()}.sh`)

    const script = `#!/bin/bash
echo -ne "\\033]0;${title}\\007"
echo -ne "\\033]1;${title}\\007"
echo "Attaching to Docker orchestrator: ${sessionName}"
docker exec -it ${containerId} tmux attach -t "${sessionName}"
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

      this.log(styles.success('Opened new tab and attaching to Docker orchestrator'))
    } catch (error) {
      this.error(`Failed to open terminal tab: ${error instanceof Error ? error.message : error}`)
    }
  }
}
