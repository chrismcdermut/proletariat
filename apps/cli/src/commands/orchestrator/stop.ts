import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import type Database from 'better-sqlite3'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { findHQRoot } from '../../lib/workspace.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  outputPromptAsJson,
  buildPromptConfig,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { getHostTmuxSessionNames } from '../../lib/execution/session-utils.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import {
  buildOrchestratorSessionName,
  buildOrchestratorContainerName,
  findRunningOrchestratorSessions,
  findHQOrchestratorSessions,
  findHQOrchestratorContainers,
  findRunningOrchestratorContainers,
  getOrchestratorContainerId,
  enrichOrchestratorSession,
  formatOrchestratorSessionLabel,
  type OrchestratorSessionInfo,
} from './start.js'
import { getHeadquartersNameFromPath } from '../../lib/machine-config.js'

export default class OrchestratorStop extends PromptCommand {
  static description = 'Stop the running orchestrator'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
  ]

  static flags = {
    ...machineOutputFlags,
    name: Flags.string({
      char: 'n',
      description: 'Name of the orchestrator session to stop (default: main)',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(OrchestratorStop)
    const jsonMode = shouldOutputJson(flags)
    const hostSessions = getHostTmuxSessionNames()

    // Track whether the resolved session is in a Docker container
    let isDockerSession = false

    // Resolve session name: try HQ-scoped first, fall back to discovery
    let sessionName: string | undefined
    let orchestratorName: string | undefined
    const hqPath = findHQRoot(process.cwd())

    // Discover ALL orchestrator sessions (host + Docker), enriched with HQ context.
    // Used for both the picker and the "session not found" error message.
    const allRunningSessions: OrchestratorSessionInfo[] = [
      ...findRunningOrchestratorSessions(hostSessions).map(s => enrichOrchestratorSession(s, false)),
      ...findRunningOrchestratorContainers().map(c => enrichOrchestratorSession(c, true)),
    ]

    if (hqPath) {
      const hqName = getHeadquartersNameFromPath(hqPath)

      if (flags.name) {
        // Explicit --name: look for that specific orchestrator (host tmux first, then Docker)
        sessionName = buildOrchestratorSessionName(hqName, flags.name)
        orchestratorName = flags.name
        if (!hostSessions.includes(sessionName)) {
          // Check Docker
          const containerName = buildOrchestratorContainerName(hqName, flags.name)
          const containerId = getOrchestratorContainerId(containerName)
          if (containerId) {
            sessionName = containerName
            isDockerSession = true
          } else {
            sessionName = undefined
          }
        }

        if (!sessionName) {
          this.reportNamedSessionNotFound(flags.name, allRunningSessions, flags, jsonMode)
          return
        }
      } else {
        // No --name: discover ALL orchestrators in this HQ (host + Docker)
        const hqInfos: OrchestratorSessionInfo[] = [
          ...findHQOrchestratorSessions(hostSessions, hqName).map(s => enrichOrchestratorSession(s, false)),
          ...findHQOrchestratorContainers(hqName).map(c => enrichOrchestratorSession(c, true)),
        ]

        if (hqInfos.length === 1) {
          sessionName = hqInfos[0].sessionId
          orchestratorName = hqInfos[0].orchestratorName
          isDockerSession = hqInfos[0].isDocker
        } else if (hqInfos.length > 1) {
          const picked = await this.pickOrchestratorSession(hqInfos, flags, jsonMode)
          if (!picked) return
          sessionName = picked.sessionId
          orchestratorName = picked.orchestratorName
          isDockerSession = picked.isDocker
        }
        // If 0 found, fall through to global discovery below
      }
    }

    // If not in HQ or session not found, discover running orchestrator sessions globally
    if (!sessionName) {
      if (allRunningSessions.length === 0) {
        if (jsonMode) {
          outputErrorAsJson(
            'NOT_RUNNING',
            'Orchestrator is not running.',
            createMetadata('orchestrator stop', flags),
          )
          return
        }
        this.log('')
        this.log(styles.muted('Orchestrator is not running.'))
        this.log('')
        return
      }

      // Global --name lookup: when called outside an HQ with --name, match by
      // orchestrator name across all running sessions.
      if (flags.name) {
        const matches = allRunningSessions.filter(s => s.orchestratorName === flags.name)
        if (matches.length === 0) {
          this.reportNamedSessionNotFound(flags.name, allRunningSessions, flags, jsonMode)
          return
        }
        if (matches.length === 1) {
          sessionName = matches[0].sessionId
          orchestratorName = matches[0].orchestratorName
          isDockerSession = matches[0].isDocker
        } else {
          const picked = await this.pickOrchestratorSession(matches, flags, jsonMode)
          if (!picked) return
          sessionName = picked.sessionId
          orchestratorName = picked.orchestratorName
          isDockerSession = picked.isDocker
        }
      } else if (allRunningSessions.length === 1) {
        sessionName = allRunningSessions[0].sessionId
        orchestratorName = allRunningSessions[0].orchestratorName
        isDockerSession = allRunningSessions[0].isDocker
      } else {
        const picked = await this.pickOrchestratorSession(allRunningSessions, flags, jsonMode)
        if (!picked) return
        sessionName = picked.sessionId
        orchestratorName = picked.orchestratorName
        isDockerSession = picked.isDocker
      }
    }

    if (!sessionName) {
      return
    }

    // Confirm unless --force
    if (!flags.force && !jsonMode) {
      const { confirmed } = await this.prompt<{ confirmed: boolean }>([{
        type: 'list',
        name: 'confirmed',
        message: `Stop the orchestrator (${sessionName}${isDockerSession ? ' - Docker' : ''})?`,
        choices: [
          { name: 'Yes', value: true },
          { name: 'No', value: false },
        ],
      }])

      if (!confirmed) {
        this.log(styles.muted('Cancelled.'))
        return
      }
    }

    // Kill the session (Docker container or tmux session)
    try {
      if (isDockerSession) {
        // Stop and remove the Docker container
        execSync(`docker rm -f ${sessionName}`, { stdio: 'pipe' })
      } else {
        // Kill the host tmux session
        execSync(`tmux kill-session -t "${sessionName}"`, { stdio: 'pipe' })
      }
    } catch (error) {
      if (jsonMode) {
        outputErrorAsJson(
          'KILL_FAILED',
          `Failed to stop orchestrator: ${error instanceof Error ? error.message : error}`,
          createMetadata('orchestrator stop', flags),
        )
        return
      }
      this.error(`Failed to stop orchestrator: ${error instanceof Error ? error.message : error}`)
    }

    // Update execution record to stopped (only if in HQ)
    if (hqPath) {
      let db: Database.Database | null = null
      try {
        db = openWorkspaceDatabase(hqPath)
        const executionStorage = new ExecutionStorage(db)
        // Match new format: orchestrator-{name}
        const agentNameToMatch = orchestratorName ? `orchestrator-${orchestratorName}` : undefined
        const matchNames = agentNameToMatch ? [agentNameToMatch] : []
        // Also match old format for backward compatibility
        matchNames.push('orchestrator')

        for (const matchName of matchNames) {
          const running = executionStorage.listExecutions({ agentName: matchName, status: 'running' })
          const starting = executionStorage.listExecutions({ agentName: matchName, status: 'starting' })
          for (const exec of [...running, ...starting]) {
            executionStorage.updateStatus(exec.id, 'stopped')
          }
        }
      } catch {
        // Non-fatal
      } finally {
        db?.close()
      }
    }

    if (jsonMode) {
      outputSuccessAsJson({
        sessionId: sessionName,
        status: 'stopped',
      }, createMetadata('orchestrator stop', flags as Record<string, unknown>))
      return
    }

    this.log('')
    this.log(styles.success('Orchestrator stopped.'))
    this.log('')
  }

  /**
   * Show a picker for orchestrator sessions and return the selected one.
   * In JSON mode, emits a prompt config and returns null (caller should bail).
   */
  private async pickOrchestratorSession(
    infos: OrchestratorSessionInfo[],
    flags: Record<string, unknown>,
    jsonMode: boolean,
  ): Promise<OrchestratorSessionInfo | null> {
    const sessionChoices = infos.map(info => ({
      name: formatOrchestratorSessionLabel(info),
      value: info.sessionId,
      command: `prlt orchestrator stop --name "${info.orchestratorName}" --force --json`,
    }))
    const selectMessage = 'Select orchestrator to stop:'

    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'session', selectMessage, sessionChoices),
        createMetadata('orchestrator stop', flags),
      )
      return null
    }

    const { session } = await this.prompt<{ session: string }>([{
      type: 'list',
      name: 'session',
      message: selectMessage,
      choices: sessionChoices,
    }])

    return infos.find(info => info.sessionId === session) || null
  }

  /**
   * Surface a "session not found" error that lists available sessions and
   * their HQ context, so the user can pick a valid name without guessing.
   */
  private reportNamedSessionNotFound(
    requestedName: string,
    available: OrchestratorSessionInfo[],
    flags: Record<string, unknown>,
    jsonMode: boolean,
  ): void {
    const availableSummary = available.length === 0
      ? 'No orchestrator sessions are currently running.'
      : `Available sessions:\n${available.map(info => `  - ${formatOrchestratorSessionLabel(info)}`).join('\n')}`

    const message = `Orchestrator session "${requestedName}" not found. ${availableSummary}`

    if (jsonMode) {
      outputErrorAsJson(
        'SESSION_NOT_FOUND',
        message,
        createMetadata('orchestrator stop', flags),
      )
      return
    }

    this.log('')
    this.log(styles.warning(`Orchestrator session "${requestedName}" not found.`))
    if (available.length === 0) {
      this.log(styles.muted('No orchestrator sessions are currently running.'))
      this.log(styles.muted('Start one with: prlt orchestrator start'))
    } else {
      this.log('')
      this.log(styles.muted('Available sessions:'))
      for (const info of available) {
        this.log(styles.muted(`  - ${formatOrchestratorSessionLabel(info)}`))
      }
    }
    this.log('')
  }
}
