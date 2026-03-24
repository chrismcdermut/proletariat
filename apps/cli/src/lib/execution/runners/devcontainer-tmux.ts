/**
 * Devcontainer Tmux Display Handler
 *
 * Runs devcontainer commands in tmux sessions inside Docker containers.
 * Handles session creation, terminal tab opening, and attachment.
 */

import {
  execSync,
  fs,
  path,
  os,
  DisplayMode,
  ExecutionContext,
  ExecutionConfig,
  getSetTitleCommands,
} from './shared.js'

import {
  RunnerResult,
  buildTmuxWindowName,
  buildWindowTitle,
  shouldUseControlMode,
  buildTmuxMouseOption,
  buildTmuxAttachCommand,
  configureITermTmuxWindowMode,
} from './shared.js'

/**
 * Run devcontainer command in tmux session INSIDE the container.
 *
 * Architecture: Container tmux only (simple, no nesting)
 * 1. Start tmux session INSIDE the container (detached) - runs claude
 * 2. Open terminal tab that attaches directly to the container's tmux
 */
export async function runDevcontainerInTmux(
  context: ExecutionContext,
  devcontainerCmd: string,
  config: ExecutionConfig,
  displayMode: DisplayMode = 'terminal',
  containerId?: string,
  promptContainerPath?: string
): Promise<RunnerResult> {
  const sessionName = buildTmuxWindowName(context)
  const windowTitle = buildWindowTitle(context)
  const terminalApp = config.terminal.app
  const useControlMode = shouldUseControlMode(terminalApp, config.tmux.controlMode)

  try {
    let actualContainerId = containerId
    if (!actualContainerId) {
      const containerIdMatch = devcontainerCmd.match(/docker exec\s+(?:-it\s+)?(\S+)/)
      if (containerIdMatch) {
        actualContainerId = containerIdMatch[1]
      }
    }
    if (!actualContainerId) {
      return { success: false, error: 'Could not determine container ID for tmux session' }
    }

    // Check if tmux is available inside the container
    try {
      execSync(`docker exec ${actualContainerId} which tmux`, { stdio: 'pipe' })
    } catch {
      return {
        success: false,
        error: `tmux is not installed in the devcontainer. Add 'tmux' to your devcontainer's Dockerfile or use the default prlt devcontainer template.`,
      }
    }

    // Extract the claude command from the devcontainer command
    const cmdMatch = devcontainerCmd.match(/bash -c '(.+)'$/)
    const claudeCmd = cmdMatch ? cmdMatch[1] : devcontainerCmd

    const containerPostExec = context.isEphemeral
      ? `echo ""\necho "✅ Ephemeral agent work complete. Session will auto-close in 5s..."\nsleep 5\nexit 0`
      : `echo ""\necho "✅ Agent work complete. Press Enter to close or run more commands."\nexec bash`

    const promptWaitBlock = promptContainerPath
      ? `# TKT-099: Wait for prompt file to sync from host into container
PROMPT_WAIT=0
while [ ! -s "${promptContainerPath}" ] && [ $PROMPT_WAIT -lt 30 ]; do
  sleep 0.5
  PROMPT_WAIT=$((PROMPT_WAIT + 1))
done
if [ ! -s "${promptContainerPath}" ]; then
  echo "⚠️  Warning: Prompt file not available after 15s: ${promptContainerPath}"
fi
`
      : ''

    const tmuxScript = `#!/bin/bash
export TERM=xterm-256color
export COLORTERM=truecolor
unset CI
unset CLAUDECODE
echo "🚀 Starting: ${sessionName}"
echo ""
${promptWaitBlock}${claudeCmd}
${containerPostExec}
`
    const scriptPath = `/tmp/prlt-${sessionName}.sh`
    const mouseOption = buildTmuxMouseOption(useControlMode)

    // Write script to container
    try {
      execSync(`docker exec -i ${actualContainerId} bash -c 'cat > ${scriptPath} && chmod +x ${scriptPath}'`, {
        input: tmuxScript,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      return { success: false, error: `Failed to write script to container: ${error instanceof Error ? error.message : error}` }
    }

    // Kill existing session with same name if reusing container (TKT-1028)
    try {
      execSync(`docker exec ${actualContainerId} tmux has-session -t "${sessionName}" 2>&1`, { stdio: 'pipe' })
      console.debug(`[runners:tmux] Killing existing tmux session "${sessionName}" in container`)
      try {
        execSync(`docker exec ${actualContainerId} tmux kill-session -t "${sessionName}"`, { stdio: 'pipe' })
      } catch { /* kill-session may fail if session died between has-session and kill — non-fatal */ }
    } catch { /* Session doesn't exist */ }

    // Create tmux session
    const createSessionCmd = `tmux new-session -d -s "${sessionName}" -n "${sessionName}" "bash ${scriptPath}"${mouseOption} \\; set-option -g set-titles on \\; set-option -g set-titles-string "#{window_name}"`
    try {
      execSync(`docker exec ${actualContainerId} bash -c '${createSessionCmd}'`, { stdio: 'pipe' })
    } catch (error) {
      return { success: false, error: `Failed to create tmux session inside container: ${error instanceof Error ? error.message : error}` }
    }

    // Background mode: return after session creation
    if (displayMode === 'background') {
      await new Promise(resolve => setTimeout(resolve, 500))
      try {
        execSync(`docker exec ${actualContainerId} tmux has-session -t "${sessionName}" 2>&1`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
      } catch {
        return { success: false, error: `Failed to verify tmux session "${sessionName}" inside container.` }
      }
      return { success: true, containerId: actualContainerId, sessionId: sessionName }
    }

    // Foreground mode: attach in current terminal
    if (displayMode === 'foreground') {
      try {
        const fgTmuxAttach = buildTmuxAttachCommand(false, true)
        execSync(`clear && docker exec -it ${actualContainerId} ${fgTmuxAttach} -t "${sessionName}"`, { stdio: 'inherit' })
        return { success: true, containerId: actualContainerId, sessionId: sessionName }
      } catch (error) {
        return { success: false, error: `Failed to attach to container tmux session: ${error instanceof Error ? error.message : error}` }
      }
    }

    // Terminal mode: open new tab
    const tmuxAttach = buildTmuxAttachCommand(useControlMode, true)
    const attachCmd = `docker exec -it ${actualContainerId} ${tmuxAttach} -t "${sessionName}"`

    // iTerm control mode: direct -CC attach
    if (terminalApp === 'iTerm' && useControlMode) {
      configureITermTmuxWindowMode(config.tmux.windowMode)
      const openInBackground = config.terminal.openInBackground ?? true
      if (openInBackground) {
        execSync(`osascript -e '
          set frontApp to path to frontmost application as text
          tell application "iTerm"
            tell current window
              set newTab to (create tab with default profile)
              tell current session of newTab
                write text "docker exec -it ${actualContainerId} tmux -u -CC attach -d -t \\"${sessionName}\\""
              end tell
            end tell
          end tell
          tell application frontApp to activate
        '`)
      } else {
        execSync(`osascript -e '
          tell application "iTerm"
            activate
            tell current window
              set newTab to (create tab with default profile)
              tell current session of newTab
                write text "docker exec -it ${actualContainerId} tmux -u -CC attach -d -t \\"${sessionName}\\""
              end tell
            end tell
          end tell
        '`)
      }
      return { success: true, containerId: actualContainerId, sessionId: sessionName }
    }

    // Other terminals: create script file and open tab
    const baseDir = context.hqPath
      ? path.join(context.hqPath, '.proletariat', 'scripts')
      : path.join(os.homedir(), '.proletariat', 'scripts')
    fs.mkdirSync(baseDir, { recursive: true })
    const hostScriptPath = path.join(baseDir, `attach-${sessionName}-${Date.now()}.sh`)
    const setTitleCmds = getSetTitleCommands(windowTitle)

    const hostScript = `#!/bin/bash
${setTitleCmds}
# Attach to container tmux session
${attachCmd}
rm -f "${hostScriptPath}"
exec $SHELL
`
    fs.writeFileSync(hostScriptPath, hostScript, { mode: 0o755 })
    const openInBackground = config.terminal.openInBackground ?? true

    switch (terminalApp) {
      case 'iTerm':
        if (openInBackground) {
          execSync(`osascript -e '
            tell application "System Events"
              set frontApp to name of first application process whose frontmost is true
              set frontAppBundle to bundle identifier of first application process whose frontmost is true
            end tell
            tell application "iTerm"
              if (count of windows) = 0 then
                create window with default profile
                tell current session of current window
                  set name to "${windowTitle}"
                  write text "${hostScriptPath}"
                end tell
              else
                tell current window
                  create tab with default profile
                  tell current session
                    set name to "${windowTitle}"
                    write text "${hostScriptPath}"
                  end tell
                end tell
              end if
            end tell
            delay 0.2
            tell application "System Events"
              set frontmost of process frontApp to true
            end tell
            delay 0.1
            do shell script "open -b " & quoted form of frontAppBundle
          '`)
        } else {
          execSync(`osascript -e '
            tell application "iTerm"
              activate
              if (count of windows) = 0 then
                create window with default profile
                tell current session of current window
                  set name to "${windowTitle}"
                  write text "${hostScriptPath}"
                end tell
              else
                tell current window
                  create tab with default profile
                  tell current session
                    set name to "${windowTitle}"
                    write text "${hostScriptPath}"
                  end tell
                end tell
              end if
            end tell
          '`)
        }
        break
      case 'Ghostty':
        execSync(`osascript -e '
          tell application "Ghostty" to activate
          tell application "System Events"
            tell process "Ghostty"
              keystroke "t" using command down
              delay 0.3
              keystroke "${hostScriptPath}"
              keystroke return
            end tell
          end tell
        '`)
        break
      case 'Terminal':
      default:
        if (openInBackground) {
          execSync(`osascript -e 'tell application "Terminal" to do script "${hostScriptPath}"'`)
        } else {
          execSync(`osascript -e '
            tell application "Terminal"
              activate
              tell application "System Events"
                tell process "Terminal"
                  keystroke "t" using command down
                end tell
              end tell
              delay 0.3
              do script "${hostScriptPath}" in front window
            end tell
          '`)
        }
        break
    }

    return { success: true, containerId: actualContainerId, sessionId: sessionName }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to start tmux session in container' }
  }
}
