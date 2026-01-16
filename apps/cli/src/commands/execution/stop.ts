import { Args, Flags } from '@oclif/core'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import inquirer from 'inquirer'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import type { AgentWork } from '../../lib/execution/types.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

export default class ExecutionStop extends PMOCommand {
  static description = 'Stop running execution(s)'

  static examples = [
    '<%= config.bin %> <%= command.id %> WORK-001',
    '<%= config.bin %> <%= command.id %> WORK-001 --force',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --all --force',
    '<%= config.bin %> <%= command.id %> --agent altman',
  ]

  static args = {
    id: Args.string({
      description: 'Execution ID - prompts if not provided (ignored if --all or --agent used)',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Force kill (SIGKILL instead of SIGTERM)',
      default: false,
    }),
    all: Flags.boolean({
      description: 'Stop all running executions',
      default: false,
    }),
    agent: Flags.string({
      char: 'a',
      description: 'Stop all executions for a specific agent',
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ExecutionStop)

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    const executionStorage = new ExecutionStorage(db)

    try {
      // Determine if bulk stop or single stop
      if (flags.all || flags.agent) {
        await this.bulkStop(executionStorage, flags)
      } else {
        await this.singleStop(executionStorage, args.id, flags)
      }
    } finally {
      db.close()
    }
  }

  private async bulkStop(
    executionStorage: ExecutionStorage,
    flags: { all?: boolean; agent?: string; force?: boolean }
  ): Promise<void> {
    // Get running executions
    const runningExecutions = executionStorage.listExecutions({
      status: 'running',
      agentName: flags.agent,
      limit: 100,
    })

    const startingExecutions = executionStorage.listExecutions({
      status: 'starting',
      agentName: flags.agent,
      limit: 100,
    })

    const activeExecutions = [...runningExecutions, ...startingExecutions]

    if (activeExecutions.length === 0) {
      const scope = flags.agent ? ` for agent "${flags.agent}"` : ''
      this.log(styles.muted(`\nNo running executions found${scope}.\n`))
      return
    }

    this.log('')
    this.log(styles.header(`Stopping ${activeExecutions.length} execution(s)...`))
    this.log('')

    let stopped = 0
    let failed = 0

    for (const execution of activeExecutions) {
      try {
        const success = await this.stopExecution(execution, flags.force || false)

        if (success) {
          executionStorage.updateStatus(execution.id, 'stopped')
          this.log(styles.success(`   ✓ ${execution.id} (${execution.agentName} → ${execution.ticketId})`))
          stopped++
        }
      } catch (error) {
        this.log(styles.error(`   ✗ ${execution.id}: ${error instanceof Error ? error.message : error}`))
        failed++
      }
    }

    this.log('')
    this.log(styles.header('Summary'))
    this.log(styles.success(`   Stopped: ${stopped}`))
    if (failed > 0) {
      this.log(styles.error(`   Failed: ${failed}`))
    }
    this.log('')
  }

  private async singleStop(
    executionStorage: ExecutionStorage,
    execId: string | undefined,
    flags: { force?: boolean; json?: boolean; 'no-interactive'?: boolean }
  ): Promise<void> {
    // Get execution ID - prompt if not provided
    let id = execId

    if (!id) {
      const runningExecutions = executionStorage.listExecutions({
        status: 'running',
        limit: 50,
      })

      // Also include 'starting' status
      const startingExecutions = executionStorage.listExecutions({
        status: 'starting',
        limit: 50,
      })

      const activeExecutions = [...runningExecutions, ...startingExecutions]

      if (activeExecutions.length === 0) {
        this.log(styles.muted('\nNo running executions found.\n'))
        return
      }

      // Check if JSON output mode is active
      const jsonMode = shouldOutputJson(flags)

      // In JSON mode, output execution selection prompt
      if (jsonMode) {
        const execChoices = activeExecutions.map((e) => ({
          name: `${e.id} - ${e.ticketId} (${e.agentName}, ${e.mode})`,
          value: e.id,
        }))
        outputPromptAsJson(
          buildPromptConfig('list', 'executionId', 'Select execution to stop:', execChoices),
          createMetadata('execution stop', flags)
        )
        return
      }

      const { selectedId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedId',
          message: 'Select execution to stop:',
          choices: activeExecutions.map((e) => ({
            name: `${e.id} - ${e.ticketId} (${e.agentName}, ${e.mode})`,
            value: e.id,
          })),
        },
      ])
      id = selectedId
    }

    // Get execution
    const execution = executionStorage.getExecution(id!)
    if (!execution) {
      this.error(`Execution "${id}" not found.`)
    }

    // Check if already stopped
    if (!['starting', 'running'].includes(execution.status)) {
      this.log(
        styles.muted(
          `\nExecution ${id} is not running (status: ${execution.status}).\n`
        )
      )
      return
    }

    // Stop the execution
    this.log('')
    this.log(styles.muted(`Stopping ${execution.id}...`))

    const stopped = await this.stopExecution(execution, flags.force || false)

    if (stopped) {
      // Update execution status
      executionStorage.updateStatus(execution.id, 'stopped')

      this.log('')
      this.log(styles.success(`✓ Stopped execution ${execution.id}`))
      this.log(styles.muted(`   Ticket: ${execution.ticketId}`))
      this.log(styles.muted(`   Agent: ${execution.agentName}`))
      this.log('')
    }
  }

  private async stopExecution(execution: AgentWork, force: boolean): Promise<boolean> {
    try {
      switch (execution.mode) {
        case 'foreground':
        case 'background':
          if (execution.pid) {
            const signal = force ? 'SIGKILL' : 'SIGTERM'
            try {
              process.kill(parseInt(execution.pid), signal)
            } catch {
              // Process may have already exited
            }
          }
          return true

        case 'tmux':
          if (execution.sessionId) {
            try {
              const [session, window] = execution.sessionId.split(':')
              execSync(`tmux kill-window -t ${session}:${window}`, { stdio: 'pipe' })
            } catch {
              // Window may not exist
            }
          }
          return true

        case 'terminal':
          this.warn('Cannot automatically stop Terminal windows. Please close manually.')
          return true

        case 'docker':
        case 'devcontainer':
          if (execution.containerId) {
            if (!isDockerRunning()) {
              this.warn('Docker is not running. Cannot stop container.')
              return true
            }
            try {
              const cmd = force
                ? `docker kill ${execution.containerId}`
                : `docker stop ${execution.containerId}`
              execSync(cmd, { stdio: 'pipe' })
            } catch {
              // Container may have already stopped
            }
          }
          return true

        case 'vm':
          if (execution.host && execution.sessionId) {
            this.warn(
              `Cannot automatically stop VM execution. SSH to ${execution.host} and stop manually.`
            )
          }
          return true

        default:
          this.warn(`Unknown mode: ${execution.mode}`)
          return true
      }
    } catch (error) {
      this.warn(`Error stopping execution: ${error instanceof Error ? error.message : error}`)
      return true
    }
  }
}
