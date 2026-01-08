import { Args, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import inquirer from 'inquirer'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'

export default class ExecutionLogs extends PMOCommand {
  static description = 'View execution logs'

  static examples = [
    '<%= config.bin %> <%= command.id %> WORK-001',
    '<%= config.bin %> <%= command.id %> WORK-001 --follow',
    '<%= config.bin %> <%= command.id %> WORK-001 --tail 50',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ]

  static args = {
    id: Args.string({
      description: 'Execution ID - prompts if not provided',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    follow: Flags.boolean({
      char: 'f',
      description: 'Stream logs in real-time',
      default: false,
    }),
    tail: Flags.integer({
      char: 'n',
      description: 'Show last n lines',
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ExecutionLogs)

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
      // Get execution ID - prompt if not provided
      let execId = args.id

      if (!execId) {
        const executions = executionStorage.listExecutions({ limit: 20 })

        if (executions.length === 0) {
          this.error('No executions found.')
        }

        const { selectedId } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedId',
            message: 'Select execution to view logs:',
            choices: executions.map((e) => ({
              name: `${e.id} - ${e.ticketId} (${e.agentName}, ${e.status})`,
              value: e.id,
            })),
          },
        ])
        execId = selectedId
      }

      // Get execution
      const execution = executionStorage.getExecution(execId!)
      if (!execution) {
        this.error(`Execution "${execId}" not found.`)
      }

      // Check for log file
      if (!execution.logPath) {
        this.log(styles.muted(`\nNo log file for execution ${execId}`))
        this.log(styles.muted(`Mode: ${execution.mode}`))

        if (execution.mode === 'tmux' && execution.sessionId) {
          this.log('')
          this.log(styles.muted('View in tmux:'))
          this.log(styles.muted(`  tmux attach -t ${execution.sessionId}`))
        } else if (execution.mode === 'docker' && execution.containerId) {
          this.log('')
          this.log(styles.muted('View docker logs:'))
          this.log(styles.muted(`  docker logs -f ${execution.containerId}`))
        }
        this.log('')
        return
      }

      // Check if log file exists
      if (!fs.existsSync(execution.logPath)) {
        this.error(`Log file not found: ${execution.logPath}`)
      }

      // Display logs
      this.log('')
      this.log(
        styles.header(`📜 Logs for ${execution.id} (${execution.ticketId})`)
      )
      this.log(styles.muted(`   Log file: ${execution.logPath}`))
      this.log('')

      if (flags.follow) {
        // Stream logs with tail -f
        const tailProcess = spawn('tail', ['-f', execution.logPath], {
          stdio: 'inherit',
        })

        // Handle Ctrl+C
        process.on('SIGINT', () => {
          tailProcess.kill()
          process.exit(0)
        })

        await new Promise((resolve) => {
          tailProcess.on('close', resolve)
        })
      } else if (flags.tail) {
        // Show last n lines
        const tailProcess = spawn('tail', ['-n', flags.tail.toString(), execution.logPath], {
          stdio: 'inherit',
        })

        await new Promise((resolve) => {
          tailProcess.on('close', resolve)
        })
      } else {
        // Show entire file
        const content = fs.readFileSync(execution.logPath, 'utf-8')
        this.log(content)
      }
    } finally {
      db.close()
    }
  }
}
