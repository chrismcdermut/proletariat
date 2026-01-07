/**
 * Agent Spawner
 *
 * Shared logic for spawning agent executions.
 * Used by `work start`, `work spawn`, and `work watch` commands.
 */

import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import Database from 'better-sqlite3'
import inquirer from 'inquirer'
import { SQLiteStorage } from '../pmo/storage-sqlite.js'
import { autoExportToBoard } from '../pmo/index.js'
import { getWorkColumnSetting, findColumnByName } from '../pmo/utils.js'
import { WorkspaceInfo } from '../agents/commands.js'
import { findHQRoot } from '../repos/index.js'
import { ExecutionStorage } from './storage.js'
import { hasDevcontainerConfig } from './devcontainer.js'
import { loadExecutionConfig } from './config.js'
import { runExecution, isDockerRunning } from './runners.js'
import { isGHInstalled, isGHAuthenticated } from '../pr/index.js'
import {
  RuntimeMode,
  DisplayMode,
  OutputMode,
  ExecutorType,
  ExecutionContext,
  ExecutionEnvironment,
  ExecutionConfig,
  generateBranchName,
  DEFAULT_EXECUTION_CONFIG,
} from './types.js'
import { Ticket } from '../pmo/types.js'

// =============================================================================
// Types
// =============================================================================

export type AgentStrategy = 'round-robin' | 'least-busy' | 'random'

export interface SpawnOptions {
  /** Environment to run in */
  environment?: ExecutionEnvironment
  /** Display mode for output */
  displayMode?: DisplayMode
  /** Executor to use */
  executor?: ExecutorType
  /** Skip permission prompts (danger mode) */
  skipPermissions?: boolean
  /** Create PR when work is ready */
  createPR?: boolean
  /** Execution config (terminal app, shell, etc.) */
  executionConfig?: ExecutionConfig
  /** Logging callback */
  log?: (msg: string) => void
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
 * Get agents that are not currently running any executions.
 */
export function getAvailableAgents(
  workspaceInfo: WorkspaceInfo,
  executionStorage: ExecutionStorage
): string[] {
  return workspaceInfo.agents
    .filter(agent => executionStorage.isAgentAvailable(agent.name))
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

  // Determine agent directory and worktree path
  const agentDir = path.join(workspaceInfo.agentsPath, agentName)
  if (!fs.existsSync(agentDir)) {
    return {
      success: false,
      ticketId: ticket.id,
      agentName,
      error: `Agent directory not found at ${agentDir}`,
    }
  }

  // Find worktree path for agent
  let worktreePath = agentDir
  const agentContents = fs.readdirSync(agentDir)
  const repoWorktrees = agentContents.filter(item => {
    const itemPath = path.join(agentDir, item)
    const gitPath = path.join(itemPath, '.git')
    return fs.statSync(itemPath).isDirectory() && fs.existsSync(gitPath)
  })

  if (repoWorktrees.length === 1) {
    worktreePath = path.join(agentDir, repoWorktrees[0])
  } else if (repoWorktrees.length > 1) {
    worktreePath = agentDir
  } else {
    // No git worktrees found - use current directory
    worktreePath = process.cwd()
  }

  // Generate branch name
  const branch = generateBranchName(
    ticket.id,
    ticket.title,
    agentName,
    ticket.category
  )

  // Get epic info if linked
  let epicTitle: string | undefined
  if (ticket.epicId) {
    const epic = await storage.getEpic(ticket.epicId)
    epicTitle = epic?.title
  }

  // Get spec info if linked
  let specId: string | undefined
  let specTitle: string | undefined
  let specProblem: string | undefined
  let specSolution: string | undefined
  if (ticket.specId) {
    const spec = await storage.getSpec(ticket.specId)
    if (spec) {
      specId = spec.id
      specTitle = spec.title
      specProblem = spec.problem
      specSolution = spec.solution
    }
  }

  // Build execution context
  // Find proper HQ root (don't assume PMO is at {hq}/pmo - it could be at {hq}/repos/myrepo/pmo)
  const hqPath = findHQRoot() || path.dirname(pmoPath)
  const context: ExecutionContext = {
    ticketId: ticket.id,
    ticketTitle: ticket.title,
    ticketDescription: ticket.description,
    ticketSubtasks: ticket.subtasks?.map(s => ({ title: s.title, done: s.done })),
    ticketPriority: ticket.priority,
    ticketCategory: ticket.category,
    epicTitle,
    specId,
    specTitle,
    specProblem,
    specSolution,
    agentName,
    agentDir,
    worktreePath,
    branch,
    hqPath,
    pmoPath,
    createPR: options.createPR ?? false,
  }

  // Determine execution environment and display mode
  const hasDevcontainer = hasDevcontainerConfig(agentDir)
  const dockerRunning = isDockerRunning()
  const environment: ExecutionEnvironment = options.environment || (hasDevcontainer && dockerRunning ? 'devcontainer' : 'host')
  const displayMode: DisplayMode = options.displayMode || 'terminal'

  // Determine runtime mode based on environment and display mode
  let mode: RuntimeMode
  if (environment === 'devcontainer') {
    mode = 'devcontainer'
  } else {
    // For host environment, mode matches display mode
    mode = displayMode as RuntimeMode
  }

  const sandboxed = !(options.skipPermissions ?? false)

  // Create branch in worktree(s)
  // For devcontainer environments, run git commands inside the container
  // because the worktree .git file has container paths, not host paths
  const gitRepos = repoWorktrees.length > 0
    ? repoWorktrees.map(r => path.join(agentDir, r))
    : [worktreePath]

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

        try {
          // Check if this is a git repo inside the container
          try {
            execSync(`docker exec ${containerId} git -C "${containerRepoPath}" rev-parse --git-dir`, { stdio: 'pipe' })
          } catch {
            continue
          }

          // Check if branch exists
          try {
            execSync(`docker exec ${containerId} git -C "${containerRepoPath}" rev-parse --verify ${branch}`, { stdio: 'pipe' })
            execSync(`docker exec ${containerId} git -C "${containerRepoPath}" checkout ${branch}`, { stdio: 'pipe' })
          } catch {
            execSync(`docker exec ${containerId} git -C "${containerRepoPath}" checkout -b ${branch}`, { stdio: 'pipe' })
          }
          log(`Created branch ${branch} in ${repoName} (inside container)`)
        } catch (error) {
          log(`Could not create branch in ${repoName}: ${error instanceof Error ? error.message : error}`)
        }
      }
    } else {
      log('Container not running, will create branch when container starts')
    }
  } else {
    // Host environment - run git commands directly
    for (const repoPath of gitRepos) {
      try {
        // Check if this is a git repo
        try {
          execSync('git rev-parse --git-dir', { cwd: repoPath, stdio: 'pipe' })
        } catch {
          continue
        }

        // Check if branch exists
        try {
          execSync(`git rev-parse --verify ${branch}`, { cwd: repoPath, stdio: 'pipe' })
          execSync(`git checkout ${branch}`, { cwd: repoPath, stdio: 'pipe' })
        } catch {
          execSync(`git checkout -b ${branch}`, { cwd: repoPath, stdio: 'pipe' })
        }
      } catch (error) {
        log(`Could not create branch in ${path.basename(repoPath)}: ${error instanceof Error ? error.message : error}`)
      }
    }
  }

  // Create execution record
  const execution = executionStorage.createExecution({
    ticketId: ticket.id,
    agentName,
    executor,
    mode,
    environment,
    displayMode,
    sandboxed,
    branch,
  })

  // Load execution config (use passed config or load from db)
  const executionConfig = options.executionConfig || loadExecutionConfig(db)
  executionConfig.sandboxed = sandboxed
  // Use print mode for background, interactive for terminal/tmux
  executionConfig.outputMode = displayMode === 'background' ? 'print' : 'interactive'

  // Run execution
  const result = await runExecution(mode, context, executor, executionConfig, {
    displayMode: environment === 'devcontainer' ? displayMode : undefined,
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
    const board = await storage.getBoard()
    const columnNames = board.columns.map(col => col.name)
    const inProgressColumn = findColumnByName(columnNames, targetColumnName)

    if (inProgressColumn && ticket.column !== inProgressColumn) {
      await storage.moveTicket(ticket.id, inProgressColumn)
    }

    await autoExportToBoard(pmoPath, storage, log)

    return {
      success: true,
      executionId: execution.id,
      ticketId: ticket.id,
      agentName,
    }
  } else {
    executionStorage.updateStatus(execution.id, 'failed')
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
  let allTickets = await storage.listTickets({ column: columnName })

  // If specific ticket IDs provided, filter to only those tickets
  if (options.ticketIds && options.ticketIds.length > 0) {
    allTickets = allTickets.filter(t => options.ticketIds!.includes(t.id))

    // Check if any requested tickets weren't found
    const foundIds = allTickets.map(t => t.id)
    const notFoundIds = options.ticketIds.filter(id => !foundIds.includes(id))
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
// Batch Execution Settings Prompts
// =============================================================================

export interface BatchExecutionOptions {
  /** Whether any agents have devcontainer configs */
  hasDevcontainer: boolean
  /** Pre-set mode from flag */
  mode?: string
  /** Pre-set output from flag */
  output?: string
  /** Pre-set skip-permissions from flag */
  skipPermissions?: boolean
  /** Pre-set create-pr from flag */
  createPR?: boolean
  /** Pre-set no-pr from flag */
  noPR?: boolean
  /** Pre-set run-on-host from flag */
  runOnHost?: boolean
  /** Warn function */
  warn: (msg: string) => void
  /** Log function */
  log: (msg: string) => void
}

export interface BatchExecutionResult {
  /** Whether to run on host (pass --run-on-host to work:start) */
  runOnHost: boolean
  /** Display mode (terminal, foreground, tmux, background) */
  displayMode: DisplayMode
  /** Output mode (interactive, print) */
  outputMode: OutputMode
  /** Whether to skip permission checks */
  skipPermissions: boolean
  /** Whether to create PR when work is ready */
  createPR: boolean
  /** Whether user cancelled */
  cancelled: boolean
}

/**
 * Prompt for batch execution settings in a consistent way.
 * Used by work start (batch mode) and work spawn commands.
 */
export async function promptBatchExecutionSettings(
  options: BatchExecutionOptions
): Promise<BatchExecutionResult> {
  const { hasDevcontainer, warn, log } = options

  let runOnHost = options.runOnHost ?? false
  let displayMode: DisplayMode = (options.mode as DisplayMode) || 'terminal'
  let outputMode: OutputMode = (options.output as OutputMode) || 'interactive'
  let skipPermissions = options.skipPermissions ?? false
  let createPR = options.createPR ?? false

  // 1. Environment selection (devcontainer vs host)
  if (hasDevcontainer && !options.runOnHost && !options.mode) {
    let environmentSelected = false
    while (!environmentSelected) {
      const { selectedEnvironment } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedEnvironment',
          message: 'Where should agents run?',
          choices: [
            { name: '🐳 devcontainer (sandboxed, recommended)', value: 'devcontainer' },
            { name: '💻 host (runs directly on your machine)', value: 'host' },
            { name: '✗  cancel', value: 'cancel' },
          ],
          default: 'devcontainer',
        },
      ])

      if (selectedEnvironment === 'cancel') {
        return { runOnHost: false, displayMode: 'terminal', outputMode: 'interactive', skipPermissions: false, createPR: false, cancelled: true }
      }

      if (selectedEnvironment === 'devcontainer') {
        if (!isDockerRunning()) {
          log('')
          warn(
            'Docker is not running.\n' +
            'Docker is required for devcontainer execution.\n' +
            'Please start Docker Desktop or select "host" to run directly on your machine.'
          )
          log('')
          continue
        }
        runOnHost = false
        environmentSelected = true
      } else {
        runOnHost = true
        environmentSelected = true
      }
    }
  }

  // 2. Display mode selection
  if (!options.mode) {
    const { selectedMode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedMode',
        message: 'How should agents be displayed?',
        choices: [
          { name: '🖥️  terminal     - New terminal window (recommended)', value: 'terminal' },
          { name: '📺 foreground  - Current terminal', value: 'foreground' },
          { name: '🔲 tmux        - Tmux pane/window', value: 'tmux' },
          { name: '📦 background  - Detached (logs to file)', value: 'background' },
        ],
      },
    ])
    displayMode = selectedMode as DisplayMode
  }

  // 3. Output mode selection
  if (!options.output) {
    const { selectedOutput } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedOutput',
        message: 'How should Claude display output?',
        choices: [
          { name: 'interactive  - Watch Claude work in real-time', value: 'interactive' },
          { name: 'print        - Show final result only', value: 'print' },
        ],
        default: 'interactive',
      },
    ])
    outputMode = selectedOutput as OutputMode
  }

  // 4. Permission mode selection
  if (options.skipPermissions === undefined) {
    const { permissionMode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'permissionMode',
        message: 'Permission mode for Claude Code:',
        choices: [
          { name: '🔒 safe   - Requires approval for dangerous operations', value: 'safe' },
          { name: '⚠️  danger - Skip permission checks', value: 'danger' },
        ],
        default: 'safe',
      },
    ])
    skipPermissions = permissionMode === 'danger'
  }

  // 5. PR creation selection
  if (options.createPR === undefined && options.noPR === undefined) {
    const ghAvailable = isGHInstalled() && isGHAuthenticated()
    if (ghAvailable) {
      const { prChoice } = await inquirer.prompt([
        {
          type: 'list',
          name: 'prChoice',
          message: 'Create pull requests when work is ready?',
          choices: [
            { name: '✓ Yes - Create PR for each ticket', value: 'yes' },
            { name: '✗ No  - Just move tickets to review', value: 'no' },
          ],
          default: 'yes',
        },
      ])
      createPR = prChoice === 'yes'
    }
  } else if (options.createPR) {
    createPR = true
  }

  return {
    runOnHost,
    displayMode,
    outputMode,
    skipPermissions,
    createPR,
    cancelled: false,
  }
}

// =============================================================================
// Docker Check
// =============================================================================

export { isDockerRunning }
