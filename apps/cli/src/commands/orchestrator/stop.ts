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
  findRunningOrchestratorSessions,
  findHQOrchestratorSessions,
  extractOrchestratorNameFromSession,
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

    // Resolve session name: try HQ-scoped first, fall back to discovery
    let sessionName: string | undefined
    let orchestratorName: string | undefined
    const hqPath = findHQRoot(process.cwd())

    if (hqPath) {
      const hqName = getHeadquartersNameFromPath(hqPath)

      if (flags.name) {
        // Explicit --name: look for that specific orchestrator
        sessionName = buildOrchestratorSessionName(hqName, flags.name)
        orchestratorName = flags.name
        if (!hostSessions.includes(sessionName)) {
          sessionName = undefined
        }
      } else {
        // No --name: discover ALL orchestrators in this HQ
        const hqSessions = findHQOrchestratorSessions(hostSessions, hqName)
        if (hqSessions.length === 1) {
          sessionName = hqSessions[0]
          orchestratorName = extractOrchestratorNameFromSession(hqSessions[0], hqName) || undefined
        } else if (hqSessions.length > 1) {
          const sessionChoices = hqSessions.map(s => ({
            name: extractOrchestratorNameFromSession(s, hqName) || s,
            value: s,
            command: `prlt orchestrator stop --name "${extractOrchestratorNameFromSession(s, hqName) || s}" --force --json`,
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
          orchestratorName = extractOrchestratorNameFromSession(session, hqName) || undefined
        }
        // If 0 found, fall through to global discovery below
      }
    }

    // If not in HQ or session not found, discover running orchestrator sessions globally
    if (!sessionName) {
      const runningSessions = findRunningOrchestratorSessions(hostSessions)
      if (runningSessions.length === 0) {
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
      } else if (runningSessions.length === 1) {
        sessionName = runningSessions[0]
      } else {
        // Multiple sessions — let user pick
        const sessionChoices = runningSessions.map(s => ({
          name: s,
          value: s,
          command: `prlt orchestrator stop --name "${s}" --force --json`,
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
        message: `Stop the orchestrator (${sessionName})?`,
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

    // Kill the tmux session
    try {
      execSync(`tmux kill-session -t "${sessionName}"`, { stdio: 'pipe' })
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
