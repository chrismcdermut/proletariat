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
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { getHostTmuxSessionNames } from '../../lib/execution/session-utils.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { buildOrchestratorSessionName } from './start.js'
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
    // Resolve HQ for scoped session name
    const hqPath = findHQRoot(process.cwd())
    if (!hqPath) {
      if (jsonMode) {
        outputErrorAsJson('NO_HQ', 'Not in an HQ workspace. Run "prlt init" first.', createMetadata('orchestrator stop', flags))
        return
      }
      this.error('Not in an HQ workspace. Run "prlt init" first.')
    }
    const hqName = getHeadquartersNameFromPath(hqPath)
    const sessionName = buildOrchestratorSessionName(hqName, flags.name || 'main')

    // Check if orchestrator session exists
    const hostSessions = getHostTmuxSessionNames()
    if (!hostSessions.includes(sessionName)) {
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

    // Confirm unless --force
    if (!flags.force && !jsonMode) {
      const { confirmed } = await this.prompt<{ confirmed: boolean }>([{
        type: 'list',
        name: 'confirmed',
        message: 'Stop the orchestrator?',
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

    // Update execution record to stopped
    const dbPath = path.join(hqPath, '.proletariat', 'workspace.db')
    if (fs.existsSync(dbPath)) {
      let db: Database.Database | null = null
      try {
        db = new Database(dbPath)
        const executionStorage = new ExecutionStorage(db)
        const running = executionStorage.listExecutions({ agentName: 'orchestrator', status: 'running' })
        const starting = executionStorage.listExecutions({ agentName: 'orchestrator', status: 'starting' })
        for (const exec of [...running, ...starting]) {
          executionStorage.updateStatus(exec.id, 'stopped')
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
}
