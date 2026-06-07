/**
 * Devcontainer Runner (uses raw Docker)
 *
 * Runs commands inside Docker containers with filesystem isolation.
 * Delegates display mode handling to devcontainer-terminal.ts and devcontainer-tmux.ts.
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
  resolveCodexExecutionContext,
  validateCodexMode,
  getCodexCommand,
  resolveToolsForSpawn,
} from './shared.js'

import {
  RunnerResult,
  buildSessionName,
  buildPrompt,
  getExecutorCommand,
  isClaudeExecutor,
  checkDockerDaemon,
  ensureDockerContainerDetailed,
  copyClaudeCredentials,
  refreshCredentialVolume,
  ensureWorkflowScope,
} from './shared.js'

import { runDevcontainerInTmux } from './devcontainer-tmux.js'
import { runDevcontainerInTerminal } from './devcontainer-terminal.js'
import { writeWorkspaceManifest } from '../context.js'
import type { WorkspaceManifest } from '../types.js'
import { buildDockerEnvFlags } from '../executor-overrides.js'

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
 * Write prompt to a file that's accessible inside the Docker container.
 * Always writes to a path under agentDir (mounted at /workspace) so the
 * container can read it — even when worktreePath is outside agentDir.
 * Cleans up old prompt files for the same ticket before writing.
 */
function writePromptFile(context: ExecutionContext): { hostPath: string; containerPath: string } {
  const prompt = buildPrompt(context)
  const filename = `.prlt-prompt-${context.ticketId}-${Date.now()}.txt`

  // Container mounts agentDir at /workspace.
  // Determine if worktreePath is inside agentDir — if so, write the prompt
  // file there alongside the code. If worktreePath is OUTSIDE agentDir
  // (e.g., when resolveWorktreePath falls back to cwd), write to agentDir
  // itself so the file is always under the /workspace mount.
  const relativePath = path.relative(context.agentDir, context.worktreePath)
  const isInsideAgentDir = relativePath && !relativePath.startsWith('..')

  let hostWriteDir: string
  let containerPath: string

  if (isInsideAgentDir) {
    hostWriteDir = context.worktreePath
    containerPath = `/workspace/${relativePath}/${filename}`
  } else {
    // worktreePath is outside agentDir — write to agentDir root
    hostWriteDir = context.agentDir
    containerPath = `/workspace/${filename}`
  }

  // Clean up old prompt files before creating a new one
  cleanupOldPromptFiles(hostWriteDir, context.ticketId)

  const hostPath = path.join(hostWriteDir, filename)
  fs.writeFileSync(hostPath, prompt, { mode: 0o644 })

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
  // Calculate the relative path from agentDir to worktreePath for cd.
  // Only use the relative path if worktreePath is inside agentDir — if it
  // traverses upward (starts with ..), the path won't exist inside Docker.
  const relativePath = path.relative(context.agentDir, context.worktreePath)
  const isInsideAgentDir = relativePath && !relativePath.startsWith('..')
  const cdCmd = isInsideAgentDir ? `cd /workspace/${relativePath} && ` : ''

  // Build executor command using the centralized getExecutorCommand()
  let executorCmd: string
  const skipPermissions = permissionMode === 'danger'
  if (isClaudeExecutor(executor)) {
    // PRLT-1240: Always use -p (print) mode for container agents.
    // This skips all onboarding prompts (theme picker, permissions, workspace trust)
    // and ensures the agent exits cleanly when done. Works with any Claude Code version.
    const printFlag = '-p '
    const bypassTrustFlag = '--permission-mode bypassPermissions '
    const permissionsFlag = skipPermissions ? '--dangerously-skip-permissions ' : ''
    const effortFlag = '--effort high '
    // TKT-053: Disable plan mode for background agents — prevents silent stalls
    const disallowPlanFlag = displayMode === 'background' ? '--disallowedTools EnterPlanMode ' : ''
    // Tool registry (TKT-083): pass MCP config to Claude Code via --mcp-config flag
    const mcpConfigFlag = mcpConfigFile ? `--mcp-config ${mcpConfigFile} ` : ''
    // PRLT-1369: --executor-bin overrides the claude binary inside the container
    const claudeCmd = context.executorBin || 'claude'
    // PRLT-950: Use -- to separate flags from positional prompt argument.
    executorCmd = `${claudeCmd} ${bypassTrustFlag}${permissionsFlag}${effortFlag}${printFlag}${disallowPlanFlag}${mcpConfigFlag}-- "$(cat ${promptFile})"`
  } else if (executor === 'codex') {
    const codexPermission: PermissionMode = permissionMode
    const codexContext = resolveCodexExecutionContext(displayMode, outputMode)
    const modeError = validateCodexMode(codexPermission, codexContext)
    if (modeError) {
      throw modeError
    }
    const codexResult = getCodexCommand('PLACEHOLDER', codexPermission, codexContext)
    const argsStr = codexResult.args.map(a => a === 'PLACEHOLDER' ? `"$(cat ${promptFile})"` : a).join(' ')
    // PRLT-1369: honor --executor-bin for codex if provided
    const codexCmd = context.executorBin || codexResult.cmd
    executorCmd = `${codexCmd} ${argsStr}`
  } else {
    const { cmd, args } = getExecutorCommand(executor, `PLACEHOLDER`, skipPermissions, context.executorBin)
    const argsStr = args.map(a => a === 'PLACEHOLDER' ? `"$(cat ${promptFile})"` : a).join(' ')
    executorCmd = `${cmd} ${argsStr}`
  }

  const fullCmd = `${cdCmd}${executorCmd} && rm -f ${promptFile}`
  const ttyFlags = displayMode === 'background' ? '' : '-it '
  // PRLT-1369: Inject executor env vars into the docker exec invocation.
  // Used for switching Claude accounts inside the container, e.g.
  //   --executor-env CLAUDE_CONFIG_DIR=/home/node/.claude-work
  const envFlags = buildDockerEnvFlags(context.executorEnv)

  return `docker exec ${ttyFlags}${envFlags ? envFlags.trimStart() + ' ' : ''}${containerId} bash -c '${fullCmd}'`
}

// =============================================================================
// Devcontainer Runner
// =============================================================================

/**
 * Run command inside a Docker container.
 * Uses raw Docker commands for filesystem isolation - no devcontainer CLI required.
 */
export async function runDevcontainer(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig,
  displayMode: DisplayMode = 'terminal',
  sessionManager: SessionManager = 'tmux'
): Promise<RunnerResult> {
  const devcontainerPath = path.join(context.agentDir, '.devcontainer')
  const dockerfile = path.join(devcontainerPath, 'Dockerfile')

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

    // PRLT-1095: Ensure token has workflow scope for pushing .github/workflows/ changes.
    // Without this scope, agents cannot update CI files even when the ticket requires it.
    if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
      const hasScope = ensureWorkflowScope()
      if (!hasScope) {
        console.debug('[runners:docker] WARNING: GitHub token lacks workflow scope. Agents will not be able to push changes to .github/workflows/ files. Run: gh auth refresh -h github.com -s workflow')
      }
    }

    // Copy Claude credentials into agent directory so container can access them
    if (isClaudeExecutor(executor)) {
      copyClaudeCredentials(context.agentDir)

      // PRLT-1296: Refresh credential volume with fresh host credentials before each spawn.
      // OAuth tokens expire every ~24h; the volume is a snapshot that goes stale.
      // This ensures containers always get the host's current (auto-refreshed) tokens.
      refreshCredentialVolume()
    }

    // PRLT-1322: Use the detailed variant so we can surface which pipeline
    // stage failed (image build, container create, workspace verify, etc.)
    // instead of a generic "Failed to start Docker container".
    const ensureResult = ensureDockerContainerDetailed(context, config, executor)
    const containerId = ensureResult.containerId
    if (!containerId) {
      const stageError = ensureResult.error
      const detail = stageError
        ? `Stage "${stageError.stage}" failed: ${stageError.message}` +
          (stageError.stderr ? `\n  stderr: ${stageError.stderr.trim()}` : '')
        : 'No error details reported by Docker management layer.'
      return {
        success: false,
        error: `Docker spawn pipeline failed. ${detail}\nRun with DEBUG=* for full Docker logs, or use --run-on-host to bypass the container.`,
      }
    }

    // Write workspace manifest (PRLT-1088) so agent knows which repos are available
    if (context.workspaceRepos && context.workspaceRepos.length > 0) {
      const manifest: WorkspaceManifest = {
        repos: context.workspaceRepos,
        ticket: context.ticketId,
        agent: context.agentName,
        action: context.actionName,
      }
      writeWorkspaceManifest(context.agentDir, manifest)
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
        const relativeMcp = path.relative(context.agentDir, toolsResult.mcpConfigPath)
        mcpConfigContainerPath = `/workspace/${relativeMcp}`
      }
    }

    // Inject fresh GitHub token into container (containers may be reused with stale/empty tokens)
    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
    if (containerId && githubToken) {
      try {
        execSync(`docker exec ${containerId} bash -c 'echo "${githubToken}" > /home/node/.github-token && chmod 600 /home/node/.github-token && git config --global credential.helper "!f() { echo \\"username=x-access-token\\"; echo \\"password=\\$(cat /home/node/.github-token)\\"; }; f" && git config --global url."https://github.com/".insteadOf "git@github.com:"'`, {
          stdio: 'pipe',
        })
      } catch {
        // Non-fatal - token injection failed but execution can continue
      }
    }

    // Build the docker exec command
    const devcontainerCmd = buildDevcontainerCommand(context, executor, promptFile, containerId, config.outputMode, config.permissionMode, displayMode, mcpConfigContainerPath)

    // Execute based on display mode
    let result: RunnerResult
    if (sessionManager === 'tmux') {
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
    if (!result.success && fs.existsSync(promptHostPath)) {
      try {
        fs.unlinkSync(promptHostPath)
      } catch (err) {
        console.debug('[runners:devcontainer] Failed to cleanup prompt file:', err)
      }
    }

    // Override containerId with the real Docker container ID
    if (result.success && containerId) {
      result.containerId = containerId
    }

    // Set sessionId when using tmux inside the container
    if (result.success && sessionManager === 'tmux') {
      const sessionId = buildSessionName(context)
      result.sessionId = sessionId

      // For terminal display mode, verify the tmux session was actually created
      if (displayMode === 'terminal' && containerId) {
        await new Promise(resolve => setTimeout(resolve, 3000))
        try {
          execSync(
            `docker exec ${containerId} tmux has-session -t "${sessionId}" 2>&1`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
          )
        } catch (err) {
          console.debug(`[runners:devcontainer] tmux session ${sessionId} not found in container:`, err)
          result.success = false
          result.error = `Failed to create tmux session "${sessionId}" inside container. Check terminal for errors.`
        }
      }
    }

    return result
  } catch (error) {
    cleanupOldPromptFiles(context.worktreePath, context.ticketId)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run in devcontainer',
    }
  }
}

// =============================================================================
// Background Display Handler
// =============================================================================

/**
 * Run devcontainer command in background, logging to file
 */
async function runDevcontainerInBackground(
  context: ExecutionContext,
  devcontainerCmd: string
): Promise<RunnerResult> {
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
