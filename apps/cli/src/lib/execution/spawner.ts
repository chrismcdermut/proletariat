/**
 * Agent Spawner
 *
 * Shared logic for spawning agent executions.
 * Used by `work start`, `work spawn`, and `work watch` commands.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import type Database from 'better-sqlite3'
import { SQLiteStorage } from '../pmo/storage-sqlite.js'
import { autoExportToBoard } from '../pmo/index.js'
import { getWorkColumnSetting, findColumnByName } from '../work-lifecycle/settings.js'
import { resolveExternalTicketId } from '../external-issues/utils.js'
import { WorkspaceInfo, resolveAgentDir } from '../agents/commands.js'
import { findHQRoot } from '../repos/index.js'
import { hasGitHubRemote } from '../repos/git.js'
import { pruneWorktrees, checkoutBranchSafe } from '../branch/index.js'
import { ExecutionStorage } from './storage.js'
import { hasDevcontainerConfig } from './devcontainer.js'
import { loadExecutionConfig, getCleanupPolicy } from './config.js'
import { runExecution, isDockerRunning, checkDockerDaemon, isGitHubTokenAvailable, isDevcontainerCliInstalled, runExecutorPreflight, getAgentContainerName, isContainerRunning, getContainerId, buildSessionName, isSrtInstalled, checkDockerMemoryCapacity } from './runners.js'
import { detectRepoWorktrees, resolveWorktreePath } from './context.js'
import { ExternalExecutionMappingStore } from '../external-issues/mapping-store.js'
import { resolveTicketProvider } from '../providers/resolver.js'
import { type ExternalMappingProvider } from '../external-issues/types.js'
import { copyMediaToAgentWorkspace } from '../media/index.js'
import {
  DisplayMode,
  SessionManager,
  ExecutorType,
  ExecutionContext,
  ExecutionEnvironment,
  ExecutionConfig,
  PermissionMode,
  CleanupPolicy,
  OutputMode,
  generateBranchName,
  DEFAULT_EXECUTION_CONFIG,
  normalizeEnvironment,
} from './types.js'
import { Ticket } from '../pmo/types.js'

// =============================================================================
// Git Utilities
// =============================================================================

/**
 * Try to execute a git command, return true if successful
 */
function tryGitCommand(cmd: string, cwd: string): boolean {
  try {
    execSync(cmd, { cwd, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Check if any of the given repos have a GitHub remote
 */
function checkReposForRemote(repoPaths: string[]): { hasRemote: boolean; reposWithoutRemote: string[] } {
  const reposWithoutRemote: string[] = []

  for (const repoPath of repoPaths) {
    if (isGitRepo(repoPath) && !hasGitHubRemote(repoPath)) {
      reposWithoutRemote.push(repoPath)
    }
  }

  return {
    hasRemote: reposWithoutRemote.length === 0,
    reposWithoutRemote,
  }
}

/**
 * Check if a directory is a git repository
 */
function isGitRepo(dir: string): boolean {
  return tryGitCommand('git rev-parse --git-dir', dir)
}

/**
 * Find the first existing branch from a list of candidates
 */
function findBaseBranch(repoPath: string, candidates: string[] = ['origin/main', 'origin/master']): string {
  for (const branch of candidates) {
    if (tryGitCommand(`git rev-parse --verify ${branch}`, repoPath)) {
      return branch
    }
  }
  return 'HEAD'
}

/**
 * Try to execute a docker exec git command, return true if successful
 */
function tryDockerGitCommand(containerId: string, containerRepoPath: string, gitArgs: string): boolean {
  try {
    execSync(`docker exec ${containerId} git -C "${containerRepoPath}" ${gitArgs}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Check if a path is a git repo inside a container
 */
function isGitRepoInContainer(containerId: string, containerRepoPath: string): boolean {
  return tryDockerGitCommand(containerId, containerRepoPath, 'rev-parse --git-dir')
}

/**
 * Find the base branch inside a container
 */
function findBaseBranchInContainer(
  containerId: string,
  containerRepoPath: string,
  candidates: string[] = ['origin/main', 'origin/master']
): string {
  for (const branch of candidates) {
    if (tryDockerGitCommand(containerId, containerRepoPath, `rev-parse --verify ${branch}`)) {
      return branch
    }
  }
  return 'HEAD'
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Delay between container spawns to prevent Docker kernel panics (TKT-801).
 * When spawning multiple agents simultaneously, Docker Desktop on Apple Silicon
 * can hit kernel panics in grpcfuse (file sharing layer) due to spinlock
 * contention when all agents mount the same shared volumes concurrently.
 */
const SPAWN_STAGGER_DELAY_MS = 2000

const EXTERNAL_MAPPING_PROVIDERS: ReadonlySet<string> = new Set(['linear', 'jira', 'asana', 'monday', 'pmo'])

function getExternalProvider(value: string | undefined): ExternalMappingProvider | null {
  if (!value) return null
  return EXTERNAL_MAPPING_PROVIDERS.has(value) ? (value as ExternalMappingProvider) : null
}

// =============================================================================
// Types
// =============================================================================

export type AgentStrategy = 'round-robin' | 'least-busy' | 'random'

export interface SpawnOptions {
  /** Environment to run in */
  environment?: ExecutionEnvironment
  /** Display mode for output */
  displayMode?: DisplayMode
  /** Session manager for container environments (tmux runs inside container) */
  sessionManager?: SessionManager
  /** Executor to use */
  executor?: ExecutorType
  /** Skip permission prompts (danger mode) */
  skipPermissions?: boolean
  /** Explicitly allow running on host (bypasses sandbox) */
  runOnHost?: boolean
  /** Create PR when work is ready */
  createPR?: boolean
  /** Execution config (terminal app, shell, etc.) */
  executionConfig?: ExecutionConfig
  /** Logging callback */
  log?: (msg: string) => void
  /** Skip GitHub remote check */
  skipRemoteCheck?: boolean
  /** Tool policy profile name for per-agent access control (TKT-083) */
  toolPolicy?: string
  /** Container cleanup policy override (PRLT-1061) */
  cleanupPolicy?: CleanupPolicy
  /** Extra domains to allow in container firewall (PRLT-1079) */
  networkAllowlist?: string[]
}

export interface SpawnResult {
  success: boolean
  executionId?: string
  ticketId?: string
  agentName?: string
  error?: string
}

export interface BatchSpawnResult {
  spawned: SpawnResult[]
  skipped: Array<{ ticketId: string; reason: string }>
  failed: SpawnResult[]
}

interface AgentWithExecutionCount {
  name: string
  runningCount: number
  totalCount: number
}

// =============================================================================
// Agent Selection
// =============================================================================

/**
 * Get all agents with their execution counts.
 */
export function getAgentsWithCounts(
  workspaceInfo: WorkspaceInfo,
  executionStorage: ExecutionStorage
): AgentWithExecutionCount[] {
  return workspaceInfo.agents.map(agent => {
    const running = executionStorage.getAgentRunningExecutions(agent.name)
    const total = executionStorage.getAgentExecutionCount(agent.name)
    return {
      name: agent.name,
      runningCount: running.length,
      totalCount: total,
    }
  })
}

/**
 * Get staff agents that are not currently running any executions.
 * Only considers persistent (staff) agents with status='active'.
 * Cleans up stale executions before checking availability (TKT-604).
 */
export function getAvailableAgents(
  workspaceInfo: WorkspaceInfo,
  executionStorage: ExecutionStorage
): string[] {
  // Clean up stale executions first (TKT-604)
  executionStorage.cleanupStaleExecutions()

  // Filter for active staff agents only (not ephemeral agents)
  return workspaceInfo.agents
    .filter(agent =>
      agent.type === 'persistent' &&
      agent.status === 'active' &&
      executionStorage.isAgentAvailable(agent.name)
    )
    .map(agent => agent.name)
}

/**
 * Select an agent using the specified strategy.
 */
export function selectAgent(
  strategy: AgentStrategy,
  availableAgents: string[],
  executionStorage: ExecutionStorage,
  roundRobinState?: { lastIndex: number }
): string | null {
  if (availableAgents.length === 0) {
    return null
  }

  switch (strategy) {
    case 'round-robin': {
      // Use round-robin state if provided, otherwise start from 0
      const lastIndex = roundRobinState?.lastIndex ?? -1
      const nextIndex = (lastIndex + 1) % availableAgents.length
      if (roundRobinState) {
        roundRobinState.lastIndex = nextIndex
      }
      return availableAgents[nextIndex]
    }

    case 'least-busy': {
      // Select agent with fewest total executions (historical)
      let minCount = Infinity
      let selected = availableAgents[0]

      for (const agentName of availableAgents) {
        const count = executionStorage.getAgentExecutionCount(agentName)
        if (count < minCount) {
          minCount = count
          selected = agentName
        }
      }
      return selected
    }

    case 'random': {
      const randomIndex = Math.floor(Math.random() * availableAgents.length)
      return availableAgents[randomIndex]
    }

    default:
      return availableAgents[0]
  }
}

// =============================================================================
// Spawning
// =============================================================================

/**
 * Spawn an agent to work on a ticket.
 * This is the core spawning logic extracted from `work start`.
 */
export async function spawnAgentForTicket(
  ticket: Ticket,
  agentName: string,
  storage: SQLiteStorage,
  executionStorage: ExecutionStorage,
  workspaceInfo: WorkspaceInfo,
  db: Database.Database,
  pmoPath: string,
  options: SpawnOptions = {}
): Promise<SpawnResult> {
  const log = options.log || (() => {})
  const executor = options.executor || DEFAULT_EXECUTION_CONFIG.defaultExecutor

  // Determine agent directory and worktree path (handles staff and temp agents)
  const agentDir = resolveAgentDir(workspaceInfo, agentName)
  if (!fs.existsSync(agentDir)) {
    return {
      success: false,
      ticketId: ticket.id,
      agentName,
      error: `Agent directory not found at ${agentDir}`,
    }
  }

  // Detect repository worktrees within agent directory
  const repoWorktrees = detectRepoWorktrees(agentDir)
  const worktreePath = resolveWorktreePath(agentDir, repoWorktrees)

  // Generate branch name — prefer external provider key (e.g. PRLT-1065) over internal TKT ID
  const branchTicketId = resolveExternalTicketId(ticket)
  const branch = generateBranchName(
    branchTicketId,
    ticket.title,
    ticket.category
  )

  // Get epic info if linked
  let epicTitle: string | undefined
  if (ticket.epicId) {
    const epic = await storage.getEpic(ticket.epicId)
    epicTitle = epic?.title
  }

  // Build execution context
  // Find proper HQ root (don't assume PMO is at {hq}/pmo - it could be at {hq}/repos/myrepo/pmo)
  const hqPath = findHQRoot() || path.dirname(pmoPath)
  const externalTicketId = resolveExternalTicketId(ticket)
  const context: ExecutionContext = {
    ticketId: ticket.id,
    externalTicketId: externalTicketId !== ticket.id ? externalTicketId : undefined,
    ticketTitle: ticket.title,
    ticketDescription: ticket.description,
    ticketSubtasks: ticket.subtasks?.map(s => ({ title: s.title, done: s.done })),
    ticketPriority: ticket.priority,
    ticketCategory: ticket.category,
    epicTitle,
    agentName,
    agentDir,
    worktreePath,
    branch,
    hqPath,
    pmoPath,
    repoWorktrees,
    createPR: options.createPR ?? false,
    toolPolicy: options.toolPolicy,
    networkAllowlist: options.networkAllowlist,
  }

  // Determine execution environment and display mode
  const hasDevcontainer = hasDevcontainerConfig(agentDir)
  const dockerStatus = checkDockerDaemon()

  // TKT-081: When Docker daemon is unresponsive (installed but not ready),
  // fall back to host execution with a warning instead of hanging or hard-failing.
  let environment: ExecutionEnvironment
  if (options.environment) {
    // Normalize 'vm' -> 'cloud' for backwards compatibility
    environment = normalizeEnvironment(options.environment)
  } else if (hasDevcontainer && dockerStatus.available) {
    environment = 'devcontainer'
  } else if (hasDevcontainer && !dockerStatus.available) {
    if (dockerStatus.reason === 'not-installed') {
      // Docker not installed — require explicit opt-in to host (TKT-046 security check)
      if (options.runOnHost) {
        // User explicitly opted to run on host — use sandbox if srt available
        environment = isSrtInstalled() ? 'sandbox' : 'host'
        if (environment === 'host') {
          log('⚠️  Running on host (--run-on-host flag set). Agent has full host access.')
        } else {
          log('🔒 Running in sandbox (srt). Filesystem + network isolation active.')
        }
      } else {
        return {
          success: false,
          ticketId: ticket.id,
          agentName,
          error: 'Docker is not installed but devcontainer is configured.\n\n' +
            'For security, agents should run in Docker containers.\n' +
            'Options:\n' +
            '  1. Install Docker Desktop and try again\n' +
            '  2. Use --run-on-host flag to run directly on your machine (bypasses container)\n' +
            '  3. Install srt for lightweight sandbox: https://github.com/anthropic-experimental/sandbox-runtime',
        }
      }
    } else {
      // TKT-081: Docker is installed but daemon is not ready (unresponsive, 500 errors,
      // stuck on license/login prompt, still initializing). Fall back to sandbox/host with a warning.
      environment = isSrtInstalled() ? 'sandbox' : 'host'
      log(`⚠️  Docker daemon not ready, falling back to ${environment}. ${dockerStatus.message}`)
    }
  } else {
    // No devcontainer configured — use sandbox if srt available, else host
    environment = isSrtInstalled() ? 'sandbox' : 'host'
  }

  // Set the execution environment on the context so prompt builders can include
  // environment-specific guidance (TKT-035: Docker vs prlt CLI confusion)
  context.executionEnvironment = environment

  const displayMode: DisplayMode = options.displayMode || 'terminal'
  const permissionMode: PermissionMode = (options.skipPermissions ?? false) ? 'danger' : 'safe'

  // Executor preflight check (TKT-1082): verify binary is available before proceeding
  // For host/sandbox environments, check immediately. For devcontainer, check happens after container start.
  if (environment === 'host' || environment === 'sandbox') {
    const preflight = runExecutorPreflight(environment, executor)
    if (!preflight.ok) {
      return {
        success: false,
        ticketId: ticket.id,
        agentName,
        error: preflight.error,
      }
    }
  }

  // Create branch in worktree(s)
  // For devcontainer environments, run git commands inside the container
  // because the worktree .git file has container paths, not host paths
  const gitRepos = repoWorktrees.length > 0
    ? repoWorktrees.map(r => path.join(agentDir, r))
    : [worktreePath]

  // Check for GitHub remote if PR creation is enabled
  if (!options.skipRemoteCheck) {
    const remoteCheck = checkReposForRemote(gitRepos)
    if (!remoteCheck.hasRemote) {
      const repoNames = remoteCheck.reposWithoutRemote.map(r => path.basename(r)).join(', ')
      if (options.createPR) {
        // If PR creation is requested, we must have a remote
        return {
          success: false,
          ticketId: ticket.id,
          agentName,
          error: `No GitHub remote found for: ${repoNames}\n\n` +
            'Cannot create PRs without a GitHub remote.\n' +
            'Options:\n' +
            '  1. Run "prlt repo create" to create a GitHub repo and set up remote\n' +
            '  2. Manually add a remote: git remote add origin <url>\n' +
            '  3. Use --skip-remote-check to spawn without PR support',
        }
      } else {
        // Just warn if not creating PRs
        log(`⚠️  No GitHub remote found for: ${repoNames}. PRs cannot be created.`)
        log('   Run "prlt repo create" to set up a GitHub remote.')
      }
    }
  }

  // Always fetch latest from origin before branch operations
  // This ensures all spawn actions work with the latest code
  for (const repoPath of gitRepos) {
    if (isGitRepo(repoPath)) {
      tryGitCommand('git fetch origin', repoPath)
    }
  }

  if (environment === 'devcontainer') {
    // Get container ID for this agent
    let containerId: string | null = null
    try {
      containerId = execSync(
        `docker ps -q --filter "label=devcontainer.local_folder=${agentDir}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim() || null
    } catch {
      // Container not running
    }

    if (containerId) {
      // Run git commands inside the container
      for (const repoPath of gitRepos) {
        const repoName = path.basename(repoPath)
        // Map host path to container path: /workspace/{repoName}
        const containerRepoPath = `/workspace/${repoName}`

        // Skip if not a git repo
        if (!isGitRepoInContainer(containerId, containerRepoPath)) {
          continue
        }

        // Prune stale worktree references inside container
        tryDockerGitCommand(containerId, containerRepoPath, 'worktree prune')

        try {
          // Fetch latest from origin inside container (may fail if offline)
          tryDockerGitCommand(containerId, containerRepoPath, 'fetch origin')

          // Find base branch (origin/main or origin/master)
          const baseBranch = findBaseBranchInContainer(containerId, containerRepoPath)

          // Check if branch exists and checkout, or create new branch
          const branchAlreadyExists = tryDockerGitCommand(containerId, containerRepoPath, `rev-parse --verify ${branch}`)
          if (branchAlreadyExists) {
            execSync(`docker exec ${containerId} git -C "${containerRepoPath}" checkout ${branch}`, { stdio: 'pipe' })
          } else {
            execSync(`docker exec ${containerId} git -C "${containerRepoPath}" checkout -b ${branch} ${baseBranch}`, { stdio: 'pipe' })
          }
          log(`Created branch ${branch} in ${repoName} from ${baseBranch} (inside container)`)
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          // Check for worktree conflict
          if (errorMsg.includes('is already checked out at') || errorMsg.includes('is already used by worktree')) {
            return {
              success: false,
              ticketId: ticket.id,
              agentName,
              error: `Branch "${branch}" is already checked out in another worktree in ${repoName}. ` +
                'The other worktree must be removed first, or use a different agent.',
            }
          }
          return {
            success: false,
            ticketId: ticket.id,
            agentName,
            error: `Could not create branch in ${repoName}: ${errorMsg}`,
          }
        }
      }
    } else {
      log('Container not running, will create branch when container starts')
    }
  } else {
    // Host environment - run git commands directly
    for (const repoPath of gitRepos) {
      // Skip if not a git repo
      if (!isGitRepo(repoPath)) {
        continue
      }

      // Prune stale worktree references before branch operations
      pruneWorktrees(repoPath)

      // Find base branch (origin/main or origin/master)
      const baseBranch = findBaseBranch(repoPath)

      // Checkout or create branch with worktree conflict handling
      const checkoutError = checkoutBranchSafe(branch, baseBranch, repoPath)
      if (checkoutError) {
        return {
          success: false,
          ticketId: ticket.id,
          agentName,
          error: `Branch conflict in ${path.basename(repoPath)}: ${checkoutError}`,
        }
      }
    }
  }

  // TKT-077: Copy preprocessed media assets into agent workspace
  // Copies frames/, transcript.md, manifest.json (not raw source video)
  try {
    copyMediaToAgentWorkspace(hqPath, agentDir)
  } catch {
    // Non-fatal: media copy failure shouldn't block agent spawn
    log('Warning: Could not copy media assets to agent workspace')
  }

  // TKT-1028: Clean up orphaned execution records before creating a new one.
  // If the agent's container doesn't exist or isn't running, any "running"/"starting"
  // execution records for this agent are orphans — their container was destroyed
  // or crashed. Mark them as "stopped" to prevent downstream issues like
  // `prlt docker logs` failing with "multiple running containers".
  // Also clean up stale records when the container IS running but the execution's
  // containerId doesn't match the current container (e.g., container was recreated).
  if (environment === 'devcontainer') {
    const containerName = getAgentContainerName(agentName)
    const containerRunning = isContainerRunning(containerName)
    const staleExecutions = executionStorage.getAgentRunningExecutions(agentName)

    if (!containerRunning) {
      // Container not running — all "running" executions are orphans
      for (const staleExec of staleExecutions) {
        log(`Marking orphaned execution ${staleExec.id} as stopped (container not running)`)
        executionStorage.updateStatus(staleExec.id, 'stopped')
      }
    } else if (staleExecutions.length > 0) {
      // Container IS running — check for specific orphan scenarios:
      // 1. containerId mismatch (container was recreated since execution started)
      // 2. Same session name as incoming spawn (tmux session will be replaced)
      // 3. Dead tmux sessions (crashed or killed externally)
      const currentContainerId = getContainerId(containerName)
      const incomingSessionName = buildSessionName(context)

      for (const staleExec of staleExecutions) {
        if (staleExec.containerId && currentContainerId && staleExec.containerId !== currentContainerId) {
          log(`Marking orphaned execution ${staleExec.id} as stopped (containerId mismatch)`)
          executionStorage.updateStatus(staleExec.id, 'stopped')
        } else if (staleExec.sessionId === incomingSessionName) {
          // Same session name — will be killed when the new tmux session is created
          log(`Marking execution ${staleExec.id} as stopped (session will be replaced)`)
          executionStorage.updateStatus(staleExec.id, 'stopped')
        } else if (staleExec.sessionId && currentContainerId) {
          // Different session — verify it still exists in the container
          try {
            execSync(`docker exec ${currentContainerId} tmux has-session -t "${staleExec.sessionId}"`, { stdio: 'pipe' })
          } catch {
            log(`Marking orphaned execution ${staleExec.id} as stopped (tmux session gone)`)
            executionStorage.updateStatus(staleExec.id, 'stopped')
          }
        }
      }
    }
  }

  // Resolve cleanup policy: explicit override > action-specific > workspace default (PRLT-1061)
  const cleanupPolicy = options.cleanupPolicy || getCleanupPolicy(db, context.actionId)

  // Create execution record
  const execution = executionStorage.createExecution({
    ticketId: ticket.id,
    agentName,
    executor,
    environment,
    displayMode,
    permissionMode,
    cleanupPolicy,
    branch,
  })

  // Load execution config (use passed config or load from db)
  const executionConfig = options.executionConfig || loadExecutionConfig(db)
  executionConfig.permissionMode = permissionMode

  // PRLT-1099: Check Docker memory capacity before spawning devcontainer
  if (environment === 'devcontainer') {
    const memCheck = checkDockerMemoryCapacity(executionConfig.devcontainer.memory)
    if (!memCheck.ok && memCheck.warning) {
      log(`⚠️  ${memCheck.warning}`)
    }
  }

  // Run execution
  // Default to tmux for session persistence (enables peek/poke/attach)
  const sessionManager = options.sessionManager || 'tmux'

  // Determine output mode (PRLT-1119):
  // Background → print mode (-p) so Claude doesn't hang without TTY interaction.
  // Terminal/foreground → interactive mode for streaming TUI.
  executionConfig.outputMode = resolveOutputMode(displayMode)
  const result = await runExecution(environment, context, executor, executionConfig, {
    displayMode,
    sessionManager: environment === 'devcontainer' ? sessionManager : undefined,
  })

  if (result.success) {
    executionStorage.updateStatus(execution.id, 'running')
    executionStorage.updateProcessInfo(execution.id, {
      pid: result.pid,
      containerId: result.containerId,
      sessionId: result.sessionId,
      logPath: result.logPath,
    })

    // Only update ticket status and move to In Progress after successful spawn
    await storage.updateTicket(ticket.id, {
      status: 'in_progress',
      assignee: agentName,
    })

    const targetColumnName = getWorkColumnSetting(db, 'in_progress')
    const board = await storage.getBoard(ticket.projectId!)
    const columnNames = board.columns.map(col => col.name)
    const inProgressColumn = findColumnByName(columnNames, targetColumnName)

    if (inProgressColumn && ticket.statusName !== inProgressColumn) {
      await storage.moveTicket(ticket.projectId!, ticket.id, inProgressColumn)

      // Sync to external provider (e.g., Linear) if ticket was imported from one
      try {
        const provider = resolveTicketProvider(ticket.id, ticket.projectId!, db, storage, ticket.metadata)
        if (provider.name !== 'pmo') {
          await provider.moveTicket(ticket.id, inProgressColumn)
        }
      } catch {
        // Non-fatal — don't block spawn for provider sync failures
      }
    }

    await autoExportToBoard(pmoPath, storage, log)

    const externalProvider = getExternalProvider(ticket.metadata?.external_source)
    const externalId = ticket.metadata?.external_id
    if (externalProvider && externalId) {
      const mappingStore = new ExternalExecutionMappingStore(db)
      mappingStore.upsertMapping({
        provider: externalProvider,
        externalId,
        externalKey: ticket.metadata?.external_key ?? null,
        canonicalUrl: ticket.metadata?.external_url ?? null,
        latestStateSnapshot: {
          ticketId: ticket.id,
          ticketStatus: ticket.statusName ?? null,
          ticketCategory: ticket.statusCategory ?? null,
          teamKey: ticket.metadata?.external_project ?? null,
        },
        executionId: execution.id,
        lastSpawnedAt: new Date(),
      })
    }

    return {
      success: true,
      executionId: execution.id,
      ticketId: ticket.id,
      agentName,
    }
  } else {
    executionStorage.updateStatus(execution.id, 'failed', undefined, result.error)
    return {
      success: false,
      executionId: execution.id,
      ticketId: ticket.id,
      agentName,
      error: result.error,
    }
  }
}

/**
 * Spawn agents for all tickets in a column.
 */
export async function spawnForColumn(
  projectId: string,
  columnName: string,
  storage: SQLiteStorage,
  executionStorage: ExecutionStorage,
  workspaceInfo: WorkspaceInfo,
  db: Database.Database,
  pmoPath: string,
  options: {
    strategy?: AgentStrategy
    specificAgent?: string
    limit?: number
    dryRun?: boolean
    ticketIds?: string[]  // Optional: only spawn these specific ticket IDs
    log?: (msg: string) => void
  } & SpawnOptions = {}
): Promise<BatchSpawnResult> {
  const log = options.log || (() => {})
  const strategy = options.strategy || 'round-robin'
  const limit = options.limit || Infinity

  const result: BatchSpawnResult = {
    spawned: [],
    skipped: [],
    failed: [],
  }

  // Get tickets in the specified column
  let allTickets = await storage.listTickets(projectId, { column: columnName })

  // If specific ticket IDs provided, filter to only those tickets
  if (options.ticketIds && options.ticketIds.length > 0) {
    allTickets = allTickets.filter(t => options.ticketIds!.includes(t.id))

    // Check if any requested tickets weren't found
    const foundIds = new Set(allTickets.map(t => t.id))
    const notFoundIds = options.ticketIds.filter(id => !foundIds.has(id))
    for (const id of notFoundIds) {
      result.skipped.push({
        ticketId: id,
        reason: `Ticket not found in column "${columnName}"`,
      })
    }
  }

  if (allTickets.length === 0) {
    log(`No tickets found in column "${columnName}"`)
    return result
  }

  // Filter tickets that don't have running executions
  const ticketsToSpawn: Ticket[] = []
  for (const ticket of allTickets) {
    const runningExec = executionStorage.getRunningExecution(ticket.id)
    if (runningExec) {
      result.skipped.push({
        ticketId: ticket.id,
        reason: `Already has running execution: ${runningExec.id}`,
      })
    } else {
      ticketsToSpawn.push(ticket)
    }
  }

  // Apply limit
  const ticketsToProcess = ticketsToSpawn.slice(0, limit)

  if (ticketsToProcess.length === 0) {
    log('No tickets available to spawn (all have running executions)')
    return result
  }

  // Get available agents (or use specific agent)
  let availableAgents: string[]
  if (options.specificAgent) {
    // Check if specific agent is available
    if (!executionStorage.isAgentAvailable(options.specificAgent)) {
      log(`Agent "${options.specificAgent}" is busy`)
      for (const ticket of ticketsToProcess) {
        result.skipped.push({
          ticketId: ticket.id,
          reason: `Specified agent "${options.specificAgent}" is busy`,
        })
      }
      return result
    }
    availableAgents = [options.specificAgent]
  } else {
    availableAgents = getAvailableAgents(workspaceInfo, executionStorage)
  }

  if (availableAgents.length === 0) {
    log('No agents available')
    for (const ticket of ticketsToProcess) {
      result.skipped.push({
        ticketId: ticket.id,
        reason: 'No agents available',
      })
    }
    return result
  }

  // Round-robin state
  const roundRobinState = { lastIndex: -1 }

  // Spawn for each ticket
  for (const ticket of ticketsToProcess) {
    // Select agent
    const agentName = options.specificAgent
      ? options.specificAgent
      : selectAgent(strategy, availableAgents, executionStorage, roundRobinState)

    if (!agentName) {
      result.skipped.push({
        ticketId: ticket.id,
        reason: 'No agents available',
      })
      continue
    }

    if (options.dryRun) {
      log(`[DRY RUN] Would spawn ${agentName} for ${ticket.id}: ${ticket.title}`)
      result.spawned.push({
        success: true,
        ticketId: ticket.id,
        agentName,
      })
      continue
    }

    log(`Spawning ${agentName} for ${ticket.id}: ${ticket.title}`)

    // eslint-disable-next-line no-await-in-loop -- Sequential spawning with user feedback
    const spawnResult = await spawnAgentForTicket(
      ticket,
      agentName,
      storage,
      executionStorage,
      workspaceInfo,
      db,
      pmoPath,
      options
    )

    if (spawnResult.success) {
      result.spawned.push(spawnResult)

      // Remove agent from available list if using round-robin/random
      // (they can only work on one ticket at a time)
      if (!options.specificAgent) {
        const agentIndex = availableAgents.indexOf(agentName)
        if (agentIndex !== -1) {
          availableAgents.splice(agentIndex, 1)
        }

        // Update round-robin index since we removed an agent
        if (roundRobinState.lastIndex >= availableAgents.length) {
          roundRobinState.lastIndex = -1
        }
      }

      // Staggered spawn delay to prevent Docker kernel panics (TKT-801)
      // When spawning multiple containers, add delay between spawns to avoid
      // mount storms that cause spinlock contention in Docker's grpcfuse layer
      const remainingTickets = ticketsToProcess.length - (ticketsToProcess.indexOf(ticket) + 1)
      if (remainingTickets > 0 && availableAgents.length > 0) {
        log(`Waiting ${SPAWN_STAGGER_DELAY_MS / 1000}s before next spawn (${remainingTickets} remaining)...`)
        // eslint-disable-next-line no-await-in-loop -- Intentional staggered delay for Docker stability
        await new Promise(resolve => setTimeout(resolve, SPAWN_STAGGER_DELAY_MS))
      }
    } else {
      result.failed.push(spawnResult)
    }

    // Check if we ran out of agents
    if (availableAgents.length === 0 && !options.specificAgent) {
      log('Ran out of available agents')
      // Skip remaining tickets
      const remainingIndex = ticketsToProcess.indexOf(ticket) + 1
      for (let i = remainingIndex; i < ticketsToProcess.length; i++) {
        result.skipped.push({
          ticketId: ticketsToProcess[i].id,
          reason: 'No agents available',
        })
      }
      break
    }
  }

  return result
}

// =============================================================================
// Output Mode Resolution (PRLT-1119)
// =============================================================================

/**
 * Resolve the output mode for an agent execution.
 *
 * Background display always uses print mode (-p flag) so Claude doesn't hang
 * waiting for TTY input. Terminal/foreground use interactive mode for streaming TUI.
 *
 * Previously, devcontainer+tmux forced interactive mode even for background display,
 * which caused Claude to hang when the tmux session had no attached client.
 */
export function resolveOutputMode(displayMode: DisplayMode): OutputMode {
  return displayMode === 'background' ? 'print' : 'interactive'
}

// =============================================================================
// Docker & GitHub Token Checks
// =============================================================================

export { isDockerRunning, checkDockerDaemon, isGitHubTokenAvailable, isDevcontainerCliInstalled }
