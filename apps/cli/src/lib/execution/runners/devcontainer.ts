/**
 * Devcontainer Runner (uses raw Docker)
 *
 * Runs commands inside Docker containers with filesystem isolation.
 * Supports terminal, background, foreground, and tmux display modes.
 */

import {
  spawn,
  execSync,
  fs,
  path,
  os,
  DisplayMode,
  OutputMode,
  PermissionMode,
  SessionManager,
  ExecutorType,
  ExecutionContext,
  ExecutionConfig,
  getSetTitleCommands,
  resolveCodexExecutionContext,
  validateCodexMode,
  getCodexCommand,
  resolveToolsForSpawn,
} from './shared.js'

import {
  RunnerResult,
  buildSessionName,
  buildWindowTitle,
  buildTmuxWindowName,
  buildPrompt,
  getExecutorCommand,
  isClaudeExecutor,
  shouldUseControlMode,
  buildTmuxMouseOption,
  buildTmuxAttachCommand,
  configureITermTmuxWindowMode,
  checkDockerDaemon,
  ensureDockerContainer,
  copyClaudeCredentials,
} from './shared.js'

// =============================================================================
// Prompt File Management
// =============================================================================

/**
 * Clean up old prompt files from the worktree.
 * This is called before writing a new prompt file to prevent accumulation
 * of stale prompt files from failed or interrupted executions.
 */
function cleanupOldPromptFiles(worktreePath: string, ticketId?: string): void {
  try {
    const files = fs.readdirSync(worktreePath)
    const pattern = ticketId
      ? new RegExp(`^\\.prlt-prompt-${ticketId}-\\d+\\.txt$`)
      : /^\.prlt-prompt-.*\.txt$/

    for (const file of files) {
      if (pattern.test(file)) {
        try {
          fs.unlinkSync(path.join(worktreePath, file))
        } catch (err) {
          console.debug(`[runners:cleanup] Failed to delete ${file}:`, err)
        }
      }
    }
  } catch (err) {
    console.debug(`[runners:cleanup] Failed to read directory ${worktreePath}:`, err)
  }
}

/**
 * Write prompt to a file inside the worktree so the container can access it.
 * Returns the path to the prompt file (relative to worktree for container access).
 * Cleans up old prompt files for the same ticket before writing.
 */
function writePromptFile(context: ExecutionContext): { hostPath: string; containerPath: string } {
  // Clean up old prompt files for this ticket before creating a new one
  cleanupOldPromptFiles(context.worktreePath, context.ticketId)

  const prompt = buildPrompt(context)
  const filename = `.prlt-prompt-${context.ticketId}-${Date.now()}.txt`
  const hostPath = path.join(context.worktreePath, filename)

  fs.writeFileSync(hostPath, prompt, { mode: 0o644 })

  // Container mounts agentDir at /workspace
  // If worktreePath is a subdirectory of agentDir, we need the relative path
  // e.g., agentDir=/agents/altman, worktreePath=/agents/altman/textdeck
  //       -> containerPath=/workspace/textdeck/.prlt-prompt-....txt
  const relativePath = path.relative(context.agentDir, context.worktreePath)
  const containerPath = relativePath
    ? `/workspace/${relativePath}/${filename}`
    : `/workspace/${filename}`

  return { hostPath, containerPath }
}

// =============================================================================
// Devcontainer Command Builder
// =============================================================================

/**
 * Build the command to run Claude inside the container.
 * Uses docker exec for direct container access.
 * Uses a prompt file to avoid shell escaping issues.
 */
export function buildDevcontainerCommand(
  context: ExecutionContext,
  executor: ExecutorType,
  promptFile: string,
  containerId?: string,
  outputMode: OutputMode = 'interactive',
  permissionMode: PermissionMode = 'safe',
  displayMode: DisplayMode = 'terminal',
  mcpConfigFile?: string
): string {
  // Calculate the relative path from agentDir to worktreePath for cd
  const relativePath = path.relative(context.agentDir, context.worktreePath)
  const cdCmd = relativePath ? `cd /workspace/${relativePath} && ` : ''

  // Build executor command using the centralized getExecutorCommand()
  // This ensures all runners use consistent executor invocation
  let executorCmd: string
  const skipPermissions = permissionMode === 'danger'
  if (isClaudeExecutor(executor)) {
    // Claude-specific flags based on output mode and permission mode
    // - interactive: No -p flag, shows streaming UI (watch Claude work in real-time)
    // - print: Uses -p flag, outputs final result only (better for logs/automation)
    const printFlag = outputMode === 'print' ? '-p ' : ''
    // --permission-mode bypassPermissions: skips the "trust this folder" dialog
    const bypassTrustFlag = '--permission-mode bypassPermissions '
    const permissionsFlag = skipPermissions ? '--dangerously-skip-permissions ' : ''
    // --effort high: skips the effort level prompt for automated agents (TKT-1134)
    const effortFlag = '--effort high '
    // TKT-053: Disable plan mode for background agents — prevents silent stalls
    const disallowPlanFlag = displayMode === 'background' ? '--disallowedTools EnterPlanMode ' : ''
    // Tool registry (TKT-083): pass MCP config to Claude Code via --mcp-config flag
    const mcpConfigFlag = mcpConfigFile ? `--mcp-config ${mcpConfigFile} ` : ''
    // PRLT-950: Use -- to separate flags from positional prompt argument.
    // --disallowedTools is variadic and will consume the prompt as its second arg without --.
    executorCmd = `claude ${bypassTrustFlag}${permissionsFlag}${effortFlag}${printFlag}${disallowPlanFlag}${mcpConfigFlag}-- "$(cat ${promptFile})"`
  } else if (executor === 'codex') {
    // Use Codex adapter for mode validation and deterministic command building.
    // Validates that the permission/display combination is supported before building.
    const codexPermission: PermissionMode = permissionMode
    const codexContext = resolveCodexExecutionContext(displayMode, outputMode)
    const modeError = validateCodexMode(codexPermission, codexContext)
    if (modeError) {
      throw modeError
    }
    const codexResult = getCodexCommand('PLACEHOLDER', codexPermission, codexContext)
    const argsStr = codexResult.args.map(a => a === 'PLACEHOLDER' ? `"$(cat ${promptFile})"` : a).join(' ')
    executorCmd = `${codexResult.cmd} ${argsStr}`
  } else {
    // Non-Claude, non-Codex executors: use getExecutorCommand() to get correct command and args
    const { cmd, args } = getExecutorCommand(executor, `PLACEHOLDER`, skipPermissions)
    // Replace the placeholder prompt with a file read for shell safety
    const argsStr = args.map(a => a === 'PLACEHOLDER' ? `"$(cat ${promptFile})"` : a).join(' ')
    executorCmd = `${cmd} ${argsStr}`
  }

  // Build the full command with cd, executor invocation, and cleanup
  const fullCmd = `${cdCmd}${executorCmd} && rm -f ${promptFile}`

  // Use docker exec for running commands in the container
  // Use -it flags only for terminal/foreground modes where a TTY is available
  // Background mode runs without a TTY, so -it flags would cause "not a TTY" error
  const ttyFlags = displayMode === 'background' ? '' : '-it '

  // Direct mode - run executor directly (tmux setup is handled by runDevcontainerInTmux)
  return `docker exec ${ttyFlags}${containerId} bash -c '${fullCmd}'`
}

// =============================================================================
// Devcontainer Runner
// =============================================================================

/**
 * Run command inside a Docker container.
 * Uses raw Docker commands for filesystem isolation - no devcontainer CLI required.
 * Agent can only access mounted worktrees and configured paths.
 *
 * @param displayMode - How to display output (terminal, foreground, background, tmux)
 * @param sessionManager - How to manage the session inside the container (tmux, direct)
 */
export async function runDevcontainer(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig,
  displayMode: DisplayMode = 'terminal',
  sessionManager: SessionManager = 'tmux'  // Default to tmux for session persistence
): Promise<RunnerResult> {
  // Docker config is in the agent directory (still uses .devcontainer for Dockerfile)
  const devcontainerPath = path.join(context.agentDir, '.devcontainer')
  const dockerfile = path.join(devcontainerPath, 'Dockerfile')

  // Check if Dockerfile exists
  if (!fs.existsSync(dockerfile)) {
    return {
      success: false,
      error: `No Dockerfile found at ${devcontainerPath}. Run 'prlt agent add' to set up the agent with Docker config.`,
    }
  }

  try {
    // Check if Docker is running (TKT-081: fast detection with diagnostic info)
    const dockerStatus = checkDockerDaemon()
    if (!dockerStatus.available) {
      return {
        success: false,
        error: `Docker daemon is not available. ${dockerStatus.message}`,
      }
    }

    // Ensure GitHub token is available for git push operations
    // Try to get token from gh CLI if not already in environment
    if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
      try {
        const token = execSync('gh auth token', { encoding: 'utf-8', stdio: 'pipe' }).trim()
        if (token) {
          process.env.GITHUB_TOKEN = token
          process.env.GH_TOKEN = token
        }
      } catch (err) {
        console.debug('[runners:docker] gh auth token failed:', err)
      }
    }

    // Copy Claude credentials into agent directory so container can access them
    // Only needed for Claude Code executor
    if (isClaudeExecutor(executor)) {
      // This was the original working approach - credentials at /workspace/.claude.json
      copyClaudeCredentials(context.agentDir)
    }

    // Start or reuse container using raw Docker commands
    // No devcontainer CLI required!
    const containerId = ensureDockerContainer(context, config, executor)
    if (!containerId) {
      return {
        success: false,
        error: 'Failed to start Docker container. Check Docker logs for details.',
      }
    }

    // Write prompt to file in worktree (accessible by container)
    const { hostPath: promptHostPath, containerPath: promptFile } = writePromptFile(context)

    // Tool registry (TKT-083): generate MCP config file for container
    let mcpConfigContainerPath: string | undefined
    if (context.hqPath && isClaudeExecutor(executor)) {
      const toolsResult = resolveToolsForSpawn(
        context.hqPath,
        context.toolPolicy,
        context.worktreePath
      )
      if (toolsResult.mcpConfigPath) {
        // Map host path to container path
        const relativeMcp = path.relative(context.agentDir, toolsResult.mcpConfigPath)
        mcpConfigContainerPath = `/workspace/${relativeMcp}`
      }
    }

    // Inject fresh GitHub token into container (containers may be reused with stale/empty tokens)
    // This ensures git push works even if the container was created before token was available
    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
    if (containerId && githubToken) {
      try {
        // Write token to file and configure git credential helper
        execSync(`docker exec ${containerId} bash -c 'echo "${githubToken}" > /home/node/.github-token && chmod 600 /home/node/.github-token && git config --global credential.helper "!f() { echo \\"username=x-access-token\\"; echo \\"password=\\$(cat /home/node/.github-token)\\"; }; f" && git config --global url."https://github.com/".insteadOf "git@github.com:"'`, {
          stdio: 'pipe',
        })
      } catch {
        // Non-fatal - token injection failed but execution can continue
      }
    }

    // Build the docker exec command (just runs claude directly)
    // tmux session setup is handled by runDevcontainerInTmux, not buildDevcontainerCommand
    const devcontainerCmd = buildDevcontainerCommand(context, executor, promptFile, containerId, config.outputMode, config.permissionMode, displayMode, mcpConfigContainerPath)

    // Execute based on display mode
    // When sessionManager is 'tmux', always use tmux inside container for session persistence
    // (allows reattach via `prlt session attach` even for background mode)
    let result: RunnerResult
    if (sessionManager === 'tmux') {
      // Use tmux inside container - pass displayMode to control whether to open terminal tab
      // Pass containerId directly to avoid regex extraction issues with devcontainer exec commands
      result = await runDevcontainerInTmux(context, devcontainerCmd, config, displayMode, containerId || undefined, promptFile)
    } else {
      switch (displayMode) {
        case 'background':
          result = await runDevcontainerInBackground(context, devcontainerCmd)
          break
        case 'terminal':
        default:
          result = await runDevcontainerInTerminal(context, devcontainerCmd, config)
          break
      }
    }

    // Clean up prompt file if execution failed to start
    // (successful executions clean up the file themselves via the command)
    if (!result.success && fs.existsSync(promptHostPath)) {
      try {
        fs.unlinkSync(promptHostPath)
      } catch (err) {
        console.debug('[runners:devcontainer] Failed to cleanup prompt file:', err)
      }
    }

    // Override containerId with the real Docker container ID (not the placeholder)
    if (result.success && containerId) {
      result.containerId = containerId
    }

    // Set sessionId when using tmux inside the container
    // Use buildSessionName to match the actual tmux session name format: {ticketId}-{action}-{agentName}
    if (result.success && sessionManager === 'tmux') {
      const sessionId = buildSessionName(context)
      result.sessionId = sessionId

      // For terminal display mode, verify the tmux session was actually created
      // (terminal spawns asynchronously, so we need to wait and check)
      if (displayMode === 'terminal' && containerId) {
        // Wait for the terminal to execute the script
        await new Promise(resolve => setTimeout(resolve, 3000))

        // Check if tmux session exists inside the container
        try {
          execSync(
            `docker exec ${containerId} tmux has-session -t "${sessionId}" 2>&1`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
          )
          // Session exists - success
        } catch (err) {
          console.debug(`[runners:devcontainer] tmux session ${sessionId} not found in container:`, err)
          result.success = false
          result.error = `Failed to create tmux session "${sessionId}" inside container. Check terminal for errors.`
        }
      }
    }

    return result
  } catch (error) {
    // Clean up any orphaned prompt files on error
    cleanupOldPromptFiles(context.worktreePath, context.ticketId)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run in devcontainer',
    }
  }
}

// =============================================================================
// Display Mode Handlers
// =============================================================================

/**
 * Run devcontainer command in a new terminal window.
 * Uses a temp script file to avoid shell escaping issues with complex prompts.
 */
async function runDevcontainerInTerminal(
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
  // Use HQ .proletariat/scripts if available, otherwise fallback to home dir
  const baseDir = context.hqPath
    ? path.join(context.hqPath, '.proletariat', 'scripts')
    : path.join(os.homedir(), '.proletariat', 'scripts')
  fs.mkdirSync(baseDir, { recursive: true })
  const scriptPath = path.join(baseDir, `exec-${context.ticketId}-${Date.now()}.sh`)

  // Build window title for terminal tab
  const windowTitle = buildWindowTitle(context)
  const setTitleCmds = getSetTitleCommands(windowTitle)

  // Write script - run the command directly
  // No auth check needed - if auth is required, Claude will show "Invalid API key"
  // and user can run /login from there

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

  // Check if we should open in background (don't steal focus)
  const openInBackground = config.terminal.openInBackground ?? true

  try {
    switch (terminalApp) {
      case 'iTerm':
        // Run script file directly - iTerm will execute it with proper TTY
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
        // Use source to preserve TTY for docker exec
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
        // Use bash -c source to preserve TTY
        execSync(`wezterm cli spawn --new-window -- bash -c 'source ${scriptPath}'`)
        break

      case 'Kitty':
        // Use bash -c source to preserve TTY
        execSync(`kitty @ launch --type=tab -- bash -c 'source ${scriptPath}'`)
        break

      case 'Alacritty':
        // Use source to preserve TTY for docker exec
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
        // Use source to preserve TTY for docker exec
        if (openInBackground) {
          // Open in background: use 'do script' which creates a new window without activating
          execSync(`osascript -e '
            tell application "Terminal"
              do script "source ${scriptPath}"
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

/**
 * Run devcontainer command in background, logging to file
 */
async function runDevcontainerInBackground(
  context: ExecutionContext,
  devcontainerCmd: string
): Promise<RunnerResult> {
  // Create logs directory
  const logsDir = path.join(os.homedir(), '.proletariat', 'logs')
  fs.mkdirSync(logsDir, { recursive: true })

  const logPath = path.join(logsDir, `work-${context.ticketId}-${Date.now()}.log`)
  const logStream = fs.openSync(logPath, 'w')

  const child = spawn('sh', ['-c', devcontainerCmd], {
    detached: true,
    stdio: ['ignore', logStream, logStream],
  })

  child.unref()

  return {
    success: true,
    pid: child.pid?.toString(),
    containerId: `devcontainer-${context.agentName}`,
    logPath,
  }
}

/**
 * Run devcontainer command in tmux session INSIDE the container.
 *
 * Architecture: Container tmux only (simple, no nesting)
 * 1. Start tmux session INSIDE the container (detached) - runs claude
 * 2. Open iTerm tab that attaches directly to the container's tmux
 *
 * Benefits:
 * - Session persists even if you close iTerm tab
 * - No nested tmux = proper scrolling
 * - Can reattach anytime via `prlt session attach`
 * - Sessions tracked in workspace.db
 */
async function runDevcontainerInTmux(
  context: ExecutionContext,
  devcontainerCmd: string,
  config: ExecutionConfig,
  displayMode: DisplayMode = 'terminal',
  containerId?: string,
  promptContainerPath?: string
): Promise<RunnerResult> {
  // Session name: {ticketId}-{action} (e.g., TKT-347-implement)
  const sessionName = buildTmuxWindowName(context)
  const windowTitle = buildWindowTitle(context)

  // Check if we should use iTerm control mode (-CC)
  // When using -CC, iTerm handles scrolling/selection natively, so we DON'T set mouse on
  const terminalApp = config.terminal.app
  const useControlMode = shouldUseControlMode(terminalApp, config.tmux.controlMode)

  try {
    // Get container ID - prefer passed value, fallback to extracting from command
    // The devcontainerCmd is like: docker exec [-it] <containerId> bash -c '...'
    // Note: -it flags are optional (not present in background mode)
    let actualContainerId = containerId
    if (!actualContainerId) {
      const containerIdMatch = devcontainerCmd.match(/docker exec\s+(?:-it\s+)?(\S+)/)
      if (containerIdMatch) {
        actualContainerId = containerIdMatch[1]
      }
    }
    if (!actualContainerId) {
      return {
        success: false,
        error: 'Could not determine container ID for tmux session',
      }
    }

    // Check if tmux is available inside the container
    try {
      execSync(`docker exec ${actualContainerId} which tmux`, { stdio: 'pipe' })
    } catch {
      return {
        success: false,
        error: `tmux is not installed in the devcontainer. ` +
          `Add 'tmux' to your devcontainer's Dockerfile (e.g., apt-get install -y tmux) ` +
          `or use the default prlt devcontainer template which includes tmux.`,
      }
    }

    // Step 1: Start tmux session INSIDE the container (detached)
    // Extract the claude command from the devcontainer command
    const cmdMatch = devcontainerCmd.match(/bash -c '(.+)'$/)
    const claudeCmd = cmdMatch ? cmdMatch[1] : devcontainerCmd

    // Create a script inside the container that runs claude and keeps shell open
    // TERM must be set for Claude's TUI to render properly
    // Unset CI to prevent Claude from detecting CI environment which suppresses TUI output
    // Unset CLAUDECODE to allow Claude Code to run (prevents nested session error)
    // Note: We keep DEVCONTAINER set so prlt workspace detection works correctly
    // Ephemeral agents auto-close after completion
    const containerPostExec = context.isEphemeral
      ? `echo ""
echo "✅ Ephemeral agent work complete. Session will auto-close in 5s..."
sleep 5
exit 0`
      : `echo ""
echo "✅ Agent work complete. Press Enter to close or run more commands."
exec bash`

    // TKT-099: Build a wait guard for the prompt file inside the container.
    // Docker Desktop's file-sharing layer (grpcfuse/virtiofs) can lag behind host writes,
    // so the prompt file may not be visible in the container the instant it was written on the host.
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

    // Write script and start tmux session inside container
    // -n sets the window name (shows in iTerm tab title with -CC mode)
    // sessionName is already ticket-action-agent format
    // Only enable mouse mode if NOT using control mode (control mode lets iTerm handle mouse natively)
    // set-titles on + set-titles-string: makes tmux set terminal title to window name
    const mouseOption = buildTmuxMouseOption(useControlMode)

    // Step 1: Write the script to the container via stdin piping to avoid ARG_MAX limits
    try {
      execSync(`docker exec -i ${actualContainerId} bash -c 'cat > ${scriptPath} && chmod +x ${scriptPath}'`, {
        input: tmuxScript,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      return {
        success: false,
        error: `Failed to write script to container: ${error instanceof Error ? error.message : error}`,
      }
    }

    // TKT-1028: If a tmux session with the same name already exists (e.g., same
    // ticket+action spawned again in a reused container), kill the old session first.
    try {
      execSync(`docker exec ${actualContainerId} tmux has-session -t "${sessionName}" 2>&1`, { stdio: 'pipe' })
      // Session exists - kill it before creating a new one
      console.debug(`[runners:tmux] Killing existing tmux session "${sessionName}" in container`)
      try {
        execSync(`docker exec ${actualContainerId} tmux kill-session -t "${sessionName}"`, { stdio: 'pipe' })
      } catch {
        // Ignore kill errors
      }
    } catch {
      // Session doesn't exist - that's the normal case
    }

    // Step 2: Create tmux session running the script directly
    // Pass the script as the session command (like host runner does) instead of using send-keys.
    // The send-keys approach had a race condition where keys could be lost if bash hadn't
    // fully initialized, causing background mode to create empty sessions without running claude.
    const createSessionCmd = `tmux new-session -d -s "${sessionName}" -n "${sessionName}" "bash ${scriptPath}"${mouseOption} \\; set-option -g set-titles on \\; set-option -g set-titles-string "#{window_name}"`
    try {
      execSync(`docker exec ${actualContainerId} bash -c '${createSessionCmd}'`, { stdio: 'pipe' })
    } catch (error) {
      return {
        success: false,
        error: `Failed to create tmux session inside container: ${error instanceof Error ? error.message : error}`,
      }
    }

    // Step 3: Handle display mode
    // For background mode, return success after tmux session is created
    // User can reattach later with `prlt session attach`
    if (displayMode === 'background') {
      // Verify the tmux session was actually created (brief delay to let tmux start)
      await new Promise(resolve => setTimeout(resolve, 500))
      try {
        execSync(
          `docker exec ${actualContainerId} tmux has-session -t "${sessionName}" 2>&1`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        )
      } catch {
        return {
          success: false,
          error: `Failed to verify tmux session "${sessionName}" inside container. The session may not have started correctly.`,
        }
      }
      return {
        success: true,
        containerId: actualContainerId,
        sessionId: sessionName, // Container tmux session name for tracking
      }
    }

    // For foreground mode: attach to container's tmux session in current terminal (blocking)
    if (displayMode === 'foreground') {
      try {
        // Clear screen and attach - this blocks until user detaches or claude exits
        // Never use -CC in foreground mode: control mode sends raw tmux protocol
        // sequences (%begin, %output, %end) that render as garbled text unless
        // iTerm's native CC handler is active (only happens in new tabs opened via AppleScript)
        const fgTmuxAttach = buildTmuxAttachCommand(false, true)
        execSync(`clear && docker exec -it ${actualContainerId} ${fgTmuxAttach} -t "${sessionName}"`, { stdio: 'inherit' })
        return {
          success: true,
          containerId: actualContainerId,
          sessionId: sessionName,
        }
      } catch (error) {
        return {
          success: false,
          error: `Failed to attach to container tmux session: ${error instanceof Error ? error.message : error}`,
        }
      }
    }

    // Use tmux -CC (control mode) for iTerm when enabled in config
    // -CC gives native iTerm scrolling, selection, and gesture support
    // Without -CC, use regular attach (relies on mouse mode for scrolling)
    const tmuxAttach = buildTmuxAttachCommand(useControlMode, true)
    const attachCmd = `docker exec -it ${actualContainerId} ${tmuxAttach} -t "${sessionName}"`

    // Open terminal and run the attach command
    const terminalApp2 = config.terminal.app

    // For iTerm with control mode, create a new tab and run -CC attach there
    // This avoids interfering with the terminal where prlt is running
    if (terminalApp2 === 'iTerm' && useControlMode) {
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
      return {
        success: true,
        containerId: actualContainerId,
        sessionId: sessionName,
      }
    }

    // For all other cases, create a script file and open in a new tab
    const baseDir = context.hqPath
      ? path.join(context.hqPath, '.proletariat', 'scripts')
      : path.join(os.homedir(), '.proletariat', 'scripts')
    fs.mkdirSync(baseDir, { recursive: true })
    const hostScriptPath = path.join(baseDir, `attach-${sessionName}-${Date.now()}.sh`)

    const setTitleCmds = getSetTitleCommands(windowTitle)

    const hostScript = `#!/bin/bash
${setTitleCmds}
# Attach to container tmux session
# Session: ${sessionName}
# Container: ${actualContainerId}
${attachCmd}

# Clean up
rm -f "${hostScriptPath}"
exec $SHELL
`
    fs.writeFileSync(hostScriptPath, hostScript, { mode: 0o755 })

    // Check if we should open in background (don't steal focus)
    const openInBackground = config.terminal.openInBackground ?? true

    switch (terminalApp2) {
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
          tell application "Ghostty"
            activate
          end tell
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
          // Open in background: use 'do script' which creates a new window without activating
          execSync(`osascript -e '
            tell application "Terminal"
              do script "${hostScriptPath}"
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
              do script "${hostScriptPath}" in front window
            end tell
          '`)
        }
        break
    }

    return {
      success: true,
      containerId: actualContainerId,
      sessionId: sessionName, // Container tmux session name for tracking
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start tmux session in container',
    }
  }
}
