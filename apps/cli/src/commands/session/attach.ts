import { Args, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { loadExecutionConfig, shouldUseControlMode, buildTmuxAttachCommand } from '../../lib/execution/index.js'
import { detectTerminalApp } from '../orchestrator/attach.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  collectAllSessions,
  groupSessionsByHQ,
  tildifyPath,
  type UnifiedSession,
} from '../../lib/session/renderer.js'
import { findHQRoot } from '../../lib/workspace.js'

interface SessionChoice {
  name: string           // Session name (for display)
  sessionId: string      // Actual tmux session ID
  type: 'host' | 'container'
  containerId?: string
  ticketId: string
  agentName: string
  hqName?: string
}

export default class SessionAttach extends PMOCommand {
  static description = 'Attach to an active agent session (DB-first: only attaches to tracked executions)'

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
      description: 'Open in a new terminal tab (requires macOS + supported terminal)',
      default: false,
    }),
    'current-terminal': Flags.boolean({
      char: 'c',
      description: 'Attach in current terminal (this is now the default behavior)',
      default: false,
    }),
    terminal: Flags.string({
      char: 't',
      description: 'Terminal app to use for --new-tab (iTerm, Terminal, Ghostty)',
    }),
    here: Flags.boolean({
      description: 'Filter picker to sessions in the current HQ only',
      default: false,
      exclusive: ['hq'],
    }),
    hq: Flags.string({
      description: 'Filter picker to sessions in a specific HQ path',
      exclusive: ['here'],
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

    // Resolve HQ filter from --here / --hq
    let hqPathFilter: string | undefined
    if (flags.here) {
      const cwdHq = findHQRoot(process.cwd())
      if (cwdHq) hqPathFilter = cwdHq
    } else if (flags.hq) {
      hqPathFilter = flags.hq
    }

    // Always query machine-wide so sessions in other HQs are visible.
    const allSessions = collectAllSessions({ hqPathFilter, includeAll: false })
    const sessions: SessionChoice[] = allSessions
      .filter(s => s.exists)
      .map(toSessionChoice)

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
      // Group sessions by HQ for the picker so the current HQ bubbles up first.
      const grouped = groupSessionsByHQ(allSessions.filter(s => s.exists))
      const orderedUnified: UnifiedSession[] = [...grouped.here, ...grouped.elsewhere]
      const orderedChoices = orderedUnified.map(toSessionChoice)

      const labelFor = (u: UnifiedSession): string => {
        const hqLabel = u.hqPath ? tildifyPath(u.hqPath) : '(no HQ)'
        const tag = u.environment === 'container' ? 'container' : 'host'
        return `${u.agentName.padEnd(18)} ${u.ticketId.padEnd(14)} ${tag.padEnd(10)} ${hqLabel}`
      }

      // Print a grouped preview banner above the picker so the user can see
      // which sessions belong to the current HQ vs other locations.
      if (!jsonMode) {
        if (grouped.currentHq) {
          this.log('')
          this.log(
            styles.header(
              `Current HQ: ${tildifyPath(grouped.currentHq)} (${grouped.here.length} session${grouped.here.length === 1 ? '' : 's'})`,
            ),
          )
        }
        if (grouped.elsewhere.length > 0) {
          const elsewhereLabel = `Other locations: ${grouped.elsewhere.length} session${grouped.elsewhere.length === 1 ? '' : 's'}`
          this.log(styles.muted(elsewhereLabel))
        }
      }

      const selected = await this.selectFromList({
        message: 'Select a session to attach to:',
        items: orderedUnified,
        getName: labelFor,
        getValue: (u) => u.sessionId,
        getCommand: (u) => `prlt session attach "${u.sessionId}" --json`,
        jsonMode: jsonMode ? { flags, commandName: 'session attach' } : null,
      })

      if (!selected) {
        return
      }

      selectedSession = orderedChoices.find(s => s.sessionId === selected)
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

    // Default to current terminal; --new-tab is opt-in (requires macOS + AppleScript)
    if (flags['new-tab']) {
      const terminalApp = flags.terminal ?? detectTerminalApp()
      if (!terminalApp) {
        this.log(styles.warning('Could not detect terminal emulator for new tab.'))
        this.log(styles.muted('Falling back to direct attach in current terminal.'))
        this.log(styles.muted('Tip: Use --terminal <app> to specify your terminal (iTerm, Terminal, Ghostty).'))
        this.log('')
        await this.attachInCurrentTerminal(selectedSession, useControlMode)
      } else {
        await this.attachInNewTab(selectedSession, terminalApp, useControlMode)
      }
    } else {
      await this.attachInCurrentTerminal(selectedSession, useControlMode)
    }
  }


  /**
   * Attach to session in current terminal
   */
  private async attachInCurrentTerminal(session: SessionChoice, useControlMode: boolean): Promise<void> {
    // TTY check: docker exec -it and tmux attach both require an interactive terminal
    if (!process.stdin.isTTY) {
      this.error(
        'Cannot attach to session: stdin is not a TTY.\n' +
        'Run this command from an interactive terminal, or use "prlt session peek" to view output non-interactively.'
      )
    }

    // Handle synthetic container:* session IDs — these indicate the container is
    // running but no tmux session was found during discovery. Try to find a
    // tmux session now, or fall back to an interactive shell.
    let resolvedSessionId: string | null = session.sessionId
    if (session.type === 'container' && session.containerId && session.sessionId.startsWith('container:')) {
      resolvedSessionId = this.resolveContainerSession(session.containerId)
    }

    try {
      // Set mouse mode based on attach type:
      // - Plain terminal: mouse on (enables scroll in tmux; hold Shift/Option to bypass)
      // - iTerm -CC: mouse off (iTerm handles scrolling natively)
      const mouseMode = useControlMode ? 'off' : 'on'

      if (session.type === 'container' && session.containerId) {
        if (resolvedSessionId) {
          try {
            execSync(`docker exec ${session.containerId} tmux set-option -t "${resolvedSessionId}" mouse ${mouseMode}`, { stdio: 'pipe' })
          } catch {
            // Non-fatal: mouse mode is a convenience, don't block attach
          }
          const tmuxAttach = buildTmuxAttachCommand(useControlMode, true)
          execSync(`docker exec -it ${session.containerId} ${tmuxAttach} -t "${resolvedSessionId}"`, { stdio: 'inherit' })
        } else {
          // No tmux session found — fall back to interactive shell in the container
          this.log(styles.warning('No tmux session found inside container. Opening interactive shell.'))
          execSync(`docker exec -it ${session.containerId} bash`, { stdio: 'inherit' })
        }
      } else {
        try {
          execSync(`tmux set-option -t "${resolvedSessionId}" mouse ${mouseMode}`, { stdio: 'pipe' })
        } catch {
          // Non-fatal: mouse mode is a convenience, don't block attach
        }
        const tmuxAttach = buildTmuxAttachCommand(useControlMode, false)
        execSync(`${tmuxAttach} -t "${resolvedSessionId}"`, { stdio: 'inherit' })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.error(`Failed to attach to ${session.type} session "${resolvedSessionId ?? session.sessionId}": ${msg}`)
    }
  }

  /**
   * Try to find an actual tmux session inside a container.
   * Returns the session name, or null if no tmux sessions exist.
   */
  private resolveContainerSession(containerId: string): string | null {
    try {
      const output = execSync(
        `docker exec ${containerId} tmux list-sessions -F "#{session_name}" 2>/dev/null`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()
      if (output) {
        const sessions = output.split('\n')
        return sessions[0] // Return the first available session
      }
    } catch {
      // No tmux server or sessions in container
    }
    return null
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

    // Resolve synthetic container:* session IDs for new-tab attach scripts
    let resolvedSessionId = session.sessionId
    if (session.type === 'container' && session.containerId && session.sessionId.startsWith('container:')) {
      resolvedSessionId = this.resolveContainerSession(session.containerId) ?? session.sessionId
    }

    // Different attach command for container vs host sessions
    const tmuxAttach = buildTmuxAttachCommand(useControlMode, session.type === 'container')
    const attachCmd = session.type === 'container' && session.containerId
      ? `docker exec -it ${session.containerId} ${tmuxAttach} -t "${resolvedSessionId}"`
      : `${tmuxAttach} -t "${resolvedSessionId}"`

    // Set mouse mode based on attach type
    const mouseMode = useControlMode ? 'off' : 'on'
    const mouseCmd = session.type === 'container' && session.containerId
      ? `docker exec ${session.containerId} tmux set-option -t "${resolvedSessionId}" mouse ${mouseMode} 2>/dev/null || true`
      : `tmux set-option -t "${resolvedSessionId}" mouse ${mouseMode} 2>/dev/null || true`

    const script = `#!/bin/bash
# Set terminal tab title
echo -ne "\\033]0;${title}\\007"
echo -ne "\\033]1;${title}\\007"

# Set mouse mode before attaching
${mouseCmd}

echo "Attaching to: ${resolvedSessionId} (${session.type})"
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
      const msg = error instanceof Error ? error.message : String(error)
      this.error(`Failed to open terminal tab with ${terminalApp}: ${msg}`)
    }
  }
}

/**
 * Convert a UnifiedSession (machine-wide collector format) into the SessionChoice
 * shape used by this command's attach helpers.
 */
function toSessionChoice(s: UnifiedSession): SessionChoice {
  return {
    name: s.sessionId,
    sessionId: s.sessionId,
    type: s.environment === 'container' ? 'container' : 'host',
    containerId: s.containerId,
    ticketId: s.ticketId,
    agentName: s.agentName,
    hqName: s.hqName,
  }
}
