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
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { MachineDB } from '../../lib/machine-db.js'
import {
  collectAllSessions,
  groupSessionsByHQ,
  tildifyPath,
  type UnifiedSession,
} from '../../lib/session/renderer.js'

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
      description: 'Name of the orchestrator to stop (matches agentName)',
    }),
    here: Flags.boolean({
      description: 'Filter to orchestrators in the current HQ only',
      default: false,
      exclusive: ['hq'],
    }),
    hq: Flags.string({
      description: 'Filter to orchestrators in a specific HQ path',
      exclusive: ['here'],
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

    // Resolve HQ filter
    let hqPathFilter: string | undefined
    if (flags.here) {
      const cwdHq = findHQRoot(process.cwd())
      if (cwdHq) hqPathFilter = cwdHq
    } else if (flags.hq) {
      hqPathFilter = flags.hq
    }

    // Always query machine-wide for orchestrators.
    let orchestrators = collectAllSessions({
      hqPathFilter,
      roleFilter: 'orchestrator',
      includeAll: false,
    })

    // Optional --name filter
    if (flags.name) {
      const needle = flags.name.toLowerCase()
      orchestrators = orchestrators.filter(
        s =>
          s.agentName.toLowerCase() === needle ||
          s.agentName.toLowerCase().includes(needle) ||
          s.sessionId.toLowerCase().includes(needle),
      )
    }

    if (orchestrators.length === 0) {
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

    // Pick a single orchestrator. Prefer current-HQ when multiple exist.
    let picked: UnifiedSession | undefined
    if (orchestrators.length === 1) {
      picked = orchestrators[0]
    } else {
      const grouped = groupSessionsByHQ(orchestrators)
      const ordered: UnifiedSession[] = [...grouped.here, ...grouped.elsewhere]

      const selectMessage = 'Multiple orchestrator sessions found. Select one to stop:'
      const sessionChoices = ordered.map(s => {
        const hqLabel = s.hqPath ? tildifyPath(s.hqPath) : '(no HQ)'
        const tag = s.environment === 'container' ? ' (Docker)' : ''
        return {
          name: `${s.agentName}${tag} — ${hqLabel}`,
          value: s.sessionId,
          command: `prlt orchestrator stop --name "${s.agentName}" --force --json`,
        }
      })

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'session', selectMessage, sessionChoices),
          createMetadata('orchestrator stop', flags),
        )
        return
      }

      // Print a grouped preview banner above the picker.
      if (grouped.currentHq) {
        this.log('')
        this.log(
          styles.header(
            `Current HQ: ${tildifyPath(grouped.currentHq)} (${grouped.here.length} orchestrator${grouped.here.length === 1 ? '' : 's'})`,
          ),
        )
      }
      if (grouped.elsewhere.length > 0) {
        this.log(
          styles.muted(
            `Other locations: ${grouped.elsewhere.length} orchestrator${grouped.elsewhere.length === 1 ? '' : 's'}`,
          ),
        )
      }

      const { session } = await this.prompt<{ session: string }>([{
        type: 'list',
        name: 'session',
        message: selectMessage,
        choices: sessionChoices,
      }])
      picked = ordered.find(s => s.sessionId === session)
    }

    if (!picked) {
      return
    }

    const sessionName: string = picked.sessionId
    const isDockerSession = picked.environment === 'container'
    const orchestratorName: string | undefined = picked.agentName
    const hqPath: string | null = picked.hqPath ?? findHQRoot(process.cwd())

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

    // PRLT-1275: Update the machine.db mirror row so cross-HQ consumers
    // (e.g. prlt session list from /tmp, the renderer) see the orchestrator
    // as stopped. Non-fatal — machine.db is secondary.
    // PRLT-1265: Also deregister the orchestrator thread.
    try {
      const machineDb = new MachineDB()
      try {
        const match = machineDb.findBySessionId(sessionName)
        if (match) {
          machineDb.updateStatus(match.id, 'stopped')
        } else if (orchestratorName) {
          const rows = machineDb.getActiveByAgentPrefix(`orchestrator-${orchestratorName}`)
          for (const row of rows) {
            machineDb.updateStatus(row.id, 'stopped')
          }
        }
        // Deregister orchestrator thread
        if (orchestratorName) {
          machineDb.updateThreadStatus(orchestratorName, 'inactive')
        }
      } finally {
        machineDb.close()
      }
    } catch {
      // Non-fatal
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
