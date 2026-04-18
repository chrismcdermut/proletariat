/**
 * Devcontainer Terminal Display Handler
 *
 * Opens devcontainer commands in new terminal windows/tabs.
 * Supports iTerm, Ghostty, WezTerm, Kitty, Alacritty, and Terminal.app.
 */

import {
  execSync,
  fs,
  path,
  os,
  ExecutionContext,
  ExecutionConfig,
  getSetTitleCommands,
} from './shared.js'

import {
  RunnerResult,
  buildWindowTitle,
} from './shared.js'

/**
 * Run devcontainer command in a new terminal window.
 * Uses a temp script file to avoid shell escaping issues with complex prompts.
 */
export async function runDevcontainerInTerminal(
  context: ExecutionContext,
  devcontainerCmd: string,
  config: ExecutionConfig
): Promise<RunnerResult> {
  if (process.platform !== 'darwin') {
    return {
      success: false,
      error: 'Terminal mode is only supported on macOS. Use background mode instead.',
    }
  }

  const terminalApp = config.terminal.app

  // Write command to temp script to avoid shell escaping issues
  const baseDir = context.hqPath
    ? path.join(context.hqPath, '.proletariat', 'scripts')
    : path.join(os.homedir(), '.proletariat', 'scripts')
  fs.mkdirSync(baseDir, { recursive: true })
  const scriptPath = path.join(baseDir, `exec-${context.ticketId}-${Date.now()}.sh`)

  const windowTitle = buildWindowTitle(context)
  const setTitleCmds = getSetTitleCommands(windowTitle)

  // Ephemeral agents auto-close after completion
  const postExecBlock = context.isEphemeral
    ? `echo ""
echo "✅ Ephemeral agent work complete. Session will auto-close in 5s..."
sleep 5
exit 0`
    : `# Keep shell open after completion
exec $SHELL`

  const scriptContent = `#!/bin/bash
# Auto-generated script for ticket ${context.ticketId}
${setTitleCmds}
echo "🚀 Starting ticket execution: ${context.ticketId}"
echo ""

# Run the ticket
${devcontainerCmd}

# Clean up script file
rm -f "${scriptPath}"

${postExecBlock}
`
  fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 })

  const openInBackground = config.terminal.openInBackground ?? true

  try {
    switch (terminalApp) {
      case 'iTerm':
        if (openInBackground) {
          execSync(`osascript -e '
            -- Save the currently active application and window
            tell application "System Events"
              set frontApp to name of first application process whose frontmost is true
              set frontAppBundle to bundle identifier of first application process whose frontmost is true
            end tell

            tell application "iTerm"
              if (count of windows) = 0 then
                create window with default profile
                tell current session of current window
                  write text "${scriptPath}"
                end tell
              else
                tell current window
                  set newTab to (create tab with default profile)
                  tell current session of newTab
                    write text "${scriptPath}"
                  end tell
                end tell
              end if
            end tell

            -- Restore focus to the original application
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
                  write text "${scriptPath}"
                end tell
              else
                tell current window
                  set newTab to (create tab with default profile)
                  tell current session of newTab
                    write text "${scriptPath}"
                  end tell
                end tell
              end if
            end tell
          '`)
        }
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
              keystroke "source ${scriptPath}"
              keystroke return
            end tell
          end tell
        '`)
        break

      case 'WezTerm':
        execSync(`wezterm cli spawn --new-window -- bash -c 'source ${scriptPath}'`)
        break

      case 'Kitty':
        execSync(`kitty @ launch --type=tab -- bash -c 'source ${scriptPath}'`)
        break

      case 'Alacritty':
        execSync(`osascript -e '
          tell application "Alacritty"
            activate
          end tell
          tell application "System Events"
            tell process "Alacritty"
              keystroke "n" using command down
              delay 0.3
              keystroke "source ${scriptPath}"
              keystroke return
            end tell
          end tell
        '`)
        break

      case 'Terminal':
      default:
        if (openInBackground) {
          execSync(`osascript -e '
            tell application "Terminal"
              do script "source ${scriptPath}"
            end tell
          '`)
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
              do script "source ${scriptPath}" in front window
            end tell
          '`)
        }
        break
    }

    return {
      success: true,
      containerId: `devcontainer-${context.agentName}`,
      sessionId: `terminal-${context.ticketId}`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : `Failed to open ${terminalApp}`,
    }
  }
}
