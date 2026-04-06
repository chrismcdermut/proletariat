/**
 * Docker Container Management
 *
 * Functions for managing Docker containers, images, and setup.
 * Uses raw Docker commands instead of devcontainer CLI.
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  PermissionMode,
  ExecutorType,
  ExecutionContext,
  ExecutionConfig,
} from '../types.js'
import { readDevcontainerJson } from '../devcontainer.js'
import { isClaudeExecutor } from './executor.js'
import { getMachineId } from '../../telemetry/analytics.js'
import {
  getCCAppPermissionSettings,
} from '../cc-version.js'

/** Docker volume name for the shared pnpm store cache (PRLT-1130) */
export const PNPM_STORE_CACHE_VOLUME = 'pnpm-store-cache'

/**
 * Parse a Docker memory string (e.g., '4g', '512m', '2048m') into bytes.
 */
export function parseMemoryToBytes(memory: string): number {
  const match = memory.match(/^(\d+)([gm])$/i)
  if (!match) return 0
  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()
  if (unit === 'g') return value * 1024 * 1024 * 1024
  if (unit === 'm') return value * 1024 * 1024
  return 0
}

/**
 * Get total memory allocated to Docker (in bytes).
 * Returns null if Docker is not available or the info cannot be retrieved.
 */
export function getDockerTotalMemory(): number | null {
  try {
    const output = execSync('docker info --format "{{.MemTotal}}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim()
    const bytes = parseInt(output, 10)
    return isNaN(bytes) ? null : bytes
  } catch {
    return null
  }
}

/**
 * Get memory used by running prlt agent containers (in bytes).
 * Returns the sum of memory limits for all running prlt-agent-* containers.
 */
export function getRunningContainersMemoryUsage(): number {
  try {
    const output = execSync(
      'docker ps --filter "name=prlt-agent-" --format "{{.ID}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
    ).trim()
    if (!output) return 0

    const containerIds = output.split('\n').filter(Boolean)
    let totalBytes = 0

    for (const id of containerIds) {
      try {
        const memLimit = execSync(
          `docker inspect --format "{{.HostConfig.Memory}}" ${id}`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
        ).trim()
        const bytes = parseInt(memLimit, 10)
        if (!isNaN(bytes) && bytes > 0) {
          totalBytes += bytes
        }
      } catch {
        // Skip containers we can't inspect
      }
    }
    return totalBytes
  } catch {
    return 0
  }
}

export interface DockerMemoryCheck {
  /** Whether the spawn should proceed */
  ok: boolean
  /** Warning message (if any) */
  warning?: string
  /** Docker total memory in bytes */
  dockerTotalMemory: number | null
  /** Memory already used by running prlt containers in bytes */
  usedMemory: number
  /** Memory this container would need in bytes */
  requestedMemory: number
}

/**
 * Check if there is enough Docker memory to spawn a new container.
 * Returns a warning if the new container would exceed available Docker memory.
 */
export function checkDockerMemoryCapacity(containerMemory: string): DockerMemoryCheck {
  const requestedMemory = parseMemoryToBytes(containerMemory)
  const dockerTotalMemory = getDockerTotalMemory()
  const usedMemory = getRunningContainersMemoryUsage()

  if (dockerTotalMemory === null) {
    return { ok: true, dockerTotalMemory, usedMemory, requestedMemory }
  }

  const wouldUse = usedMemory + requestedMemory
  const totalGB = (dockerTotalMemory / (1024 * 1024 * 1024)).toFixed(1)
  const usedGB = (usedMemory / (1024 * 1024 * 1024)).toFixed(1)
  const requestedGB = (requestedMemory / (1024 * 1024 * 1024)).toFixed(1)

  if (wouldUse > dockerTotalMemory) {
    const overcommitGB = ((wouldUse - dockerTotalMemory) / (1024 * 1024 * 1024)).toFixed(1)
    return {
      ok: false,
      warning: `Docker memory overcommit: running containers use ${usedGB}GB, ` +
        `new container needs ${requestedGB}GB, but Docker only has ${totalGB}GB allocated. ` +
        `Overcommit by ${overcommitGB}GB may cause OOM kills.\n` +
        `  Reduce with: prlt config --set "containers.memory 2g"\n` +
        `  Or increase Docker memory in Docker Desktop > Settings > Resources`,
      dockerTotalMemory,
      usedMemory,
      requestedMemory,
    }
  }

  return { ok: true, dockerTotalMemory, usedMemory, requestedMemory }
}

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
/**
 * Build the Docker volume mount flags for an agent container.
 * PRLT-1163: HQ .proletariat is mounted read-only to prevent SQLite corruption
 * from concurrent container writes.
 */
export function buildContainerMounts(
  context: ExecutionContext,
  executor: ExecutorType = 'claude-code',
): string[] {
  return [
    `-v "${context.agentDir}:/workspace:cached"`,
    ...(context.hqPath ? [`-v "${context.hqPath}/.proletariat:/hq/.proletariat:ro"`] : []),
    ...(context.pmoPath ? [`-v "${context.pmoPath}:/hq/pmo:cached"`] : []),
    ...(context.repoWorktrees || []).map(
      repoName => `-v "${context.hqPath}/repos/${repoName}:/hq/repos/${repoName}:cached"`
    ),
    ...(isClaudeExecutor(executor) ? [`-v "claude-credentials:/home/node/.claude"`] : []),
    // PRLT-1130: Mount pnpm store cache read-only for fast installs.
    // If the cache volume doesn't exist, Docker creates an empty one (harmless).
    ...(pnpmStoreCacheExists() ? [`-v "${PNPM_STORE_CACHE_VOLUME}:/tmp/pnpm-store-cache:ro"`] : []),
  ]
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
  const mounts = buildContainerMounts(context, executor)

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
    `-e PRLT_TICKET_ID="${context.ticketId}"`,
    `-e PRLT_HOST_PATH="${context.agentDir}"`,
    ...(context.useApiKey && process.env.ANTHROPIC_API_KEY ? [`-e ANTHROPIC_API_KEY="${process.env.ANTHROPIC_API_KEY}"`] : []),
    ...(process.env.GITHUB_TOKEN ? [`-e GITHUB_TOKEN="${process.env.GITHUB_TOKEN}"`] : []),
    ...(process.env.GH_TOKEN ? [`-e GH_TOKEN="${process.env.GH_TOKEN}"`] : []),
    ...(firewallAllowlistDomains.length > 0 ? [`-e PRLT_EXTRA_ALLOWLIST_DOMAINS="${firewallAllowlistDomains.join(',')}"`] : []),
    ...(hasWorktrees ? [`-e PRLT_MOUNT_MODE=worktree`] : []),
    `-e PRLT_TELEMETRY_MACHINE_ID="${getMachineId()}"`,
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
      '/usr/local/bin/entrypoint.sh',
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
 * Build Claude Code lifecycle hooks for agent containers.
 *
 * PRLT-1224: Three hooks enforce ticket transitions at the Claude Code session layer:
 * - Start: move ticket to in-progress when the agent session begins
 * - Stop: run session report (cleanup + safety net + ticket transition)
 * - SubagentStop: same session report for sub-agent sessions
 *
 * All prlt commands are idempotent — safe to run multiple times.
 *
 * PRLT-1082: Uses the new matcher+hooks array format (not the old flat format)
 * to avoid Claude Code settings.json validation errors.
 */
export function buildClaudeLifecycleHooks(): Record<string, unknown> {
  return {
    hooks: {
      Start: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command' as const,
              command: 'prlt ticket move "$PRLT_TICKET_ID" in-progress 2>/dev/null || true',
            },
          ],
        },
      ],
      Stop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command' as const,
              command: '/home/node/.claude/hooks/hook-wrapper.sh prlt session report --agent "$PRLT_AGENT_NAME" --status exited 2>/dev/null || true',
            },
          ],
        },
      ],
      SubagentStop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command' as const,
              command: '/home/node/.claude/hooks/hook-wrapper.sh prlt session report --agent "$PRLT_AGENT_NAME" --status exited 2>/dev/null || true',
            },
          ],
        },
      ],
      // PRLT-1225: Enforce test coverage before PR creation or push
      // Checks git diff for test file changes — injects warning if none found
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            {
              type: 'command' as const,
              command: '/home/node/.claude/hooks/enforce-tests.sh',
            },
          ],
        },
      ],
    },
  }
}

/**
 * TKT-009: Build the hook-wrapper.sh script content.
 * Validates JSON on stdin before passing to the wrapped command.
 * Prevents crashes when Claude Code sends malformed data on abnormal termination.
 */
export function buildHookWrapperScript(): string {
  return `#!/bin/bash
# TKT-009: Hook wrapper — validates JSON on stdin before passing to the command.
# Prevents parse crashes on abnormal session termination (tmux kill-session).

set -euo pipefail

INPUT=\$(cat 2>/dev/null || true)

if [ -z "\$INPUT" ]; then
  INPUT='{"hook_wrapper":"fallback","reason":"empty_stdin"}'
fi

validate_json() {
  if command -v jq >/dev/null 2>&1; then
    echo "\$INPUT" | jq '.' >/dev/null 2>&1
  elif command -v python3 >/dev/null 2>&1; then
    echo "\$INPUT" | python3 -c 'import sys,json; json.load(sys.stdin)' 2>/dev/null
  else
    case "\$INPUT" in
      '{'*|'['*) return 0 ;;
      *) return 1 ;;
    esac
  fi
}

if ! validate_json; then
  ESCAPED=\$(echo "\$INPUT" | head -c 200 | sed 's/\\\\\\\\/\\\\\\\\\\\\\\\\/g; s/"/\\\\\\"/g; s/\\t/\\\\t/g' | tr '\\n' ' ')
  INPUT="{\\"hook_wrapper\\":\\"fallback\\",\\"reason\\":\\"invalid_json\\",\\"raw_truncated\\":\\"\$ESCAPED\\"}"
fi

if [ \$# -eq 0 ]; then
  echo "\$INPUT"
else
  echo "\$INPUT" | exec "\$@"
fi
`
}

/**
 * PRLT-1225: Build the enforce-tests hook script content.
 * This script fires before Bash tool use, checks if the command is
 * 'gh pr create' or 'git push', and verifies test files were changed.
 * If no tests found, injects a system message telling the agent to write tests.
 */
export function buildEnforceTestsHookScript(): string {
  return `#!/bin/bash
# PRLT-1225: Enforce test coverage in agent PRs
# Fires before Bash tool use — checks if the command is a push/PR command
# and verifies that test files were added or modified in the branch.

INPUT=$(cat)

# Quick check: only care about git push and gh pr create
case "$INPUT" in
  *"gh pr create"*|*"git push"*|*"prlt work propose"*|*"prlt pr create"*)
    ;;
  *)
    exit 0
    ;;
esac

# Check for test files in the branch diff (all commits on this branch)
TEST_FILES=$(git diff --name-only origin/main...HEAD 2>/dev/null | grep -iE '\\.(test|spec)\\.(ts|js|tsx|jsx)$')

if [ -z "$TEST_FILES" ]; then
  # No tests found — inject warning message into agent context
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","additionalContext":"WARNING: No test files (.test.ts, .spec.ts) have been added or modified in this branch. Every PR MUST include tests for changed code — unit tests for new functions, integration tests for new flows. Write tests before creating the PR."}}\\n'
fi

exit 0
`
}

/**
 * @deprecated Use buildClaudeLifecycleHooks() instead. Kept for backward compatibility.
 */
export function buildClaudeStopHookConfig(): Record<string, unknown> {
  return buildClaudeLifecycleHooks()
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

  // NOTE: pnpm store-dir is now configured inside setup-prlt.sh (PRLT-1130)
  // to ensure it's set BEFORE pnpm install runs during workspace setup.

  // PRLT-1240: Do NOT write ~/.claude.json — Claude Code owns that file and
  // overwrites it on startup, clobbering any settings we write. Instead, we use
  // -p (print) mode which skips all onboarding prompts entirely.
  // We still write ~/.claude/settings.json (Claude does not clobber that).
  if (isClaudeExecutor(executor)) {
    try {
      // Write app settings to settings.json (skipDangerousModePermissionPrompt etc.)
      const appPermSettings = getCCAppPermissionSettings()
      const claudeSettings = JSON.stringify(appPermSettings)
      execSync(
        `docker exec -i ${containerId} bash -c 'mkdir -p /home/node/.claude && cat > /home/node/.claude/settings.json'`,
        { input: claudeSettings, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      console.debug(`[runners:docker] Wrote ~/.claude/settings.json to container`)

      // Write Claude Code lifecycle hooks (PRLT-1224, extends PRLT-1061)
      const lifecycleHooks = buildClaudeLifecycleHooks()
      const mergedSettings = { ...JSON.parse(claudeSettings), ...lifecycleHooks }
      execSync(
        `docker exec -i ${containerId} bash -c 'cat > /home/node/.claude/settings.json'`,
        { input: JSON.stringify(mergedSettings), stdio: ['pipe', 'pipe', 'pipe'] }
      )
      console.debug(`[runners:docker] Configured Claude Code lifecycle hooks for agent containers`)

      // TKT-009: Write the hook-wrapper script into the container
      const hookWrapperScript = buildHookWrapperScript()
      execSync(
        `docker exec -i ${containerId} bash -c 'mkdir -p /home/node/.claude/hooks && cat > /home/node/.claude/hooks/hook-wrapper.sh && chmod +x /home/node/.claude/hooks/hook-wrapper.sh'`,
        { input: hookWrapperScript, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      console.debug(`[runners:docker] Wrote hook-wrapper script to container`)

      // PRLT-1225: Write the enforce-tests hook script into the container
      const enforceTestsScript = buildEnforceTestsHookScript()
      execSync(
        `docker exec -i ${containerId} bash -c 'cat > /home/node/.claude/hooks/enforce-tests.sh && chmod +x /home/node/.claude/hooks/enforce-tests.sh'`,
        { input: enforceTestsScript, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      console.debug(`[runners:docker] Wrote enforce-tests hook script to container`)
    } catch (error) {
      console.debug('[runners:docker] Failed to write Claude settings to container:', error)
    }
  } else {
    console.debug(`[runners:docker] Skipping Claude settings injection for ${executor} executor`)
  }

  return true
}

/**
 * Check if the pnpm store cache Docker volume exists.
 */
export function pnpmStoreCacheExists(): boolean {
  try {
    execSync(`docker volume inspect ${PNPM_STORE_CACHE_VOLUME}`, { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Build the pnpm store cache volume by running pnpm install in a temporary container.
 * The cache volume is populated with all workspace dependencies from pnpm-lock.yaml.
 * Subsequent agent containers mount this read-only for fast installs (PRLT-1130).
 */
export function buildPnpmStoreCache(agentDir: string, imageName: string): boolean {
  console.debug(`[runners:docker] Building pnpm store cache volume...`)

  const builderName = 'prlt-pnpm-cache-builder'

  // Remove any leftover builder container
  try {
    execSync(`docker rm -f ${builderName}`, { stdio: 'pipe', timeout: 10000 })
  } catch {
    // Ignore — container may not exist
  }

  try {
    // Run a temporary container to populate the cache.
    // Workspace is mounted read-only (only need lockfiles + package.json).
    // Cache volume is mounted writable so pnpm can write to the store.
    const installScript = [
      'pnpm config set store-dir /tmp/pnpm-store',
      'for dir in /workspace/*/; do',
      '  if [ -f "$dir/pnpm-lock.yaml" ]; then',
      '    echo "Caching deps from $dir..."',
      '    cd "$dir" && pnpm install --frozen-lockfile 2>&1 || pnpm install 2>&1',
      '  fi',
      'done',
      'echo "pnpm store cache built successfully"',
    ].join(' && ')

    const buildCmd = [
      'docker run --rm',
      `--name ${builderName}`,
      '--user node',
      `-v "${agentDir}:/workspace:ro"`,
      `-v "${PNPM_STORE_CACHE_VOLUME}:/tmp/pnpm-store"`,
      imageName,
      'bash', '-c',
      JSON.stringify(installScript),
    ].join(' ')

    console.debug(`[runners:docker] Running cache builder: ${buildCmd}`)
    execSync(buildCmd, { stdio: 'pipe', timeout: 600000 }) // 10 min timeout
    console.debug(`[runners:docker] pnpm store cache built successfully`)
    return true
  } catch (error) {
    console.debug(`[runners:docker] Failed to build pnpm store cache:`, error)
    // Don't remove the volume — partial data is still useful
    return false
  }
}

/**
 * Ensure the pnpm store cache volume exists and is populated.
 * If not, builds it from the agent's workspace lockfiles.
 * This is a no-op if the cache already exists (PRLT-1130).
 */
export function ensurePnpmStoreCache(agentDir: string, imageName: string): void {
  if (pnpmStoreCacheExists()) {
    console.debug(`[runners:docker] pnpm store cache volume exists, reusing`)
    return
  }
  console.debug(`[runners:docker] No pnpm store cache found, building...`)
  buildPnpmStoreCache(agentDir, imageName)
}

/**
 * Delete the pnpm store cache volume.
 * Returns true if the volume was removed (or didn't exist).
 */
export function removePnpmStoreCache(): boolean {
  try {
    execSync(`docker volume rm ${PNPM_STORE_CACHE_VOLUME}`, { stdio: 'pipe', timeout: 10000 })
    return true
  } catch {
    // Volume may not exist or may be in use
    return !pnpmStoreCacheExists()
  }
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

  // PRLT-1130: Ensure pnpm store cache is populated before creating the container.
  // This builds the cache volume on first spawn; subsequent spawns reuse it.
  ensurePnpmStoreCache(context.agentDir, imageName)

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
