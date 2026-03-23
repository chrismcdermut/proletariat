import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import Database from 'better-sqlite3'
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
  extractOrchestratorNameFromSession,
  getOrchestratorContainerId,
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
      } else {
        // No --name: discover ALL orchestrators in this HQ (host + Docker)
        const hqSessions = findHQOrchestratorSessions(hostSessions, hqName)
        const hqContainers = findHQOrchestratorContainers(hqName)

        const allSessions = [
          ...hqSessions.map(s => ({ name: extractOrchestratorNameFromSession(s, hqName) || s, value: s, isDocker: false })),
          ...hqContainers.map(c => ({ name: extractOrchestratorNameFromSession(c, hqName) || c, value: c, isDocker: true })),
        ]

        if (allSessions.length === 1) {
          sessionName = allSessions[0].value
          orchestratorName = allSessions[0].name
          isDockerSession = allSessions[0].isDocker
        } else if (allSessions.length > 1) {
          const sessionChoices = allSessions.map(s => ({
            name: `${s.name}${s.isDocker ? ' (Docker)' : ''}`,
            value: s.value,
            command: `prlt orchestrator stop --name "${s.name}" --force --json`,
          }))
          const selectMessage = 'Multiple orchestrator sessions found. Select one to stop:'

          if (jsonMode) {
            outputPromptAsJson(
              buildPromptConfig('list', 'session', selectMessage, sessionChoices),
              createMetadata('orchestrator stop', flags),
            )
            return
          }

          const { session } = await this.prompt<{ session: string }>([{
            type: 'list',
            name: 'session',
            message: selectMessage,
            choices: sessionChoices,
          }])
          sessionName = session
          const matched = allSessions.find(s => s.value === session)
          orchestratorName = matched?.name
          isDockerSession = matched?.isDocker || false
        }
        // If 0 found, fall through to global discovery below
      }
    }

    // If not in HQ or session not found, discover running orchestrator sessions globally
    if (!sessionName) {
      const runningSessions = findRunningOrchestratorSessions(hostSessions)
      const runningContainers = findRunningOrchestratorContainers()

      const allSessions = [
        ...runningSessions.map(s => ({ name: s, value: s, isDocker: false })),
        ...runningContainers.map(c => ({ name: `${c} (Docker)`, value: c, isDocker: true })),
      ]

      if (allSessions.length === 0) {
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
      } else if (allSessions.length === 1) {
        sessionName = allSessions[0].value
        isDockerSession = allSessions[0].isDocker
      } else {
        // Multiple sessions — let user pick
        const sessionChoices = allSessions.map(s => ({
          name: s.name,
          value: s.value,
          command: `prlt orchestrator stop --name "${s.value}" --force --json`,
        }))
        const selectMessage = 'Multiple orchestrator sessions found. Select one to stop:'

        if (jsonMode) {
          outputPromptAsJson(
            buildPromptConfig('list', 'session', selectMessage, sessionChoices),
            createMetadata('orchestrator stop', flags),
          )
          return
        }

        const { session } = await this.prompt<{ session: string }>([{
          type: 'list',
          name: 'session',
          message: selectMessage,
          choices: sessionChoices,
        }])
        sessionName = session
        const matched = allSessions.find(s => s.value === session)
        isDockerSession = matched?.isDocker || false
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
      const dbPath = path.join(hqPath, '.proletariat', 'workspace.db')
      if (fs.existsSync(dbPath)) {
        let db: Database.Database | null = null
        try {
          db = new Database(dbPath)
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
}
