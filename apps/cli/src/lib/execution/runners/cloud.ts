/**
 * Cloud Runner (was VM Runner)
 *
 * Runs commands on remote machines via SSH.
 * Supports rsync and git-based file syncing.
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
} from './shared.js'

/**
 * Run command on a remote machine (cloud) via SSH.
 * Formerly 'runVm' — renamed to reflect the simplified environment hierarchy.
 * Uses cloud config with fallback to legacy vm config for backwards compatibility.
 */
export async function runCloud(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig,
  host?: string
): Promise<RunnerResult> {
  // Use cloud config, fall back to vm config for backwards compatibility
  const cloudConfig = config.cloud?.defaultHost ? config.cloud : config.vm
  const targetHost = host || cloudConfig.defaultHost
  if (!targetHost) {
    return {
      success: false,
      error: 'No cloud host specified. Use --host or configure execution.cloud.default_host',
    }
  }

  const prompt = buildPrompt(context)
  const user = cloudConfig.user
  const keyPath = cloudConfig.keyPath
  const remoteWorkspace = `/workspace/${context.agentName}`

  try {
    // Build SSH options
    let sshOpts = ''
    if (keyPath) {
      sshOpts = `-i "${keyPath}"`
    }

    // Sync worktree to remote
    if (cloudConfig.syncMethod === 'rsync') {
      let rsyncCmd = `rsync -avz`
      if (keyPath) {
        rsyncCmd += ` -e "ssh -i ${keyPath}"`
      }
      rsyncCmd += ` "${context.worktreePath}/" ${user}@${targetHost}:${remoteWorkspace}/`
      execSync(rsyncCmd, { stdio: 'pipe' })
    } else {
      // Git-based sync: push branch and pull on remote
      execSync(`git push origin ${context.branch}`, { cwd: context.worktreePath, stdio: 'pipe' })
      const gitPullCmd = `cd ${remoteWorkspace} && git fetch && git checkout ${context.branch}`
      execSync(`ssh ${sshOpts} ${user}@${targetHost} "${gitPullCmd}"`, { stdio: 'pipe' })
    }

    // Validate Codex mode: Cloud runner is always non-tty (SSH + nohup)
    if (executor === 'codex') {
      const codexPermission: PermissionMode = config.permissionMode
      const modeError = validateCodexMode(codexPermission, 'non-tty')
      if (modeError) {
        return { success: false, error: modeError.message }
      }
    }

    // Execute on remote using executor-appropriate command
    const escapedPrompt = prompt.replace(/'/g, "'\\''")
    const { cmd: executorCmd, args: executorArgs } = getExecutorCommand(executor, escapedPrompt, config.permissionMode === 'danger', context.executorBin)

    // PRLT-1369: Build env var prefix for the remote command (e.g. CLAUDE_CONFIG_DIR)
    const envPrefix = context.executorEnv
      ? Object.entries(context.executorEnv)
          .map(([k, v]) => `${k}='${v.replace(/'/g, "'\\''")}'`)
          .join(' ') + ' '
      : ''

    // Build the remote command based on executor type
    let remoteCmd: string
    if (isClaudeExecutor(executor)) {
      // TKT-053: Disable plan mode — VM runner is always nohup (no user to approve)
      // PRLT-950: Use -- to separate flags from positional prompt argument.
      remoteCmd = `cd ${remoteWorkspace} && ${envPrefix}${executorCmd} --print --disallowedTools EnterPlanMode -- '${escapedPrompt}'`
    } else {
      const argsStr = executorArgs.map(a => a === escapedPrompt ? `'${escapedPrompt}'` : a).join(' ')
      remoteCmd = `cd ${remoteWorkspace} && ${envPrefix}${executorCmd} ${argsStr}`
    }
    const sshCmd = `ssh ${sshOpts} ${user}@${targetHost} "nohup ${remoteCmd} > /tmp/work-${context.ticketId}.log 2>&1 &"`

    execSync(sshCmd, { stdio: 'pipe' })

    return {
      success: true,
      sessionId: `${targetHost}:${context.ticketId}`,
      logPath: `/tmp/work-${context.ticketId}.log`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute on cloud',
    }
  }
}

/** @deprecated Use runCloud instead */
export const runVm = runCloud
