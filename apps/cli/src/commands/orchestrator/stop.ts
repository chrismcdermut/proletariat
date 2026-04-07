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
import { MachineDB } from '../../lib/machine-db.js'
import {
  findRunningOrchestratorSessions,
  findRunningOrchestratorContainers,
  getOrchestratorContainerId,
  enrichOrchestratorSessionFromMachineDb,
  findMachineOrchestratorExecution,
  formatOrchestratorSessionLabel,
  type OrchestratorSessionInfo,
} from './start.js'

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

    // PRLT-1271: machine-wide discovery — `prlt orchestrator stop` must work
    // from anywhere on the machine and show every running orchestrator's
    // originating HQ, not just the ones in the current HQ.
    const allRunningSessions = this.discoverMachineWideSessions()

    // Current HQ is only used to disambiguate `--name` matches when multiple
    // HQs have a session with the same orchestrator name.
    const hqPath = findHQRoot(process.cwd())

    // Track whether the resolved session is in a Docker container
    let isDockerSession = false
    let sessionName: string | undefined
    let orchestratorName: string | undefined
    let resolvedHqPath: string | null | undefined

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

    if (flags.name) {
      let matches = allRunningSessions.filter(s => s.orchestratorName === flags.name)

      if (matches.length === 0) {
        this.reportNamedSessionNotFound(flags.name, allRunningSessions, flags, jsonMode)
        return
      }

      // Prefer current HQ's match when ambiguous, to preserve existing
      // single-HQ habits.
      if (matches.length > 1 && hqPath) {
        const inCurrentHq = matches.filter(s => s.hqPath === hqPath)
        if (inCurrentHq.length === 1) {
          matches = inCurrentHq
        }
      }

      if (matches.length === 1) {
        sessionName = matches[0].sessionId
        orchestratorName = matches[0].orchestratorName
        isDockerSession = matches[0].isDocker
        resolvedHqPath = matches[0].hqPath
      } else {
        const picked = await this.pickOrchestratorSession(matches, flags, jsonMode)
        if (!picked) return
        sessionName = picked.sessionId
        orchestratorName = picked.orchestratorName
        isDockerSession = picked.isDocker
        resolvedHqPath = picked.hqPath
      }
    } else if (allRunningSessions.length === 1) {
      sessionName = allRunningSessions[0].sessionId
      orchestratorName = allRunningSessions[0].orchestratorName
      isDockerSession = allRunningSessions[0].isDocker
      resolvedHqPath = allRunningSessions[0].hqPath
    } else {
      const picked = await this.pickOrchestratorSession(allRunningSessions, flags, jsonMode)
      if (!picked) return
      sessionName = picked.sessionId
      orchestratorName = picked.orchestratorName
      isDockerSession = picked.isDocker
      resolvedHqPath = picked.hqPath
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

    // Update execution record in workspace.db — use the HQ the orchestrator
    // was actually started from (resolved via machine.db), not the current
    // working directory, so stops issued from a different HQ still clean up
    // the right record.
    const hqPathForCleanup = resolvedHqPath || hqPath
    if (hqPathForCleanup) {
      let db: Database.Database | null = null
      try {
        db = openWorkspaceDatabase(hqPathForCleanup)
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

    // Also update the machine.db record so `prlt orchestrator status` no
    // longer shows this session as running.
    let machineDb: MachineDB | null = null
    try {
      machineDb = new MachineDB()
      const exec = findMachineOrchestratorExecution(
        machineDb,
        sessionName,
        isDockerSession ? sessionName : undefined,
      )
      if (exec) {
        machineDb.updateStatus(exec.id, 'stopped')
      }
    } catch {
      // Non-fatal
    } finally {
      machineDb?.close()
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
   * Discover every running orchestrator session on the machine (host tmux +
   * Docker), enriched with HQ context from machine.db. Works from anywhere —
   * no HQ workspace required.
   */
  private discoverMachineWideSessions(): OrchestratorSessionInfo[] {
    const hostSessions = getHostTmuxSessionNames()
    const hostOrchestrators = findRunningOrchestratorSessions(hostSessions)
    const containerOrchestrators = findRunningOrchestratorContainers()

    let machineDb: MachineDB | null = null
    try {
      machineDb = new MachineDB()
    } catch {
      // Machine DB not available — fall back to registry-only enrichment.
    }

    try {
      const hostInfos = hostOrchestrators.map(sessionId =>
        enrichOrchestratorSessionFromMachineDb(sessionId, false, machineDb),
      )
      const containerInfos = containerOrchestrators.map(containerName => {
        const containerId = getOrchestratorContainerId(containerName) || undefined
        return enrichOrchestratorSessionFromMachineDb(
          containerName,
          true,
          machineDb,
          containerId,
        )
      })
      return [...hostInfos, ...containerInfos]
    } finally {
      machineDb?.close()
    }
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
