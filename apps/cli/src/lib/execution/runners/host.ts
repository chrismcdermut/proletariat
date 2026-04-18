/**
 * Host Runner — tmux session persistence on macOS
 */

import {
  execSync, fs, path, os,   DisplayMode, PermissionMode, ExecutorType,
  ExecutionContext, ExecutionConfig, getSetTitleCommands,
  resolveCodexExecutionContext, validateCodexMode, getCodexCommand, resolveToolsForSpawn,
  RunnerResult, buildWindowTitle, buildTmuxWindowName,
  buildPrompt, buildOrchestratorSystemPrompt, getExecutorCommand, isClaudeExecutor,
  shouldUseControlMode, buildTmuxMouseOption, buildTmuxAttachCommand, configureITermTmuxWindowMode,
} from './shared.js'
import { buildSrtCommand } from './sandbox.js'

/**
 * Run command on the host machine with tmux session for persistence.
 * Supports multiple terminal emulators on macOS.
 *
 * Architecture (same as devcontainer):
 * - Always creates a host tmux session for session persistence
 * - displayMode controls whether to open a terminal tab attached to the session
 * - User can reattach with `prlt session attach` if tab is closed
 */
export async function runHost(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig,
  displayMode: DisplayMode = 'terminal'
): Promise<RunnerResult> {
  // Session name: {ticketId}-{action} (e.g., TKT-347-implement)
  const sessionName = buildTmuxWindowName(context)
  const windowTitle = buildWindowTitle(context)

  const prompt = buildPrompt(context)
  // Terminal - use permission mode setting
  const skipPermissions = config.permissionMode === 'danger'

  // Validate Codex mode combination before proceeding
  if (executor === 'codex') {
    const codexPermission: PermissionMode = config.permissionMode
    const codexContext = resolveCodexExecutionContext(displayMode, config.outputMode)
    const modeError = validateCodexMode(codexPermission, codexContext)
    if (modeError) {
      return { success: false, error: modeError.message }
    }
  }

  const { cmd, args: _args } = getExecutorCommand(executor, prompt, skipPermissions)

  // Write command to temp script to avoid shell escaping issues
  // Use HQ .proletariat/scripts if available, otherwise fallback to home dir
  const baseDir = context.hqPath
    ? path.join(context.hqPath, '.proletariat', 'scripts')
    : path.join(os.homedir(), '.proletariat', 'scripts')
  fs.mkdirSync(baseDir, { recursive: true })

  const timestamp = Date.now()
  const scriptPath = path.join(baseDir, `exec-${context.ticketId}-${timestamp}.sh`)
  const promptPath = path.join(baseDir, `prompt-${context.ticketId}-${timestamp}.txt`)

  // For orchestrator sessions with Claude Code, split the prompt:
  // - System prompt (role/tools/context) → injected via --system-prompt flag
  // - User message (action instructions or default) → passed as the initial message
  // Non-Claude executors get the full combined prompt as the user message.
  let systemPromptPath: string | null = null
  if (context.isOrchestrator && isClaudeExecutor(executor)) {
    const systemPrompt = buildOrchestratorSystemPrompt(context)
    systemPromptPath = path.join(baseDir, `system-prompt-${context.ticketId}-${timestamp}.txt`)
    fs.writeFileSync(systemPromptPath, systemPrompt, { mode: 0o644 })

    // Override user message: just action instructions or a default startup message
    const userMessage = context.actionPrompt
      || 'Assess the current state of the project:\n'
        + '1. Check the board: `prlt board view` — what tickets are in progress, blocked, or ready?\n'
        + '2. List running agents: `prlt session list` — who is working on what? Any stale sessions?\n'
        + '3. Check open PRs: `gh pr list` — any PRs ready for review or merge?\n'
        + '4. Summarize what needs attention and recommend next actions.'
    fs.writeFileSync(promptPath, userMessage, { mode: 0o644 })
  } else {
    // Write full prompt (includes role context for non-Claude executors)
    fs.writeFileSync(promptPath, prompt, { mode: 0o644 })
  }

  // Tool registry (TKT-083): generate MCP config for Claude Code
  let mcpConfigPath: string | null = null
  if (context.hqPath && isClaudeExecutor(executor)) {
    const toolsResult = resolveToolsForSpawn(
      context.hqPath,
      context.toolPolicy,
      baseDir
    )
    mcpConfigPath = toolsResult.mcpConfigPath
  }

  // Build the executor command using getExecutorCommand() output
  // For Claude Code, we also support outputMode and additional flags
  // For Codex, we use the codex adapter for deterministic command building (TKT-080)
  // For other executors, we use the command as-is from getExecutorCommand()
  let executorInvocation: string
  if (isClaudeExecutor(executor)) {
    // Build flags based on config - Claude-specific flags
    // PRLT-948: --permission-mode bypassPermissions skips the "trust this folder" dialog.
    // Without it, Claude Code shows a workspace trust prompt in new worktrees and the
    // agent sits idle waiting for user input that never comes in automated tmux sessions.
    const bypassTrustFlag = skipPermissions ? '--permission-mode bypassPermissions ' : ''
    const permissionsFlag = skipPermissions ? '--dangerously-skip-permissions ' : ''
    // outputMode: 'print' adds -p flag (final result only), 'interactive' shows streaming UI
    const printFlag = config.outputMode === 'print' ? '-p ' : ''
    // --effort high: skips the effort level prompt for automated agents (TKT-1134)
    const effortFlag = skipPermissions ? '--effort high ' : ''
    // Orchestrator sessions inject their role via --system-prompt
    const systemPromptFlag = systemPromptPath ? '--system-prompt "$(cat "$SYSTEM_PROMPT_PATH")" ' : ''
    // TKT-053: Disable plan mode for background agents — prevents silent stalls
    // when there's no user to approve the plan mode transition
    const disallowPlanFlag = displayMode === 'background' ? '--disallowedTools EnterPlanMode ' : ''
    // Tool registry (TKT-083): pass MCP config to Claude Code via --mcp-config flag
    const mcpConfigFlag = mcpConfigPath ? `--mcp-config "${mcpConfigPath}" ` : ''
    // PRLT-950: Use -- to separate flags from positional prompt argument.
    // --disallowedTools is variadic and will consume the prompt as its second arg without --.
    executorInvocation = `${cmd} ${bypassTrustFlag}${permissionsFlag}${effortFlag}${printFlag}${disallowPlanFlag}${systemPromptFlag}${mcpConfigFlag}-- "$(cat "$PROMPT_PATH")"`
  } else if (executor === 'codex') {
    // TKT-080: Use Codex adapter for deterministic command building.
    // Uses PLACEHOLDER pattern for reliable prompt replacement (same as devcontainer runner).
    const codexPermission: PermissionMode = config.permissionMode
    const codexContext = resolveCodexExecutionContext(displayMode, config.outputMode)
    const codexResult = getCodexCommand('PLACEHOLDER', codexPermission, codexContext)
    const argsStr = codexResult.args.map(a => a === 'PLACEHOLDER' ? '"$(cat "$PROMPT_PATH")"' : a).join(' ')
    executorInvocation = `${codexResult.cmd} ${argsStr}`
  } else {
    // Non-Claude, non-Codex executors: build command from getExecutorCommand() args
    // Use PLACEHOLDER for reliable prompt replacement instead of fragile string comparison
    const { cmd: execCmd, args: execArgs } = getExecutorCommand(executor, 'PLACEHOLDER', skipPermissions)
    const argsWithFile = execArgs.map(a => a === 'PLACEHOLDER' ? '"$(cat "$PROMPT_PATH")"' : `"${a}"`)
    executorInvocation = `${execCmd} ${argsWithFile.join(' ')}`
  }

  // Build script that runs executor and keeps shell open after completion
  const setTitleCmds = getSetTitleCommands(windowTitle)
  // TKT-941: Export SYSTEM_PROMPT_PATH so it's available inside srt sandbox child processes.
  // Without export, `bash -c '...'` inside srt can't access the variable.
  const systemPromptVar = systemPromptPath ? `\nexport SYSTEM_PROMPT_PATH="${systemPromptPath}"` : ''

  // Ephemeral agents auto-close after completion instead of dropping to interactive shell
  const postExecBlock = context.isEphemeral
    ? `
echo ""
echo "✅ Ephemeral agent work complete. Session will auto-close in 5s..."
sleep 5
exit 0
`
    : `
echo ""
echo "✅ Agent work complete. Press Enter to close or run more commands."
exec $SHELL
`

  // Wrap with srt sandbox if running in sandbox environment
  let finalInvocation = executorInvocation
  if (context.executionEnvironment === 'sandbox') {
    // Build the srt wrapper command
    // The inner command is the executor invocation that reads from PROMPT_PATH
    const srtCmd = buildSrtCommand(`bash -c '${executorInvocation.replace(/'/g, "'\\''")}'`, context, config)
    finalInvocation = srtCmd
  }

  // TKT-099: Build a fallback invocation WITHOUT the prompt argument.
  // Used when prompt file is missing/empty — starts Claude in interactive mode
  // so the agent at least gets a working session instead of silently failing.
  let fallbackInvocation: string
  if (isClaudeExecutor(executor)) {
    const fbBypassTrust = skipPermissions ? '--permission-mode bypassPermissions ' : ''
    const fbPermissions = skipPermissions ? '--dangerously-skip-permissions ' : ''
    const fbEffort = skipPermissions ? '--effort high ' : ''
    const fbPrint = config.outputMode === 'print' ? '-p ' : ''
    const fbDisallowPlan = displayMode === 'background' ? '--disallowedTools EnterPlanMode ' : ''
    const fbSystemPrompt = systemPromptPath ? '--system-prompt "$(cat "$SYSTEM_PROMPT_PATH")" ' : ''
    const fbMcpConfig = mcpConfigPath ? `--mcp-config "${mcpConfigPath}" ` : ''
    fallbackInvocation = `${cmd} ${fbBypassTrust}${fbPermissions}${fbEffort}${fbPrint}${fbDisallowPlan}${fbSystemPrompt}${fbMcpConfig}`.trim()
  } else {
    fallbackInvocation = cmd
  }

  const scriptContent = `#!/bin/bash
# Auto-generated script for ticket ${context.ticketId}
# PRLT-1300: prevent agent processes from running npm install -g (race condition deletes binary)
export PRLT_AGENT=1
# PRLT-1301: provide isolated test DB path so agent tests never touch the real workspace.db
export PRLT_TEST_WORKSPACE_DB="/tmp/prlt-test-workspace-$$.db"
SCRIPT_PATH="${scriptPath}"
# TKT-941: Export PROMPT_PATH so it's available inside srt sandbox child processes.
# When running in sandbox mode, the executor is wrapped with:
#   srt ... -- bash -c 'claude ... "$(cat "$PROMPT_PATH")"'
# Without export, the inner bash started by srt cannot access PROMPT_PATH,
# causing $(cat "$PROMPT_PATH") to expand to empty and the agent to start idle.
export PROMPT_PATH="${promptPath}"${systemPromptVar}
${setTitleCmds}
echo "🚀 Starting: ${sessionName}"
${context.executionEnvironment === 'sandbox' ? 'echo "🔒 Running in srt sandbox (filesystem + network isolation)"' : ''}
echo ""
cd "${context.worktreePath}"

# TKT-099: Robust prompt loading — wait for file and verify content before passing to executor.
# Prevents race where the prompt file isn't flushed/synced yet (e.g., Docker file-sharing
# delay, tmux server restart, or transient filesystem latency).
PROMPT_WAIT=0
while [ ! -s "$PROMPT_PATH" ] && [ $PROMPT_WAIT -lt 30 ]; do
  sleep 0.5
  PROMPT_WAIT=$((PROMPT_WAIT + 1))
done

if [ ! -s "$PROMPT_PATH" ]; then
  echo "⚠️  Warning: Prompt file not available after 15s. Starting in interactive mode."
  echo "   Expected: $PROMPT_PATH"
  # Fallback: launch executor without prompt so the session isn't lost
  (unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT; ${fallbackInvocation})
else
  # Run executor in subshell with CLAUDECODE unset (prevents nested session error)
  (unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT; ${finalInvocation})
fi

# Clean up script and prompt files
rm -f "$SCRIPT_PATH" "$PROMPT_PATH"${systemPromptPath ? ' "$SYSTEM_PROMPT_PATH"' : ''}
${postExecBlock}`
  fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 })

  try {
    // Check if tmux is available
    execSync('which tmux', { stdio: 'pipe' })

    const terminalApp = config.terminal.app

    // Check if we should use iTerm control mode (-CC)
    // When using -CC, iTerm handles scrolling/selection natively, so we DON'T set mouse on
    // Without -CC, we need mouse on for tmux to handle scrolling
    const useControlMode = shouldUseControlMode(terminalApp, config.tmux.controlMode)

    // Step 1: Create host tmux session (detached)
    // Only enable mouse mode if NOT using control mode (control mode lets iTerm handle mouse natively)
    const mouseOption = buildTmuxMouseOption(useControlMode)
    const tmuxCmd = `tmux new-session -d -s "${sessionName}" -n "${sessionName}" "${scriptPath}"${mouseOption} \\; set-option -g set-titles on \\; set-option -g set-titles-string "#{window_name}"`

    try {
      execSync(tmuxCmd, { stdio: 'pipe' })
    } catch (error) {
      return {
        success: false,
        error: `Failed to create tmux session: ${error instanceof Error ? error.message : error}`,
      }
    }

    // Step 2: Open terminal tab attached to tmux session (unless background or foreground mode)
    if (displayMode === 'background') {
      return {
        success: true,
        sessionId: sessionName,
      }
    }

    // Foreground mode: attach to tmux session in current terminal (blocking)
    if (displayMode === 'foreground') {
      try {
        // Clear screen and attach - this blocks until user detaches or claude exits
        // Never use -CC in foreground mode: control mode sends raw tmux protocol
        // sequences (%begin, %output, %end) that render as garbled text unless
        // iTerm's native CC handler is active (only happens in new tabs opened via AppleScript)
        const fgTmuxAttach = buildTmuxAttachCommand(false)
        execSync(`clear && ${fgTmuxAttach} -t "${sessionName}"`, { stdio: 'inherit' })
        return {
          success: true,
          sessionId: sessionName,
        }
      } catch (error) {
        return {
          success: false,
          error: `Failed to attach to tmux session: ${error instanceof Error ? error.message : error}`,
        }
      }
    }

    // Use tmux -CC (control mode) for iTerm when enabled in config
    // -CC gives native iTerm scrolling, selection, and gesture support
    // Without -CC, use regular attach (relies on mouse mode for scrolling)
    const tmuxAttach = buildTmuxAttachCommand(useControlMode)
    const attachCmd = `clear && ${tmuxAttach} -t \\"${sessionName}\\"`

    // For iTerm with control mode, create a new tab and run -CC attach there
    // This avoids interfering with the terminal where prlt is running
    if (terminalApp === 'iTerm' && useControlMode) {
      // Configure iTerm to open tmux windows as tabs or windows based on user preference
      configureITermTmuxWindowMode(config.tmux.windowMode)

      const openInBackground = config.terminal.openInBackground ?? true

      if (openInBackground) {
        // Open tab without stealing focus - save frontmost app and restore after
        execSync(`osascript -e '
          set frontApp to path to frontmost application as text
          tell application "iTerm"
            tell current window
              set newTab to (create tab with default profile)
              tell current session of newTab
                write text "tmux -u -CC attach -d -t \\"${sessionName}\\""
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
                write text "tmux -u -CC attach -d -t \\"${sessionName}\\""
              end tell
            end tell
          end tell
        '`)
      }
      return {
        success: true,
        sessionId: sessionName,
      }
    }

    // Check if we should open in background (don't steal focus)
    const openInBackground = config.terminal.openInBackground ?? true

    switch (terminalApp) {
      case 'iTerm':
        // Without control mode, create a new tab and attach normally
        // When openInBackground is true, save frontmost app and restore after
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
                delay 0.3
                tell current session of current window
                  set name to "${windowTitle}"
                  write text "${attachCmd}"
                end tell
              else
                tell current window
                  set newTab to (create tab with default profile)
                  delay 0.3
                  tell current session of newTab
                    set name to "${windowTitle}"
                    write text "${attachCmd}"
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
                delay 0.3
                tell current session of current window
                  set name to "${windowTitle}"
                  write text "${attachCmd}"
                end tell
              else
                tell current window
                  set newTab to (create tab with default profile)
                  delay 0.3
                  tell current session of newTab
                    set name to "${windowTitle}"
                    write text "${attachCmd}"
                  end tell
                end tell
              end if
            end tell
          '`)
        }
        break

      case 'Ghostty':
        // Ghostty - use osascript to open new tab and run command
        execSync(`osascript -e '
          tell application "Ghostty"
            activate
          end tell
          tell application "System Events"
            tell process "Ghostty"
              keystroke "t" using command down
              delay 0.3
              keystroke "${attachCmd}"
              keystroke return
            end tell
          end tell
        '`)
        break

      case 'WezTerm':
        // WezTerm - use wezterm cli to spawn new tab
        execSync(`wezterm cli spawn --new-window -- bash -c '${attachCmd}'`)
        break

      case 'Kitty':
        // Kitty - use kitten to open new tab
        execSync(`kitty @ launch --type=tab -- bash -c '${attachCmd}'`)
        break

      case 'Alacritty':
        // Alacritty doesn't have native tab support, opens new window
        execSync(`osascript -e '
          tell application "Alacritty"
            activate
          end tell
          tell application "System Events"
            tell process "Alacritty"
              keystroke "n" using command down
              delay 0.3
              keystroke "${attachCmd}"
              keystroke return
            end tell
          end tell
        '`)
        break

      case 'Terminal':
      default:
        // macOS Terminal.app - new tab
        // Note: Terminal.app with System Events keystrokes requires activation for Cmd+T
        // But we can use 'do script' which opens a new window without activation if needed
        if (openInBackground) {
          // Open in background: use 'do script' which creates a new window without activating
          execSync(`osascript -e '
            tell application "Terminal"
              do script "${attachCmd}"
              set custom title of front window to "${windowTitle}"
            end tell
          '`)
        } else {
          // Bring to front: use traditional Cmd+T for new tab
          execSync(`osascript -e '
            tell application "Terminal"
              activate
              tell application "System Events"
                tell process "Terminal"
                  keystroke "t" using command down
                end tell
              end tell
              delay 0.3
              do script "${attachCmd}" in front window
            end tell
          '`)
        }
        break
    }

    return {
      success: true,
      sessionId: sessionName,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : `Failed to start host tmux session`,
    }
  }
}
