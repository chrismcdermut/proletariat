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
import { getHostTmuxSessionNames } from '../../lib/execution/session-utils.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { findHQRoot } from '../../lib/workspace.js'
import { getHeadquartersNameFromPath } from '../../lib/machine-config.js'
import { loadExecutionConfig, shouldUseControlMode, buildTmuxAttachCommand } from '../../lib/execution/index.js'
import {
  buildOrchestratorSessionName,
  buildOrchestratorContainerName,
  findRunningOrchestratorSessions,
  findHQOrchestratorSessions,
  findHQOrchestratorContainers,
  findRunningOrchestratorContainers,
  getOrchestratorContainerId,
  enrichOrchestratorSession,
  formatOrchestratorSessionLabel,
  type OrchestratorSessionInfo,
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

    // Track whether the resolved session is in a Docker container
    let isDockerSession = false
    let dockerContainerId: string | undefined

    // Resolve session name: try HQ-scoped first, fall back to discovery
    let sessionName: string | undefined
    const hqPath = findHQRoot(process.cwd())

    // Discover ALL orchestrator sessions (host + Docker), enriched with HQ context.
    // Used for both the picker and the "session not found" error message.
    const allRunningSessions: OrchestratorSessionInfo[] = [
      ...findRunningOrchestratorSessions(hostSessions).map(s => enrichOrchestratorSession(s, false)),
      ...findRunningOrchestratorContainers().map(c => enrichOrchestratorSession(c, true)),
    ]

    if (hqPath) {
      const hqName = getHeadquartersNameFromPath(hqPath)

      if (flags.name) {
        // Explicit --name: look for that specific orchestrator (host tmux first, then Docker)
        sessionName = buildOrchestratorSessionName(hqName, flags.name)
        if (!hostSessions.includes(sessionName)) {
          // Not found as host tmux session, check Docker
          const containerName = buildOrchestratorContainerName(hqName, flags.name)
          const containerId = getOrchestratorContainerId(containerName)
          if (containerId) {
            sessionName = containerName
            isDockerSession = true
            dockerContainerId = containerId
          } else {
            sessionName = undefined
          }
        }

        if (!sessionName) {
          // Named session does not exist — surface available sessions in the error.
          this.reportNamedSessionNotFound(flags.name, allRunningSessions, flags, jsonMode)
          return
        }
      } else {
        // No --name: discover ALL orchestrators in this HQ (host tmux + Docker)
        const hqInfos: OrchestratorSessionInfo[] = [
          ...findHQOrchestratorSessions(hostSessions, hqName).map(s => enrichOrchestratorSession(s, false)),
          ...findHQOrchestratorContainers(hqName).map(c => enrichOrchestratorSession(c, true)),
        ]

        if (hqInfos.length === 1) {
          sessionName = hqInfos[0].sessionId
          isDockerSession = hqInfos[0].isDocker
          if (isDockerSession) {
            dockerContainerId = getOrchestratorContainerId(sessionName) || undefined
          }
        } else if (hqInfos.length > 1) {
          const picked = await this.pickOrchestratorSession(hqInfos, flags, jsonMode, 'attach')
          if (!picked) return
          sessionName = picked.sessionId
          isDockerSession = picked.isDocker
          if (isDockerSession) {
            dockerContainerId = getOrchestratorContainerId(sessionName) || undefined
          }
        }
        // If 0 found, fall through to global discovery below
      }
    }

    // If not in HQ or session not found, discover running orchestrator sessions globally
    if (!sessionName) {
      if (allRunningSessions.length === 0) {
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

      // Global --name lookup: when called outside an HQ with --name, match by
      // orchestrator name across all running sessions.
      if (flags.name) {
        const matches = allRunningSessions.filter(s => s.orchestratorName === flags.name)
        if (matches.length === 0) {
          this.reportNamedSessionNotFound(flags.name, allRunningSessions, flags, jsonMode)
          return
        }
        if (matches.length === 1) {
          sessionName = matches[0].sessionId
          isDockerSession = matches[0].isDocker
          if (isDockerSession) {
            dockerContainerId = getOrchestratorContainerId(sessionName) || undefined
          }
        } else {
          // Multiple matches across HQs — let the user disambiguate.
          const picked = await this.pickOrchestratorSession(matches, flags, jsonMode, 'attach')
          if (!picked) return
          sessionName = picked.sessionId
          isDockerSession = picked.isDocker
          if (isDockerSession) {
            dockerContainerId = getOrchestratorContainerId(sessionName) || undefined
          }
        }
      } else if (allRunningSessions.length === 1) {
        sessionName = allRunningSessions[0].sessionId
        isDockerSession = allRunningSessions[0].isDocker
        if (isDockerSession) {
          dockerContainerId = getOrchestratorContainerId(sessionName) || undefined
        }
      } else {
        const picked = await this.pickOrchestratorSession(allRunningSessions, flags, jsonMode, 'attach')
        if (!picked) return
        sessionName = picked.sessionId
        isDockerSession = picked.isDocker
        if (isDockerSession) {
          dockerContainerId = getOrchestratorContainerId(sessionName) || undefined
        }
      }
    }

    if (!sessionName) {
      return
    }

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

  /**
   * Show a picker for orchestrator sessions and return the selected one.
   * In JSON mode, emits a prompt config and returns null (caller should bail).
   */
  private async pickOrchestratorSession(
    infos: OrchestratorSessionInfo[],
    flags: Record<string, unknown>,
    jsonMode: boolean,
    action: 'attach' | 'stop',
  ): Promise<OrchestratorSessionInfo | null> {
    const sessionChoices = infos.map(info => ({
      name: formatOrchestratorSessionLabel(info),
      value: info.sessionId,
      command: `prlt orchestrator ${action} --name "${info.orchestratorName}" --json`,
    }))
    const selectMessage =
      action === 'attach'
        ? 'Select orchestrator to attach to:'
        : 'Select orchestrator to stop:'

    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'session', selectMessage, sessionChoices),
        createMetadata(`orchestrator ${action}`, flags),
      )
      return null
    }

    const { session } = await this.prompt<{ session: string }>([{
      type: 'list',
      name: 'session',
      message: selectMessage,
      choices: sessionChoices,
    }])

    return infos.find(info => info.sessionId === session) || null
  }

  /**
   * Surface a "session not found" error that lists available sessions and
   * their HQ context, so the user can pick a valid name without guessing.
   */
  private reportNamedSessionNotFound(
    requestedName: string,
    available: OrchestratorSessionInfo[],
    flags: Record<string, unknown>,
    jsonMode: boolean,
  ): void {
    const availableSummary = available.length === 0
      ? 'No orchestrator sessions are currently running.'
      : `Available sessions:\n${available.map(info => `  - ${formatOrchestratorSessionLabel(info)}`).join('\n')}`

    const message = `Orchestrator session "${requestedName}" not found. ${availableSummary}`

    if (jsonMode) {
      outputErrorAsJson(
        'SESSION_NOT_FOUND',
        message,
        createMetadata('orchestrator attach', flags),
      )
      return
    }

    this.log('')
    this.log(styles.warning(`Orchestrator session "${requestedName}" not found.`))
    if (available.length === 0) {
      this.log(styles.muted('No orchestrator sessions are currently running.'))
      this.log(styles.muted('Start one with: prlt orchestrator start'))
    } else {
      this.log('')
      this.log(styles.muted('Available sessions:'))
      for (const info of available) {
        this.log(styles.muted(`  - ${formatOrchestratorSessionLabel(info)}`))
      }
    }
    this.log('')
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
