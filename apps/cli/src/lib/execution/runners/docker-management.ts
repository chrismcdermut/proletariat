/**
 * Docker Container Management
 *
 * Functions for managing Docker containers, images, and setup.
 * Uses raw Docker commands instead of devcontainer CLI.
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  PermissionMode,
  ExecutorType,
  ExecutionContext,
  ExecutionConfig,
} from '../types.js'
import { readDevcontainerJson } from '../devcontainer.js'
import { isClaudeExecutor } from './executor.js'

/**
 * Get the host's installed prlt CLI version.
 * Returns the semver version string (e.g., "0.3.35") or null if not available.
 */
export function getHostPrltVersion(): string | null {
  try {
    const output = execSync('prlt --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    const match = output.match(/(\d+\.\d+\.\d+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * Get the container name for an agent.
 * Format: prlt-agent-{agentName}
 */
export function getAgentContainerName(agentName: string): string {
  const sanitized = agentName.replace(/[^a-zA-Z0-9_-]/g, '-')
  return `prlt-agent-${sanitized}`
}

export const getContainerName = getAgentContainerName

export function getImageName(agentName: string): string {
  const sanitized = agentName.replace(/[^a-zA-Z0-9_-]/g, '-')
  return `prlt-agent-${sanitized}:latest`
}

/**
 * Check if a Docker container exists (running or stopped).
 */
export function containerExists(containerName: string): boolean {
  try {
    execSync(`docker container inspect ${containerName}`, { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Check if a Docker container is running.
 */
export function isContainerRunning(containerName: string): boolean {
  try {
    const status = execSync(
      `docker container inspect -f '{{.State.Running}}' ${containerName}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
    ).trim()
    return status === 'true'
  } catch {
    return false
  }
}

/**
 * Get the container ID for a running container.
 */
export function getContainerId(containerName: string): string | null {
  try {
    const containerId = execSync(
      `docker container inspect -f '{{.Id}}' ${containerName}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
    ).trim()
    return containerId ? containerId.substring(0, 12) : null
  } catch {
    return null
  }
}

export function buildDockerImage(agentDir: string, imageName: string, buildArgs: Record<string, string> = {}): boolean {
  const dockerfilePath = path.join(agentDir, '.devcontainer', 'Dockerfile')
  if (!fs.existsSync(dockerfilePath)) {
    console.debug(`[runners:docker] Dockerfile not found at ${dockerfilePath}`)
    return false
  }
  try {
    const buildArgFlags = Object.entries(buildArgs)
      .map(([key, value]) => `--build-arg ${key}="${value}"`)
      .join(' ')
    const buildCmd = `docker build -t ${imageName} -f "${dockerfilePath}" ${buildArgFlags} "${path.join(agentDir, '.devcontainer')}"`
    console.debug(`[runners:docker] Building image: ${buildCmd}`)
    execSync(buildCmd, { stdio: 'pipe' })
    return true
  } catch (error) {
    console.debug(`[runners:docker] Failed to build image:`, error)
    return false
  }
}

export function imageExists(imageName: string): boolean {
  try {
    execSync(`docker image inspect ${imageName}`, { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Create and start a Docker container for an agent.
 */
export function createDockerContainer(
  context: ExecutionContext,
  containerName: string,
  imageName: string,
  config: ExecutionConfig,
  executor: ExecutorType = 'claude-code',
  prltInfo?: { registry: string; version: string }
): boolean {
  const mounts: string[] = [
    `-v "${context.agentDir}:/workspace:cached"`,
    ...(context.hqPath ? [`-v "${context.hqPath}/.proletariat:/hq/.proletariat:cached"`] : []),
    ...(context.pmoPath ? [`-v "${context.pmoPath}:/hq/pmo:cached"`] : []),
    ...(context.repoWorktrees || []).map(
      repoName => `-v "${context.hqPath}/repos/${repoName}:/hq/repos/${repoName}:cached"`
    ),
    ...(isClaudeExecutor(executor) ? [`-v "claude-credentials:/home/node/.claude"`] : []),
  ]

  const hasWorktrees = context.repoWorktrees && context.repoWorktrees.length > 0
  // Merge workspace-level and action-level network allowlists (PRLT-1079)
  const firewallAllowlistDomains = [...new Set([
    ...(config.firewall?.allowlistDomains || []),
    ...(context.networkAllowlist || []),
  ].map(domain => domain.trim().toLowerCase())
    .filter(domain => /^[a-z0-9.-]+$/.test(domain)))]
  const envVars: string[] = [
    `-e DEVCONTAINER=true`,
    `-e PRLT_HQ_PATH=/hq`,
    `-e PRLT_AGENT_NAME="${context.agentName}"`,
    `-e PRLT_HOST_PATH="${context.agentDir}"`,
    ...(context.useApiKey && process.env.ANTHROPIC_API_KEY ? [`-e ANTHROPIC_API_KEY="${process.env.ANTHROPIC_API_KEY}"`] : []),
    ...(process.env.GITHUB_TOKEN ? [`-e GITHUB_TOKEN="${process.env.GITHUB_TOKEN}"`] : []),
    ...(process.env.GH_TOKEN ? [`-e GH_TOKEN="${process.env.GH_TOKEN}"`] : []),
    ...(firewallAllowlistDomains.length > 0 ? [`-e PRLT_EXTRA_ALLOWLIST_DOMAINS="${firewallAllowlistDomains.join(',')}"`] : []),
    ...(hasWorktrees ? [`-e PRLT_MOUNT_MODE=worktree`] : []),
    ...(prltInfo ? [
      `-e PRLT_REGISTRY="${prltInfo.registry}"`,
      `-e PRLT_VERSION="${prltInfo.version}"`,
    ] : []),
  ]

  const resourceFlags = [
    `--memory=${config.devcontainer.memory}`,
    `--cpus=${config.devcontainer.cpus}`,
  ]

  const securityFlags = [
    '--cap-add=NET_ADMIN',
    '--cap-add=NET_RAW',
  ]

  try {
    const createCmd = [
      'docker run -d',
      `--name ${containerName}`,
      '--user node',
      '-w /workspace',
      ...mounts,
      ...envVars,
      ...resourceFlags,
      ...securityFlags,
      imageName,
      'sleep infinity',
    ].join(' ')
    console.debug(`[runners:docker] Creating container: ${createCmd}`)
    execSync(createCmd, { stdio: 'pipe' })
    return true
  } catch (error) {
    console.debug(`[runners:docker] Failed to create container:`, error)
    return false
  }
}

/**
 * Build the Claude Code stop hook config in the new matcher+hooks array format.
 * PRLT-1082: The old flat format caused Claude Code to skip the entire settings.json
 * due to validation error, breaking skipDangerousModePermissionPrompt.
 */
export function buildClaudeStopHookConfig(): Record<string, unknown> {
  return {
    hooks: {
      Stop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command' as const,
              command: 'prlt session report --agent "$PRLT_AGENT_NAME" --status exited 2>/dev/null || true',
            },
          ],
        },
      ],
    },
  }
}

/**
 * Run the post-start setup commands in a container.
 */
export function runContainerSetup(containerId: string, permissionMode: PermissionMode = 'safe', executor: ExecutorType = 'claude-code'): boolean {
  try {
    execSync(`docker exec ${containerId} sudo /usr/local/bin/init-firewall.sh`, { stdio: 'pipe' })
    execSync(`docker exec ${containerId} /usr/local/bin/setup-prlt.sh`, { stdio: 'pipe' })
  } catch (error) {
    console.debug(`[runners:docker] Container setup scripts failed:`, error)
  }

  try {
    execSync(`docker exec ${containerId} pnpm config set store-dir /tmp/pnpm-store`, { stdio: 'pipe' })
    console.debug(`[runners:docker] Configured pnpm store-dir to /tmp/pnpm-store`)
  } catch (error) {
    console.debug(`[runners:docker] Failed to configure pnpm store (pnpm may not be installed):`, error)
  }

  if (isClaudeExecutor(executor)) {
    try {
      const hostClaudeJson = path.join(os.homedir(), '.claude.json')
      let settings: Record<string, unknown> = {}
      if (fs.existsSync(hostClaudeJson)) {
        try {
          settings = JSON.parse(fs.readFileSync(hostClaudeJson, 'utf-8'))
        } catch {
          console.debug('[runners:docker] Failed to parse host .claude.json, using empty settings')
        }
      }
      if (permissionMode === 'danger') {
        settings.bypassPermissionsModeAccepted = true
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
      for (const projectPath of ['/workspace', '/']) {
        if (!projects[projectPath]) {
          projects[projectPath] = {}
        }
        projects[projectPath].hasTrustDialogAccepted = true
        projects[projectPath].hasCompletedProjectOnboarding = true
      }

      const settingsJson = JSON.stringify(settings)
      execSync(
        `docker exec -i ${containerId} bash -c 'cat > /home/node/.claude.json'`,
        { input: settingsJson, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      console.debug(`[runners:docker] Copied .claude.json settings to container (bypassPermissionsModeAccepted=${permissionMode === 'danger'})`)

      const claudeSettings = JSON.stringify({ skipDangerousModePermissionPrompt: true })
      execSync(
        `docker exec -i ${containerId} bash -c 'mkdir -p /home/node/.claude && cat > /home/node/.claude/settings.json'`,
        { input: claudeSettings, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      console.debug(`[runners:docker] Wrote ~/.claude/settings.json to container`)

      // Write Claude Code stop hook for automatic container cleanup (PRLT-1061)
      // When the Claude Code session ends, the stop hook calls `prlt session report`
      // which reads the execution record and cleanup policy to decide what to do.
      // Uses $PRLT_AGENT_NAME shell variable which is set as a container env var
      // during createDockerContainer() — this ensures the correct agent name is used
      // regardless of which process is running the container setup.
      const stopHookConfig = buildClaudeStopHookConfig()
      // Merge stop hook into existing settings.json
      const mergedSettings = { ...JSON.parse(claudeSettings), ...stopHookConfig }
      execSync(
        `docker exec -i ${containerId} bash -c 'cat > /home/node/.claude/settings.json'`,
        { input: JSON.stringify(mergedSettings), stdio: ['pipe', 'pipe', 'pipe'] }
      )
      console.debug(`[runners:docker] Configured Claude Code stop hook for container cleanup`)
    } catch (error) {
      console.debug('[runners:docker] Failed to copy Claude settings to container:', error)
    }
  } else {
    console.debug(`[runners:docker] Skipping .claude.json settings injection for ${executor} executor`)
  }

  return true
}

/**
 * Ensure a Docker container is running for the agent.
 * Reuses running containers to preserve in-progress work (TKT-1028).
 */
export function ensureDockerContainer(
  context: ExecutionContext,
  config: ExecutionConfig,
  executor: ExecutorType = 'claude-code'
): string | null {
  const containerName = getContainerName(context.agentName)
  const imageName = getImageName(context.agentName)

  if (containerExists(containerName)) {
    if (isContainerRunning(containerName)) {
      const containerId = getContainerId(containerName)
      if (containerId) {
        console.debug(`[runners:docker] Reusing running container ${containerName} (${containerId}), skipping setup`)
        return containerId
      }
    }
    console.debug(`[runners:docker] Removing stopped container ${containerName} to create fresh one`)
    try {
      execSync(`docker rm -f ${containerName}`, { stdio: 'pipe', timeout: 10000 })
    } catch {
      // Ignore removal errors
    }
  }

  const devcontainerJson = readDevcontainerJson(context.agentDir)
  const buildArgs: Record<string, string> = {
    TZ: devcontainerJson?.build?.args?.TZ || 'America/Los_Angeles',
    PRLT_REGISTRY: devcontainerJson?.build?.args?.PRLT_REGISTRY || 'npm',
  }

  // Pass Claude Code version if pinned in devcontainer config
  const ccVersion = devcontainerJson?.build?.args?.CC_VERSION
  if (ccVersion) {
    buildArgs.CC_VERSION = ccVersion
  }

  const configuredVersion = devcontainerJson?.build?.args?.PRLT_VERSION || 'latest'
  const isTagVersion = ['latest', 'dev', 'next'].includes(configuredVersion)
  const hostPrltVersion = isTagVersion ? getHostPrltVersion() : null

  if (hostPrltVersion) {
    buildArgs.PRLT_VERSION = hostPrltVersion
    console.debug(`[runners:docker] Using host prlt version ${hostPrltVersion} for image build`)
  } else {
    buildArgs.PRLT_VERSION = configuredVersion
  }

  console.debug(`[runners:docker] Building image ${imageName} (PRLT_VERSION=${buildArgs.PRLT_VERSION})`)
  if (!buildDockerImage(context.agentDir, imageName, buildArgs)) {
    if (!imageExists(imageName)) {
      return null
    }
    console.debug(`[runners:docker] Build failed but existing image found, continuing with runtime update`)
  }

  const prltInfo = {
    registry: buildArgs.PRLT_REGISTRY,
    version: buildArgs.PRLT_VERSION,
  }

  console.debug(`[runners:docker] Creating container ${containerName}`)
  if (!createDockerContainer(context, containerName, imageName, config, executor, prltInfo)) {
    return null
  }

  const containerId = getContainerId(containerName)
  if (!containerId) {
    return null
  }

  console.debug(`[runners:docker] Running container setup (permissionMode=${config.permissionMode}, executor=${executor})`)
  if (!runContainerSetup(containerId, config.permissionMode, executor)) {
    console.debug(`[runners:docker] Setup failed, but continuing...`)
  }

  return containerId
}
