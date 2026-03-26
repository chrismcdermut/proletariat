/**
 * Docker Runner
 *
 * Runs commands in detached Docker containers.
 * Uses simple docker run for standalone container execution.
 */

import {
  execSync,
  PermissionMode,
  ExecutorType,
  ExecutionContext,
  ExecutionConfig,
  validateCodexMode,
} from './shared.js'

import {
  RunnerResult,
  buildPrompt,
  getExecutorCommand,
  isClaudeExecutor,
  checkDockerDaemon,
} from './shared.js'

/**
 * Run command in a detached Docker container.
 * Uses simple docker run with -d flag for background execution.
 */
export async function runDocker(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig
): Promise<RunnerResult> {
  const prompt = buildPrompt(context)
  const containerName = `work-${context.ticketId}-${Date.now()}`

  try {
    // Check if docker is available and daemon is responsive (TKT-081)
    const dockerStatus = checkDockerDaemon()
    if (!dockerStatus.available) {
      return {
        success: false,
        error: `Docker daemon is not available. ${dockerStatus.message}`,
      }
    }

    // Build docker run command
    let dockerCmd = `docker run -d --name ${containerName}`
    dockerCmd += ` -v "${context.worktreePath}:/workspace"`
    dockerCmd += ` -w /workspace`
    dockerCmd += ` -e TICKET_ID="${context.ticketId}"`

    if (config.docker.network) {
      dockerCmd += ` --network ${config.docker.network}`
    }
    if (config.docker.memory) {
      dockerCmd += ` --memory ${config.docker.memory}`
    }
    if (config.docker.cpus) {
      dockerCmd += ` --cpus ${config.docker.cpus}`
    }

    // Add Docker HEALTHCHECK for heartbeat-based stale detection.
    // Checks if the main process (PID 1) is still running every 5 minutes.
    // The session watcher uses `docker inspect` to read this health status.
    dockerCmd += ` --health-cmd "kill -0 1 || exit 1"`
    dockerCmd += ` --health-interval 5m`
    dockerCmd += ` --health-timeout 10s`
    dockerCmd += ` --health-retries 3`
    dockerCmd += ` --health-start-period 30s`

    // Validate Codex mode: Docker runner is always non-tty (detached with -d)
    if (executor === 'codex') {
      const codexPermission: PermissionMode = config.permissionMode
      const modeError = validateCodexMode(codexPermission, 'non-tty')
      if (modeError) {
        return { success: false, error: modeError.message }
      }
    }

    // Build executor command using getExecutorCommand() for correct invocation
    const escapedPrompt = prompt.replace(/'/g, "'\\''")
    const { cmd, args } = getExecutorCommand(executor, escapedPrompt, config.permissionMode === 'danger')

    // For Claude Code in Docker, use --print for non-interactive output
    // Non-Claude executors use their native command format from getExecutorCommand()
    dockerCmd += ` ${config.docker.image}`
    if (isClaudeExecutor(executor)) {
      // TKT-053: Disable plan mode — Docker runner is always detached (no user to approve)
      // PRLT-950: Use -- to separate flags from positional prompt argument.
      dockerCmd += ` ${cmd} --print --disallowedTools EnterPlanMode -- '${escapedPrompt}'`
    } else {
      const argsStr = args.map(a => a === escapedPrompt ? `'${escapedPrompt}'` : a).join(' ')
      dockerCmd += ` ${cmd} ${argsStr}`
    }

    const containerId = execSync(dockerCmd, { encoding: 'utf-8' }).trim()

    return {
      success: true,
      containerId: containerId.substring(0, 12),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start docker container',
    }
  }
}
