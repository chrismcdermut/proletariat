/**
 * Orchestrator Docker Runner (Sibling Container Pattern)
 *
 * Runs the orchestrator in a Docker container that can spawn sibling containers
 * via the mounted Docker socket.
 */

import {
  spawn,
  execSync,
  fs,
  path,
  os,
  DisplayMode,
  ExecutorType,
  ExecutionContext,
  ExecutionConfig,
  generateOrchestratorDockerfile,
  generateEntrypointScript,
} from './shared.js'

import type { OrchestratorDockerOptions } from './shared.js'

import {
  RunnerResult,
  buildPrompt,
  checkDockerDaemon,
  containerExists,
  isContainerRunning,
  getContainerId,
  getHostPrltVersion,
} from './shared.js'

import {
  detectCCVersionInContainer,
  getCCUserPermissionSettings,
  getCCAppPermissionSettings,
} from '../cc-version.js'

/**
 * Run orchestrator in a Docker container using the sibling container pattern.
 *
 * Architecture:
 * ```
 * Host Docker daemon
 * ├── orchestrator container (has /var/run/docker.sock mounted)
 * ├── agent-1 container (spawned by orchestrator, sibling)
 * ├── agent-2 container (spawned by orchestrator, sibling)
 * ```
 *
 * The orchestrator container needs:
 * - HQ directory mounted (proletariat-hq)
 * - Docker socket mounted (/var/run/docker.sock) — so it can spawn agent containers as siblings
 * - prlt CLI installed in the container
 * - OAuth credentials for Claude Code (via Docker volume)
 * - tmux for session persistence inside the container
 */
export async function runOrchestratorInDocker(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig,
  options?: { displayMode?: DisplayMode; sessionName?: string }
): Promise<RunnerResult> {
  const displayMode = options?.displayMode || 'background'
  const hqPath = context.hqPath || context.worktreePath
  const hqName = context.hqName || 'default'
  const orchestratorName = context.agentName || 'main'

  // Container name matches tmux session name for consistency
  const containerName = `prlt-orchestrator-${(hqName).replace(/[^a-zA-Z0-9._-]/g, '-')}-${(orchestratorName).replace(/[^a-zA-Z0-9._-]/g, '-')}`
  const imageName = `prlt-orchestrator-${(hqName).replace(/[^a-zA-Z0-9._-]/g, '-')}:latest`

  try {
    // Check Docker is running (TKT-081: fast detection with diagnostic info)
    const dockerStatus = checkDockerDaemon()
    if (!dockerStatus.available) {
      return {
        success: false,
        error: `Docker daemon is not available. ${dockerStatus.message}`,
      }
    }

    // Check if container already exists and is running
    if (containerExists(containerName)) {
      if (isContainerRunning(containerName)) {
        return {
          success: false,
          error: `Orchestrator container "${containerName}" is already running. Use "prlt orchestrator attach" to reattach.`,
        }
      }
      // Remove stopped container
      try {
        execSync(`docker rm -f ${containerName}`, { stdio: 'pipe' })
      } catch {
        // Ignore removal errors
      }
    }

    // Generate Dockerfile
    const orchestratorDockerOptions: OrchestratorDockerOptions = {
      orchestratorName,
      hqPath,
      executor,
    }
    const dockerfileContent = generateOrchestratorDockerfile(orchestratorDockerOptions)

    // Write Dockerfile and entrypoint to temp directory
    const buildDir = path.join(hqPath, '.proletariat', 'orchestrator-docker')
    fs.mkdirSync(buildDir, { recursive: true })
    const dockerfilePath = path.join(buildDir, 'Dockerfile')
    fs.writeFileSync(dockerfilePath, dockerfileContent)

    // Write entrypoint script (PRLT-1089: auto-start tmux sessions)
    const entrypointContent = generateEntrypointScript()
    fs.writeFileSync(path.join(buildDir, 'entrypoint.sh'), entrypointContent, { mode: 0o755 })

    // Build the image
    const hostPrltVersion = getHostPrltVersion()
    const buildArgs: Record<string, string> = {
      PRLT_VERSION: hostPrltVersion || 'latest',
    }
    const buildArgFlags = Object.entries(buildArgs)
      .map(([key, value]) => `--build-arg ${key}="${value}"`)
      .join(' ')

    console.debug(`[runners:orchestrator-docker] Building image: ${imageName}`)
    try {
      execSync(`docker build -t ${imageName} -f "${dockerfilePath}" ${buildArgFlags} "${buildDir}"`, { stdio: 'pipe' })
    } catch (buildError) {
      return {
        success: false,
        error: `Failed to build orchestrator Docker image: ${buildError instanceof Error ? buildError.message : buildError}`,
      }
    }

    // Build mount flags for docker run
    const mounts: string[] = [
      // Mount HQ directory
      `-v "${hqPath}:/hq:cached"`,
      // Docker socket for sibling container pattern
      `-v /var/run/docker.sock:/var/run/docker.sock`,
      // Claude credentials volume (shared with agent containers)
      ...(executor === 'claude-code' ? ['-v "claude-credentials:/home/node/.claude"'] : []),
      // Persistent bash history
      '-v "claude-bash-history:/commandhistory"',
    ]

    // Build environment variables
    const envVars: string[] = [
      `-e PRLT_HQ_PATH=/hq`,
      `-e PRLT_AGENT_NAME="orchestrator-${orchestratorName}"`,
      `-e PRLT_HOST_PATH="${hqPath}"`,
      // Pass through GitHub tokens for agent spawning
      ...(process.env.GITHUB_TOKEN ? [`-e GITHUB_TOKEN="${process.env.GITHUB_TOKEN}"`] : []),
      ...(process.env.GH_TOKEN ? [`-e GH_TOKEN="${process.env.GH_TOKEN}"`] : []),
      // Pass ANTHROPIC_API_KEY if available (for cases where OAuth is not set up)
      ...(process.env.ANTHROPIC_API_KEY ? [`-e ANTHROPIC_API_KEY="${process.env.ANTHROPIC_API_KEY}"`] : []),
    ]

    // Create and start container
    const createCmd = [
      'docker run -d',
      `--name ${containerName}`,
      '--user node',
      '-w /hq',
      ...mounts,
      ...envVars,
      `--memory=${config.devcontainer.memory}`,
      `--cpus=${config.devcontainer.cpus}`,
      imageName,
      '/usr/local/bin/entrypoint.sh',  // PRLT-1089: entrypoint auto-starts tmux sessions
    ].join(' ')

    console.debug(`[runners:orchestrator-docker] Creating container: ${createCmd}`)
    execSync(createCmd, { stdio: 'pipe' })

    const containerId = getContainerId(containerName)
    if (!containerId) {
      return {
        success: false,
        error: 'Failed to get container ID after creation',
      }
    }

    // Fix Docker socket permissions inside the container
    // The socket is owned by root on the host; we need the node user to access it
    try {
      execSync(`docker exec --user root ${containerId} chmod 666 /var/run/docker.sock`, { stdio: 'pipe' })
    } catch {
      console.debug('[runners:orchestrator-docker] Failed to fix Docker socket permissions (may already be accessible)')
    }

    // Copy Claude Code settings to container (for bypassing prompts)
    if (executor === 'claude-code') {
      try {
        // PRLT-1240: Detect CC version in container for version-aware settings
        const ccVersion = detectCCVersionInContainer(containerId)
        console.debug(`[runners:orchestrator-docker] Detected Claude Code version: ${ccVersion || 'unknown'}`)

        const hostClaudeJson = path.join(os.homedir(), '.claude.json')
        let settings: Record<string, unknown> = {}

        if (fs.existsSync(hostClaudeJson)) {
          try {
            settings = JSON.parse(fs.readFileSync(hostClaudeJson, 'utf-8'))
          } catch {
            // Use empty settings
          }
        }

        if (config.permissionMode === 'danger') {
          // PRLT-1240: Write version-aware permission settings to .claude.json
          const permSettings = getCCUserPermissionSettings(ccVersion)
          Object.assign(settings, permSettings)
        }
        settings.numStartups = settings.numStartups || 1
        settings.hasCompletedOnboarding = true
        settings.theme = settings.theme || 'dark'
        if (!settings.tipsHistory || typeof settings.tipsHistory !== 'object') {
          settings.tipsHistory = {}
        }
        const tips = settings.tipsHistory as Record<string, number>
        tips['new-user-warmup'] = tips['new-user-warmup'] || 1
        settings.effortCalloutDismissed = true

        if (!settings.projects || typeof settings.projects !== 'object') {
          settings.projects = {}
        }
        const projects = settings.projects as Record<string, Record<string, unknown>>
        for (const projectPath of ['/hq', '/']) {
          if (!projects[projectPath]) projects[projectPath] = {}
          projects[projectPath].hasTrustDialogAccepted = true
          projects[projectPath].hasCompletedProjectOnboarding = true
        }

        execSync(
          `docker exec -i ${containerId} bash -c 'cat > /home/node/.claude.json'`,
          { input: JSON.stringify(settings), stdio: ['pipe', 'pipe', 'pipe'] }
        )

        // PRLT-1240: Write version-aware app settings to settings.json
        const appPermSettings = getCCAppPermissionSettings(ccVersion)
        const claudeSettings = JSON.stringify(appPermSettings)
        execSync(
          `docker exec -i ${containerId} bash -c 'mkdir -p /home/node/.claude && cat > /home/node/.claude/settings.json'`,
          { input: claudeSettings, stdio: ['pipe', 'pipe', 'pipe'] }
        )
      } catch (error) {
        console.debug('[runners:orchestrator-docker] Failed to copy Claude settings:', error)
      }
    }

    // Build the prompt and write to temp file inside container
    const prompt = buildPrompt(context)
    const promptPath = `/tmp/orchestrator-prompt-${Date.now()}.txt`
    try {
      execSync(
        `docker exec -i ${containerId} bash -c 'cat > ${promptPath}'`,
        { input: prompt, stdio: ['pipe', 'pipe', 'pipe'] }
      )
    } catch {
      return {
        success: false,
        error: 'Failed to write prompt to container',
      }
    }

    // Build executor command
    const skipPermissions = config.permissionMode === 'danger'
    const permissionsFlag = skipPermissions ? '--dangerously-skip-permissions ' : ''
    const effortFlag = skipPermissions ? '--effort high ' : ''
    // TKT-053: Disable plan mode for background agents — prevents silent stalls
    const disallowPlanFlag = displayMode === 'background' ? '--disallowedTools EnterPlanMode ' : ''
    // PRLT-950: Use -- to separate flags from positional prompt argument.
    // --disallowedTools is variadic and will consume the prompt as its second arg without --.
    const executorCmd = executor === 'claude-code'
      ? `claude ${permissionsFlag}${effortFlag}${disallowPlanFlag}-- "$(cat ${promptPath})"`
      : `claude ${permissionsFlag}${effortFlag}-- "$(cat ${promptPath})"`

    // Build tmux session name (reuses the same name as host tmux for consistency)
    const tmuxSessionName = options?.sessionName || containerName

    // Create tmux session inside container with the executor command
    const tmuxCmd = `tmux new-session -d -s "${tmuxSessionName}" -n "${tmuxSessionName}" bash -c '(unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT; cd /hq && ${executorCmd}); echo ""; echo "Orchestrator complete. Press Enter to close."; exec bash'`

    try {
      execSync(
        `docker exec ${containerId} bash -c '${tmuxCmd.replace(/'/g, "'\\''")}'`,
        { stdio: 'pipe' }
      )
    } catch (tmuxError) {
      // Fallback: try simpler command without subshell
      console.debug('[runners:orchestrator-docker] tmux creation failed, trying simpler approach:', tmuxError)
      try {
        // Write a script inside the container
        const scriptContent = `#!/bin/bash
cd /hq
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT
${executor === 'claude-code' ? `claude ${permissionsFlag}${effortFlag}${disallowPlanFlag}"$(cat ${promptPath})"` : `claude "$(cat ${promptPath})"`}
echo ""
echo "Orchestrator complete. Press Enter to close."
exec bash
`
        execSync(
          `docker exec -i ${containerId} bash -c 'cat > /tmp/orchestrator-start.sh && chmod +x /tmp/orchestrator-start.sh'`,
          { input: scriptContent, stdio: ['pipe', 'pipe', 'pipe'] }
        )
        execSync(
          `docker exec ${containerId} tmux new-session -d -s "${tmuxSessionName}" /tmp/orchestrator-start.sh`,
          { stdio: 'pipe' }
        )
      } catch (fallbackError) {
        return {
          success: false,
          error: `Failed to create tmux session in container: ${fallbackError instanceof Error ? fallbackError.message : fallbackError}`,
        }
      }
    }

    // Handle display mode
    if (displayMode === 'foreground') {
      // Attach to tmux inside the container in current terminal
      try {
        const child = spawn('docker', ['exec', '-it', containerId, 'tmux', 'attach', '-t', tmuxSessionName], {
          stdio: 'inherit',
        })
        await new Promise<void>((resolve) => {
          child.on('close', () => resolve())
        })
      } catch {
        // User detached - that's fine
      }
    } else if (displayMode === 'terminal' && process.platform === 'darwin') {
      // Open a new terminal tab that attaches to the container's tmux
      const baseDir = path.join(hqPath, '.proletariat', 'scripts')
      fs.mkdirSync(baseDir, { recursive: true })
      const scriptPath = path.join(baseDir, `orch-docker-attach-${Date.now()}.sh`)
      const scriptContent = `#!/bin/bash
echo -ne "\\033]0;Orchestrator (Docker)\\007"
echo -ne "\\033]1;Orchestrator (Docker)\\007"
docker exec -it ${containerId} tmux attach -t "${tmuxSessionName}"
rm -f "${scriptPath}"
exec $SHELL
`
      fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 })

      const terminalApp = config.terminal.app
      try {
        switch (terminalApp) {
          case 'iTerm':
            execSync(`osascript -e '
              tell application "iTerm"
                activate
                tell current window
                  set newTab to (create tab with default profile)
                  tell current session of newTab
                    set name to "Orchestrator (Docker)"
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
      } catch {
        console.debug('[runners:orchestrator-docker] Failed to open terminal tab, running in background')
      }
    }
    // 'background' display mode: container is already running, nothing more to do

    return {
      success: true,
      containerId,
      sessionId: tmuxSessionName,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start orchestrator in Docker',
    }
  }
}
