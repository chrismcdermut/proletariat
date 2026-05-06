/**
 * Docker Container Management
 *
 * Functions for managing Docker containers, images, and setup.
 * Uses raw Docker commands instead of devcontainer CLI.
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  PermissionMode,
  ExecutorType,
  ExecutionContext,
  ExecutionConfig,
  RunnerResult,
} from '../types.js'
import { readDevcontainerJson } from '../devcontainer.js'
import { isClaudeExecutor, getExecutorCommand } from './executor.js'
import { CLAUDE_CREDENTIALS_VOLUME } from './docker-credentials.js'
import { getMachineId } from '../../telemetry/analytics.js'
import {
  getCCAppPermissionSettings,
} from '../cc-version.js'
import { buildPrompt } from './prompt-builder.js'
import { validateCodexMode } from '../codex-adapter.js'

/** Docker volume name for the shared pnpm store cache (PRLT-1130) */
export const PNPM_STORE_CACHE_VOLUME = 'pnpm-store-cache'

// =============================================================================
// Docker Daemon Status (TKT-081)
// =============================================================================

export type DockerDaemonStatus = {
  available: boolean
  reason: 'ready' | 'not-installed' | 'daemon-not-ready'
  message: string
}

export function checkDockerDaemon(): DockerDaemonStatus {
  try {
    execSync('which docker', { stdio: 'pipe', timeout: 3000 })
  } catch {
    return { available: false, reason: 'not-installed', message: 'Docker is not installed.' }
  }
  const timeout = 5000
  try {
    execSync('docker ps -q --no-trunc', { stdio: 'pipe', timeout })
    return { available: true, reason: 'ready', message: 'Docker daemon is ready.' }
  } catch (error: unknown) {
    const stderr = (error as { stderr?: Buffer })?.stderr?.toString() || ''
    const isTimeout = (error as { killed?: boolean })?.killed === true
    let message: string
    if (isTimeout) {
      message = 'Docker daemon is not responding (timed out after 5s). Docker Desktop may be initializing or stuck — check for license/login prompts.'
    } else if (stderr.includes('500') || stderr.includes('Internal Server Error')) {
      message = 'Docker daemon is returning errors (500). Docker Desktop needs attention — check for license/login prompts.'
    } else if (stderr.includes('connect') || stderr.includes('Cannot connect') || stderr.includes('Is the docker daemon running')) {
      message = 'Docker daemon is not running. Start Docker Desktop and try again.'
    } else {
      message = `Docker daemon is not ready: ${stderr.trim() || 'unknown error'}. Check Docker Desktop status.`
    }
    return { available: false, reason: 'daemon-not-ready', message }
  }
}

export function isDockerRunning(): boolean {
  return checkDockerDaemon().available
}

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
 * PRLT-1296: Get the host's installed Claude Code version.
 * Returns the semver version string (e.g., "2.1.89") or null if not available.
 * Used to pin the container's Claude Code version to match the host,
 * preventing credential format/handling mismatches between versions.
 */
export function getHostClaudeCodeVersion(): string | null {
  try {
    const output = execSync('claude --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    }).trim()
    // claude --version output: "claude <version>" or just "<version>"
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

/**
 * Error captured during a Docker spawn pipeline stage (PRLT-1322).
 * Surfaces stage name, message, and optional stderr so callers can report
 * meaningful errors instead of silently failing with a null return.
 */
export interface SpawnStageError {
  stage: 'docker-check' | 'image-build' | 'pnpm-cache' | 'container-create' | 'container-setup' | 'workspace-verify'
  message: string
  stderr?: string
}

export function buildDockerImage(
  agentDir: string,
  imageName: string,
  buildArgs: Record<string, string> = {},
  errorOut?: { error?: SpawnStageError }
): boolean {
  const dockerfilePath = path.join(agentDir, '.devcontainer', 'Dockerfile')
  if (!fs.existsSync(dockerfilePath)) {
    const msg = `Dockerfile not found at ${dockerfilePath}`
    console.debug(`[runners:docker] ${msg}`)
    if (errorOut) errorOut.error = { stage: 'image-build', message: msg }
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
    const err = error as NodeJS.ErrnoException & { stderr?: Buffer | string }
    const stderr = err.stderr ? (Buffer.isBuffer(err.stderr) ? err.stderr.toString() : err.stderr) : undefined
    const msg = err.message || 'docker build failed'
    console.debug(`[runners:docker] Failed to build image:`, error)
    if (errorOut) errorOut.error = { stage: 'image-build', message: msg, stderr }
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
  const homeDir = process.env.HOME || os.homedir()
  const hostClaudeDir = path.join(homeDir, '.claude')
  return [
    `-v "${context.agentDir}:/workspace:cached"`,
    ...(context.hqPath ? [`-v "${context.hqPath}/.proletariat:/hq/.proletariat:ro"`] : []),
    ...(context.pmoPath ? [`-v "${context.pmoPath}:/hq/pmo:cached"`] : []),
    ...(context.repoWorktrees || []).map(
      repoName => `-v "${context.hqPath}/repos/${repoName}:/hq/repos/${repoName}:cached"`
    ),
    // PRLT-1363: Bind-mount the host's live ~/.claude directory read-only.
    // The previous Docker volume (claude-credentials) was a stale snapshot —
    // tokens expire every ~24h but the volume was never refreshed automatically.
    // The host's Claude Code keeps tokens fresh, so mounting the live directory
    // ensures the container always has valid credentials.
    ...(isClaudeExecutor(executor) ? [`-v "${hostClaudeDir}:/home/node/.claude:ro"`] : []),
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
  prltInfo?: { registry: string; version: string },
  errorOut?: { error?: SpawnStageError }
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
    const err = error as NodeJS.ErrnoException & { stderr?: Buffer | string }
    const stderr = err.stderr ? (Buffer.isBuffer(err.stderr) ? err.stderr.toString() : err.stderr) : undefined
    const msg = err.message || 'docker run failed'
    console.debug(`[runners:docker] Failed to create container:`, error)
    if (errorOut) errorOut.error = { stage: 'container-create', message: msg, stderr }
    return false
  }
}

/**
 * PRLT-1322: Verify that the agent's workspace mount contains at least one
 * non-hidden entry beyond `.devcontainer`. Catches the "empty /workspace" bug
 * where worktree creation silently failed before container launch.
 *
 * Returns null on success, or a SpawnStageError describing the failure.
 */
export function verifyWorkspaceMount(containerId: string): SpawnStageError | null {
  try {
    const output = execSync(
      `docker exec ${containerId} ls -A /workspace`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
    )
    const entries = output.split('\n').map(e => e.trim()).filter(Boolean)
    // Accept any entry that isn't just `.devcontainer` — the bug was /workspace
    // containing ONLY the devcontainer config with no repo source.
    const meaningfulEntries = entries.filter(e => e !== '.devcontainer')
    if (meaningfulEntries.length === 0) {
      return {
        stage: 'workspace-verify',
        message:
          `Container /workspace is empty (only .devcontainer present). ` +
          `The repo worktree was not mounted. Entries: [${entries.join(', ') || '(none)'}]. ` +
          `This usually means git worktree creation failed silently on the host.`,
      }
    }
    return null
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: Buffer | string }
    const stderr = err.stderr ? (Buffer.isBuffer(err.stderr) ? err.stderr.toString() : err.stderr) : undefined
    return {
      stage: 'workspace-verify',
      message: `Failed to inspect /workspace in container ${containerId}: ${err.message || 'docker exec failed'}`,
      stderr,
    }
  }
}

/**
 * PRLT-1362 / PRLT-1363: Verify that a reused container has the host's ~/.claude
 * bind-mounted at /home/node/.claude. Containers created before this mount was
 * added (or with the old Docker volume approach) will lack it and need recreation.
 *
 * Accepts both bind-mounts (Type=bind) and the legacy Docker volume
 * (Name=claude-credentials) to avoid needless recreation during the transition.
 *
 * Returns true if the mount exists or the executor doesn't need it,
 * false if the mount is missing and the container should be recreated.
 */
export function verifyCredentialMount(containerId: string, executor: ExecutorType = 'claude-code'): boolean {
  if (!isClaudeExecutor(executor)) {
    return true
  }

  try {
    const inspectOutput = execSync(
      `docker inspect --format '{{json .Mounts}}' ${containerId}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
    )
    const mounts = JSON.parse(inspectOutput.trim()) as Array<{ Destination?: string; Name?: string; Type?: string }>
    return mounts.some(m =>
      m.Destination === '/home/node/.claude' ||
      m.Name === CLAUDE_CREDENTIALS_VOLUME
    )
  } catch {
    // If inspect fails, assume the mount is missing to be safe
    return false
  }
}

/**
 * PRLT-1322: Pre-seed Claude Code's onboarding config so the agent doesn't hit
 * theme-selection or other first-run dialogs inside the container.
 *
 * Writes `/home/node/.claude.json` with `hasCompletedOnboarding: true` and a
 * default dark theme. Claude Code may later rewrite this file on startup, but
 * because it reads the existing contents first it honors `hasCompletedOnboarding`
 * and skips the blocking prompts that ambushed ghost containers previously.
 *
 * The companion `/home/node/.claude/settings.json` (written by `runContainerSetup`)
 * is untouched — Claude does not clobber that file.
 */
export function seedClaudeOnboarding(containerId: string): boolean {
  const seed = {
    hasCompletedOnboarding: true,
    theme: 'dark',
    // Skip the "trust this workspace?" dialog for the auto-mounted /workspace.
    bypassPermissionsModeAccepted: true,
  }
  try {
    execSync(
      `docker exec -i ${containerId} bash -c 'cat > /home/node/.claude.json'`,
      { input: JSON.stringify(seed), stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
    )
    console.debug(`[runners:docker] Seeded /home/node/.claude.json to bypass Claude onboarding prompts`)
    return true
  } catch (error) {
    console.debug(`[runners:docker] Failed to seed Claude onboarding:`, error)
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
              command: 'prlt session report --agent "$PRLT_AGENT_NAME" --status exited 2>/dev/null || true',
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
              command: 'prlt session report --agent "$PRLT_AGENT_NAME" --status exited 2>/dev/null || true',
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
export function runContainerSetup(containerId: string, _permissionMode: PermissionMode = 'safe', executor: ExecutorType = 'claude-code'): boolean {
  try {
    execSync(`docker exec ${containerId} sudo /usr/local/bin/init-firewall.sh`, { stdio: 'pipe' })
    execSync(`docker exec ${containerId} /usr/local/bin/setup-prlt.sh`, { stdio: 'pipe' })
  } catch (error) {
    console.debug(`[runners:docker] Container setup scripts failed:`, error)
  }

  // NOTE: pnpm store-dir is now configured inside setup-prlt.sh (PRLT-1130)
  // to ensure it's set BEFORE pnpm install runs during workspace setup.

  // PRLT-1322: Pre-seed /home/node/.claude.json BEFORE claude starts so it
  // skips the theme selection and trust dialogs. PRLT-1240 noted that Claude
  // rewrites this file on startup, but because it reads existing contents
  // first, `hasCompletedOnboarding: true` is honored and blocking prompts are
  // suppressed. If this file is absent, Claude treats the container as a
  // first-run user and stops at the theme picker.
  if (isClaudeExecutor(executor)) {
    seedClaudeOnboarding(containerId)
  }

  // PRLT-1363: Host ~/.claude is now bind-mounted read-only at /home/node/.claude
  // so we write agent-specific settings and hooks to the project-level path
  // (/workspace/.claude/) which sits on the writable workspace mount. Claude Code
  // reads settings from both user-level (~/.claude/) and project-level, so the
  // agent gets host credentials (read-only) plus agent-specific hooks (writable).
  if (isClaudeExecutor(executor)) {
    try {
      // Write app settings + lifecycle hooks to project-level settings.json
      const appPermSettings = getCCAppPermissionSettings()
      const lifecycleHooks = buildClaudeLifecycleHooks()
      const mergedSettings = { ...appPermSettings, ...lifecycleHooks }
      execSync(
        `docker exec -i ${containerId} bash -c 'mkdir -p /workspace/.claude && cat > /workspace/.claude/settings.json'`,
        { input: JSON.stringify(mergedSettings), stdio: ['pipe', 'pipe', 'pipe'] }
      )
      console.debug(`[runners:docker] Wrote /workspace/.claude/settings.json with agent hooks`)

      // PRLT-1225: Write the enforce-tests hook script into the container
      const enforceTestsScript = buildEnforceTestsHookScript()
      execSync(
        `docker exec -i ${containerId} bash -c 'mkdir -p /workspace/.claude/hooks && cat > /workspace/.claude/hooks/enforce-tests.sh && chmod +x /workspace/.claude/hooks/enforce-tests.sh'`,
        { input: enforceTestsScript, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      console.debug(`[runners:docker] Wrote enforce-tests hook script to /workspace/.claude/hooks/`)
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
 * Detailed result of `ensureDockerContainerDetailed`.
 * PRLT-1322: surfaces the exact pipeline stage that failed so callers can
 * report "image-build failed" or "workspace-verify failed" instead of a
 * generic null.
 */
export interface EnsureDockerContainerResult {
  containerId: string | null
  error?: SpawnStageError
}

/**
 * Ensure a Docker container is running for the agent, returning detailed
 * pipeline stage information on failure (PRLT-1322).
 *
 * Reuses running containers to preserve in-progress work (TKT-1028).
 */
export function ensureDockerContainerDetailed(
  context: ExecutionContext,
  config: ExecutionConfig,
  executor: ExecutorType = 'claude-code'
): EnsureDockerContainerResult {
  const containerName = getContainerName(context.agentName)
  const imageName = getImageName(context.agentName)

  if (containerExists(containerName)) {
    if (isContainerRunning(containerName)) {
      const containerId = getContainerId(containerName)
      if (containerId) {
        // PRLT-1362: Verify credential mount exists before reusing.
        // Containers created before the mount was added lack /home/node/.claude
        // and Claude Code will prompt for login. Force recreation.
        if (!verifyCredentialMount(containerId, executor)) {
          console.debug(`[runners:docker] Reused container ${containerName} is missing credential mount, recreating`)
          try {
            execSync(`docker rm -f ${containerName}`, { stdio: 'pipe', timeout: 10000 })
          } catch {
            // Ignore removal errors
          }
          // Fall through to create a new container below
        } else {
          console.debug(`[runners:docker] Reusing running container ${containerName} (${containerId}), skipping setup`)
          // PRLT-1322: Even for reused containers, verify /workspace is populated.
          // A container may be running with an empty mount if the previous spawn
          // attempt leaked it. Bail out with a clear error rather than silently
          // handing the agent an empty workspace.
          const mountError = verifyWorkspaceMount(containerId)
          if (mountError) {
            return { containerId: null, error: mountError }
          }
          return { containerId }
        }
      }
    } else {
      console.debug(`[runners:docker] Removing stopped container ${containerName} to create fresh one`)
      try {
        execSync(`docker rm -f ${containerName}`, { stdio: 'pipe', timeout: 10000 })
      } catch {
        // Ignore removal errors
      }
    }
  }

  const devcontainerJson = readDevcontainerJson(context.agentDir)
  const buildArgs: Record<string, string> = {
    TZ: devcontainerJson?.build?.args?.TZ || 'America/Los_Angeles',
    PRLT_REGISTRY: devcontainerJson?.build?.args?.PRLT_REGISTRY || 'npm',
  }

  // PRLT-1296: Pin Claude Code version to match host.
  // Priority: devcontainer config pin > host version detection > latest (fallback).
  // This prevents credential format/handling mismatches between container and host.
  const ccVersionFromConfig = devcontainerJson?.build?.args?.CC_VERSION
  if (ccVersionFromConfig) {
    buildArgs.CC_VERSION = ccVersionFromConfig
    console.debug(`[runners:docker] Using CC version from devcontainer config: ${ccVersionFromConfig}`)
  } else {
    const hostCCVersion = getHostClaudeCodeVersion()
    if (hostCCVersion) {
      buildArgs.CC_VERSION = hostCCVersion
      console.debug(`[runners:docker] Pinning CC version to host: ${hostCCVersion}`)
    } else {
      console.debug(`[runners:docker] Could not detect host CC version, container will use latest`)
    }
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
  const buildErrorOut: { error?: SpawnStageError } = {}
  if (!buildDockerImage(context.agentDir, imageName, buildArgs, buildErrorOut)) {
    if (!imageExists(imageName)) {
      return {
        containerId: null,
        error: buildErrorOut.error || {
          stage: 'image-build',
          message: `docker build failed for ${imageName} and no cached image is available`,
        },
      }
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
  const createErrorOut: { error?: SpawnStageError } = {}
  if (!createDockerContainer(context, containerName, imageName, config, executor, prltInfo, createErrorOut)) {
    // PRLT-1322: Clean up the image if container create failed so a retry
    // doesn't leave an orphan `prlt-agent-*:latest` image lying around.
    return {
      containerId: null,
      error: createErrorOut.error || {
        stage: 'container-create',
        message: `docker run failed for ${containerName}`,
      },
    }
  }

  const containerId = getContainerId(containerName)
  if (!containerId) {
    return {
      containerId: null,
      error: {
        stage: 'container-create',
        message: `Container ${containerName} was created but its ID could not be read`,
      },
    }
  }

  console.debug(`[runners:docker] Running container setup (permissionMode=${config.permissionMode}, executor=${executor})`)
  if (!runContainerSetup(containerId, config.permissionMode, executor)) {
    console.debug(`[runners:docker] Setup failed, but continuing...`)
  }

  // PRLT-1322: Verify /workspace is populated before handing the container
  // back. Catches the "only .devcontainer" bug at the last possible moment.
  const mountError = verifyWorkspaceMount(containerId)
  if (mountError) {
    // Stop the container so watchers don't list it as "running ready for work"
    // and so the caller's cleanup sweep can remove the stopped container.
    try {
      execSync(`docker stop ${containerId}`, { stdio: 'pipe', timeout: 15000 })
    } catch {
      // Best-effort stop; image/container cleanup happens at caller level.
    }
    return { containerId: null, error: mountError }
  }

  return { containerId }
}

/**
 * Backward-compatible wrapper that returns just the container ID.
 * PRLT-1322: New code should prefer `ensureDockerContainerDetailed` so the
 * caller can surface the failing pipeline stage to the user.
 */
export function ensureDockerContainer(
  context: ExecutionContext,
  config: ExecutionConfig,
  executor: ExecutorType = 'claude-code'
): string | null {
  const result = ensureDockerContainerDetailed(context, config, executor)
  if (!result.containerId && result.error) {
    console.error(
      `[runners:docker] Spawn pipeline failed at stage "${result.error.stage}": ${result.error.message}` +
      (result.error.stderr ? `\n  stderr: ${result.error.stderr.trim()}` : '')
    )
  }
  return result.containerId
}

// =============================================================================
// Simple detached Docker runner (PRLT-1365)
//
// Runs a one-shot prompt in a detached `docker run -d` container. Unlike the
// devcontainer pipeline (image build + entrypoint + tmux), this path is for
// the 'docker' execution environment — a fire-and-forget container that
// executes the prompt and exits. Both paths share buildContainerMounts() as
// the single source of truth for volume mounts.
// =============================================================================

export async function runDocker(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig
): Promise<RunnerResult> {
  const prompt = buildPrompt(context)
  const containerName = `work-${context.ticketId}-${Date.now()}`

  try {
    const dockerStatus = checkDockerDaemon()
    if (!dockerStatus.available) {
      return {
        success: false,
        error: `Docker daemon is not available. ${dockerStatus.message}`,
      }
    }

    const mounts = buildContainerMounts(context, executor)

    let dockerCmd = `docker run -d --name ${containerName}`
    dockerCmd += ` ${mounts.join(' ')}`
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

    // HEALTHCHECK for heartbeat-based stale detection. Session watcher reads
    // this status via `docker inspect`.
    dockerCmd += ` --health-cmd "kill -0 1 || exit 1"`
    dockerCmd += ` --health-interval 5m`
    dockerCmd += ` --health-timeout 10s`
    dockerCmd += ` --health-retries 3`
    dockerCmd += ` --health-start-period 30s`

    if (executor === 'codex') {
      const codexPermission: PermissionMode = config.permissionMode
      const modeError = validateCodexMode(codexPermission, 'non-tty')
      if (modeError) {
        return { success: false, error: modeError.message }
      }
    }

    const escapedPrompt = prompt.replace(/'/g, "'\\''")
    const { cmd, args } = getExecutorCommand(executor, escapedPrompt, config.permissionMode === 'danger')

    dockerCmd += ` ${config.docker.image}`
    if (isClaudeExecutor(executor)) {
      // TKT-053: Disable plan mode — detached, no user to approve.
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
