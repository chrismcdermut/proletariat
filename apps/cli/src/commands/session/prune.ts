import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import { styles } from '../../lib/styles.js'
import {
  getWorkspaceInfo,
  cleanupAgent,
  getCleanableAgents,
  killTmuxSession,
  CleanupResult,
} from '../../lib/agents/commands.js'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import {
  parseSessionName,
  getHostTmuxSessionNames,
  getContainerTmuxSessionMap,
  flattenContainerSessions,
  findContainerSessionsByPrefix,
  findSessionForExecution,
  probeExecutionLiveness,
  checkDockerContainerAlive,
} from '../../lib/execution/session-utils.js'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

interface PruneResult {
  staleExecutionsCleaned: number
  completedSessionsKilled: string[]
  orphanSessionsKilled: string[]
  ephemeralAgentsCleaned: CleanupResult[]
  errors: string[]
}

export default class SessionPrune extends PromptCommand {
  static description = 'Clean up stale sessions, kill completed/failed execution runtimes, remove orphan tmux sessions, and clean idle ephemeral agents'

  static examples = [
    '<%= config.bin %> session prune',
    '<%= config.bin %> session prune --dry-run',
    '<%= config.bin %> session prune --force',
    '<%= config.bin %> session prune --age 24',
  ]

  static flags = {
    ...machineOutputFlags,
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Show what would be pruned without actually doing it',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force cleanup even if agents have uncommitted/unpushed work',
      default: false,
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip confirmation prompt',
      default: false,
    }),
    age: Flags.integer({
      description: 'Only prune sessions/agents idle for more than N hours (default: 0 = all idle)',
      default: 0,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(SessionPrune)
    const jsonMode = shouldOutputJson(flags)
    const dryRun = flags['dry-run']
    const forceCleanup = flags.force
    const skipConfirm = flags.yes
    const ageHours = flags.age

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run from a proletariat HQ directory.', createMetadata('session prune', flags))
        return
      }
      this.log(styles.error('Not in a workspace. Run from a proletariat HQ directory.'))
      return
    }

    // Open database
    const db = openWorkspaceDatabase(workspaceInfo.path)
    const executionStorage = new ExecutionStorage(db)

    try {
      const result: PruneResult = {
        staleExecutionsCleaned: 0,
        completedSessionsKilled: [],
        orphanSessionsKilled: [],
        ephemeralAgentsCleaned: [],
        errors: [],
      }

      // =====================================================================
      // Step 1: Clean up stale execution records (DB records with dead runtime)
      // =====================================================================
      const staleCount = executionStorage.cleanupStaleExecutions()
      result.staleExecutionsCleaned = staleCount

      // =====================================================================
      // Step 2: Kill runtimes for completed/failed/stopped DB records
      // These are executions the DB knows about that have terminal status
      // but whose tmux sessions or Docker containers are still running.
      // =====================================================================
      const completedExecutions = [
        ...executionStorage.listExecutions({ status: 'completed' }),
        ...executionStorage.listExecutions({ status: 'failed' }),
        ...executionStorage.listExecutions({ status: 'stopped' }),
      ]

      for (const exec of completedExecutions) {
        const isContainer = exec.environment === 'devcontainer' || exec.environment === 'docker'
        const alive = probeExecutionLiveness(exec.environment, exec.containerId, exec.sessionId)

        if (!alive) continue

        const label = exec.sessionId || exec.containerId || exec.id

        if (dryRun) {
          result.completedSessionsKilled.push(label)
          continue
        }

        // Kill the runtime
        try {
          if (isContainer && exec.containerId) {
            // Kill tmux session inside container if we know the session ID
            if (exec.sessionId) {
              try {
                execSync(
                  `docker exec ${exec.containerId} tmux kill-session -t "${exec.sessionId}"`,
                  { stdio: 'pipe', timeout: 10000 },
                )
              } catch {
                // tmux session may already be gone
              }
            }
            // Stop the container if it's still running
            if (checkDockerContainerAlive(exec.containerId)) {
              execSync(
                `docker stop ${exec.containerId}`,
                { stdio: 'pipe', timeout: 30000 },
              )
            }
            result.completedSessionsKilled.push(label)
          } else if (exec.sessionId) {
            // Kill host tmux session
            if (killTmuxSession(exec.sessionId)) {
              result.completedSessionsKilled.push(label)
            } else {
              result.errors.push(`Failed to kill session for completed execution: ${label}`)
            }
          }
        } catch (error) {
          result.errors.push(`Failed to clean up runtime for ${label}: ${error instanceof Error ? error.message : error}`)
        }
      }

      // =====================================================================
      // Step 3: Find and kill orphan tmux sessions (not in DB = garbage)
      // =====================================================================
      const hostTmuxSessions = getHostTmuxSessionNames()
      const containerTmuxSessions = getContainerTmuxSessionMap()
      const allContainerSessions = flattenContainerSessions(containerTmuxSessions)

      // Get all DB-tracked active executions to know which sessions are accounted for
      const runningExecutions = executionStorage.listExecutions({ status: 'running' })
      const startingExecutions = executionStorage.listExecutions({ status: 'starting' })
      const activeExecutions = [...runningExecutions, ...startingExecutions]

      const matchedHostSessions = new Set<string>()
      const matchedContainerSessions = new Set<string>()

      for (const exec of activeExecutions) {
        const isContainer = exec.environment === 'devcontainer' || exec.environment === 'docker'
        let actualSessionId = exec.sessionId

        if (!exec.sessionId) {
          if (isContainer && exec.containerId) {
            const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
            const match = findSessionForExecution(exec.ticketId, exec.agentName, containerSessions)
            if (match) actualSessionId = match
          } else {
            const match = findSessionForExecution(exec.ticketId, exec.agentName, hostTmuxSessions)
            if (match) actualSessionId = match
          }
        }

        if (actualSessionId) {
          if (isContainer && exec.containerId) {
            matchedContainerSessions.add(`${exec.containerId}:${actualSessionId}`)
          } else {
            matchedHostSessions.add(actualSessionId)
          }
        }
      }

      // Find orphan host sessions (match prlt pattern but not tracked in DB)
      const orphanHostSessions: string[] = []
      for (const sessionName of hostTmuxSessions) {
        if (matchedHostSessions.has(sessionName)) continue
        const parsed = parseSessionName(sessionName)
        if (parsed) {
          orphanHostSessions.push(sessionName)
        }
      }

      // Find orphan container sessions
      const orphanContainerSessions: Array<{ sessionName: string; containerId: string }> = []
      for (const { sessionName, containerId } of allContainerSessions) {
        if (matchedContainerSessions.has(`${containerId}:${sessionName}`)) continue
        const parsed = parseSessionName(sessionName)
        if (parsed) {
          orphanContainerSessions.push({ sessionName, containerId })
        }
      }

      // Kill orphan sessions
      for (const sessionName of orphanHostSessions) {
        if (dryRun) {
          result.orphanSessionsKilled.push(sessionName)
        } else {
          if (killTmuxSession(sessionName)) {
            result.orphanSessionsKilled.push(sessionName)
          } else {
            result.errors.push(`Failed to kill orphan session: ${sessionName}`)
          }
        }
      }

      for (const { sessionName, containerId } of orphanContainerSessions) {
        if (dryRun) {
          result.orphanSessionsKilled.push(`${containerId}:${sessionName}`)
        } else {
          try {
            execSync(
              `docker exec ${containerId} tmux kill-session -t "${sessionName}"`,
              { stdio: 'pipe', timeout: 10000 },
            )
            result.orphanSessionsKilled.push(`${containerId}:${sessionName}`)
          } catch {
            result.errors.push(`Failed to kill container orphan session: ${containerId}:${sessionName}`)
          }
        }
      }

      // =====================================================================
      // Step 4: Clean up idle ephemeral agents
      // =====================================================================
      // Refresh workspace info after stale cleanup
      const freshWorkspaceInfo = getWorkspaceInfo()
      let cleanableAgents = getCleanableAgents(freshWorkspaceInfo, true)

      // Apply age filter if specified
      if (ageHours > 0) {
        const cutoffMs = ageHours * 60 * 60 * 1000
        cleanableAgents = cleanableAgents.filter(agent => {
          const agentCreated = agent.created_at ? new Date(agent.created_at).getTime() : 0
          return agentCreated > 0 && (Date.now() - agentCreated) > cutoffMs
        })
      }

      // Determine total work to be done
      const totalOrphans = orphanHostSessions.length + orphanContainerSessions.length
      const totalCompleted = result.completedSessionsKilled.length
      const totalWork = staleCount + totalCompleted + totalOrphans + cleanableAgents.length

      if (totalWork === 0) {
        if (jsonMode) {
          outputSuccessAsJson({
            message: 'Nothing to prune. All sessions and agents are clean.',
            ...result,
          }, createMetadata('session prune', flags))
          return
        }
        this.log('')
        this.log(styles.success('Nothing to prune. All sessions and agents are clean.'))
        this.log('')
        return
      }

      // Show summary of what will be pruned
      if (!jsonMode) {
        this.log('')
        this.log(styles.header(`${dryRun ? '[DRY RUN] ' : ''}Session Prune`))
        this.log('═'.repeat(60))

        if (staleCount > 0) {
          this.log(styles.info(`  ${staleCount} stale execution record(s) ${dryRun ? 'would be ' : ''}cleaned`))
        }
        if (totalCompleted > 0) {
          this.log(styles.info(`  ${totalCompleted} completed/failed execution runtime(s) ${dryRun ? 'would be ' : ''}killed`))
        }
        if (totalOrphans > 0) {
          this.log(styles.info(`  ${totalOrphans} orphan tmux session(s) (not in DB) ${dryRun ? 'would be ' : ''}killed:`))
          for (const s of orphanHostSessions) {
            this.log(styles.muted(`    - ${s} (host)`))
          }
          for (const { sessionName, containerId } of orphanContainerSessions) {
            this.log(styles.muted(`    - ${sessionName} (container: ${containerId.substring(0, 12)})`))
          }
        }
        if (cleanableAgents.length > 0) {
          this.log(styles.info(`  ${cleanableAgents.length} idle ephemeral agent(s) ${dryRun ? 'would be ' : ''}cleaned up:`))
          for (const agent of cleanableAgents) {
            this.log(styles.muted(`    - ${agent.name}`))
          }
        }
        this.log('')
      }

      // Confirm unless --yes or --dry-run
      if (!skipConfirm && !dryRun && (cleanableAgents.length > 0 || totalOrphans > 0 || totalCompleted > 0)) {
        if (jsonMode) {
          outputSuccessAsJson({
            message: 'Confirmation required',
            preview: {
              staleExecutions: staleCount,
              completedRuntimes: totalCompleted,
              orphanSessions: totalOrphans,
              ephemeralAgents: cleanableAgents.map(a => a.name),
            },
          }, createMetadata('session prune', flags))
          return
        }

        const totalDestructive = totalCompleted + totalOrphans + cleanableAgents.length
        const { confirm } = await this.prompt<{ confirm: boolean }>([
          {
            type: 'list',
            name: 'confirm',
            message: `Prune ${totalDestructive} item(s) (${totalCompleted} completed runtimes, ${totalOrphans} orphans, ${cleanableAgents.length} agents)?`,
            choices: [
              { name: 'No, cancel', value: false },
              { name: 'Yes, prune', value: true },
            ],
            default: 0,
          },
        ], null)

        if (!confirm) {
          this.log(styles.muted('Operation cancelled.'))
          return
        }
      }

      // Clean up ephemeral agents
      if (!dryRun) {
        for (const agent of cleanableAgents) {
          if (!jsonMode) {
            this.log(styles.info(`  Cleaning up agent: ${agent.name}`))
          }

          // eslint-disable-next-line no-await-in-loop -- Sequential cleanup
          const cleanupResult = await cleanupAgent(freshWorkspaceInfo, agent.name, {
            log: jsonMode ? undefined : (msg) => this.log(styles.muted(`    ${msg}`)),
            dryRun: false,
            force: forceCleanup,
            pushFirst: !forceCleanup, // Try to push work before cleanup unless forcing
          })

          result.ephemeralAgentsCleaned.push(cleanupResult)

          if (!cleanupResult.success && cleanupResult.blockedByGit && !jsonMode) {
            this.log(styles.warning(`    Skipped ${agent.name}: has unsaved work (use --force to override)`))
          }
        }
      } else {
        // Dry run: just report what would happen
        for (const agent of cleanableAgents) {
          result.ephemeralAgentsCleaned.push({
            agent: agent.name,
            success: true,
            tmuxSessionsKilled: [],
            containersRemoved: [],
            directoriesRemoved: [],
            errors: [],
          })
        }
      }

      // Output results
      if (jsonMode) {
        outputSuccessAsJson({
          message: `${dryRun ? 'Would prune' : 'Pruned'} ${totalWork} item(s)`,
          dryRun,
          ...result,
          summary: {
            staleExecutionsCleaned: result.staleExecutionsCleaned,
            completedSessionsKilled: result.completedSessionsKilled.length,
            orphanSessionsKilled: result.orphanSessionsKilled.length,
            ephemeralAgentsCleaned: result.ephemeralAgentsCleaned.filter(r => r.success).length,
            ephemeralAgentsFailed: result.ephemeralAgentsCleaned.filter(r => !r.success).length,
          },
        }, createMetadata('session prune', flags))
        return
      }

      // Summary
      this.log('')
      this.log(styles.header(`${dryRun ? '[DRY RUN] ' : ''}Prune Summary`))
      this.log('─'.repeat(40))

      if (result.staleExecutionsCleaned > 0) {
        this.log(styles.success(`  ${result.staleExecutionsCleaned} stale execution(s) ${dryRun ? 'would be ' : ''}cleaned`))
      }
      if (result.completedSessionsKilled.length > 0) {
        this.log(styles.success(`  ${result.completedSessionsKilled.length} completed/failed runtime(s) ${dryRun ? 'would be ' : ''}killed`))
      }
      if (result.orphanSessionsKilled.length > 0) {
        this.log(styles.success(`  ${result.orphanSessionsKilled.length} orphan session(s) ${dryRun ? 'would be ' : ''}killed`))
      }

      const successfulCleanups = result.ephemeralAgentsCleaned.filter(r => r.success)
      const failedCleanups = result.ephemeralAgentsCleaned.filter(r => !r.success)

      if (successfulCleanups.length > 0) {
        this.log(styles.success(`  ${successfulCleanups.length} ephemeral agent(s) ${dryRun ? 'would be ' : ''}cleaned up`))
      }
      if (failedCleanups.length > 0) {
        this.log(styles.warning(`  ${failedCleanups.length} agent(s) skipped (unsaved work)`))
      }
      if (result.errors.length > 0) {
        for (const err of result.errors) {
          this.log(styles.error(`  ${err}`))
        }
      }

      this.log('')

    } finally {
      db.close()
    }
  }
}
