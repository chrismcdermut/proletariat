import { Command, Args, Flags } from '@oclif/core'
import * as path from 'path'
import { execSync } from 'child_process'
import inquirer from 'inquirer'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'

export default class ExecutionStop extends Command {
  static description = 'Stop a running execution'

  static examples = [
    '<%= config.bin %> <%= command.id %> WORK-001',
    '<%= config.bin %> <%= command.id %> WORK-001 --force',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ]

  static args = {
    id: Args.string({
      description: 'Execution ID - prompts if not provided',
      required: false,
    }),
  }

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Force kill (SIGKILL instead of SIGTERM)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ExecutionStop)

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch (error) {
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    const executionStorage = new ExecutionStorage(db)

    try {
      // Get execution ID - prompt if not provided
      let execId = args.id

      if (!execId) {
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
          db.close()
          this.log(styles.muted('\nNo running executions found.\n'))
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
        execId = selectedId
      }

      // Get execution
      const execution = executionStorage.getExecution(execId!)
      if (!execution) {
        db.close()
        this.error(`Execution "${execId}" not found.`)
      }

      // Check if already stopped
      if (!['starting', 'running'].includes(execution.status)) {
        db.close()
        this.log(
          styles.muted(
            `\nExecution ${execId} is not running (status: ${execution.status}).\n`
          )
        )
        return
      }

      // Stop based on mode
      this.log('')
      this.log(styles.muted(`Stopping ${execution.id}...`))

      let stopped = false

      try {
        switch (execution.mode) {
          case 'foreground':
          case 'background':
            if (execution.pid) {
              const signal = flags.force ? 'SIGKILL' : 'SIGTERM'
              try {
                process.kill(parseInt(execution.pid), signal)
                stopped = true
              } catch (e) {
                // Process may have already exited
                stopped = true
              }
            }
            break

          case 'tmux':
            if (execution.sessionId) {
              try {
                // Try to kill the tmux window
                const [session, window] = execution.sessionId.split(':')
                execSync(`tmux kill-window -t ${session}:${window}`, {
                  stdio: 'pipe',
                })
                stopped = true
              } catch {
                // Window may not exist
                stopped = true
              }
            }
            break

          case 'terminal':
            // Can't reliably stop a terminal window, just mark as stopped
            this.warn('Cannot automatically stop Terminal windows. Please close manually.')
            stopped = true
            break

          case 'docker':
          case 'devcontainer':
            if (execution.containerId) {
              if (!isDockerRunning()) {
                this.warn('Docker is not running. Cannot stop container.')
                stopped = true
              } else {
                try {
                  const cmd = flags.force
                    ? `docker kill ${execution.containerId}`
                    : `docker stop ${execution.containerId}`
                  execSync(cmd, { stdio: 'pipe' })
                  stopped = true
                } catch {
                  // Container may have already stopped
                  stopped = true
                }
              }
            }
            break

          case 'vm':
            if (execution.host && execution.sessionId) {
              this.warn(
                `Cannot automatically stop VM execution. SSH to ${execution.host} and stop manually.`
              )
              stopped = true
            }
            break

          default:
            this.warn(`Unknown mode: ${execution.mode}`)
            stopped = true
        }
      } catch (error) {
        this.warn(`Error stopping execution: ${error instanceof Error ? error.message : error}`)
        stopped = true
      }

      if (stopped) {
        // Update execution status
        executionStorage.updateStatus(execution.id, 'stopped')

        this.log('')
        this.log(styles.success(`✓ Stopped execution ${execution.id}`))
        this.log(styles.muted(`   Ticket: ${execution.ticketId}`))
        this.log(styles.muted(`   Agent: ${execution.agentName}`))
        this.log('')
      }

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }
}
