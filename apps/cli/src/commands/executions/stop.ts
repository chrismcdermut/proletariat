import { Command, Flags } from '@oclif/core'
import * as path from 'path'
import { execSync } from 'child_process'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'

export default class ExecutionsStop extends Command {
  static description = 'Stop multiple running executions'

  static examples = [
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --all --force',
    '<%= config.bin %> <%= command.id %> --agent altman',
  ]

  static flags = {
    all: Flags.boolean({
      description: 'Stop all running executions',
      default: false,
    }),
    agent: Flags.string({
      char: 'a',
      description: 'Stop all executions for a specific agent',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force kill (SIGKILL instead of SIGTERM)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ExecutionsStop)

    if (!flags.all && !flags.agent) {
      this.error('Must specify --all or --agent <name>. Use "prlt execution stop <id>" to stop a single execution.')
    }

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
        db.close()
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
          let success = false

          switch (execution.mode) {
            case 'foreground':
            case 'background':
              if (execution.pid) {
                const signal = flags.force ? 'SIGKILL' : 'SIGTERM'
                try {
                  process.kill(parseInt(execution.pid), signal)
                  success = true
                } catch {
                  success = true // Process may have already exited
                }
              } else {
                success = true
              }
              break

            case 'tmux':
              if (execution.sessionId) {
                try {
                  const [session, window] = execution.sessionId.split(':')
                  execSync(`tmux kill-window -t ${session}:${window}`, { stdio: 'pipe' })
                  success = true
                } catch {
                  success = true // Window may not exist
                }
              } else {
                success = true
              }
              break

            case 'terminal':
              this.log(styles.warning(`   ${execution.id}: Cannot stop Terminal windows automatically`))
              success = true
              break

            case 'docker':
              if (execution.containerId) {
                if (!isDockerRunning()) {
                  this.log(styles.warning(`   ${execution.id}: Docker is not running, cannot stop container`))
                  success = true
                } else {
                  try {
                    const cmd = flags.force
                      ? `docker kill ${execution.containerId}`
                      : `docker stop ${execution.containerId}`
                    execSync(cmd, { stdio: 'pipe' })
                    success = true
                  } catch {
                    success = true // Container may have already stopped
                  }
                }
              } else {
                success = true
              }
              break

            case 'devcontainer':
              // For devcontainer mode, try to stop the container
              // The container name is typically based on the agent directory
              if (execution.containerId) {
                if (!isDockerRunning()) {
                  this.log(styles.warning(`   ${execution.id}: Docker is not running, cannot stop container`))
                  success = true
                } else {
                  try {
                    const cmd = flags.force
                      ? `docker kill ${execution.containerId}`
                      : `docker stop ${execution.containerId}`
                    execSync(cmd, { stdio: 'pipe' })
                    success = true
                  } catch {
                    success = true
                  }
                }
              } else {
                success = true
              }
              break

            default:
              success = true
          }

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

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }
}
