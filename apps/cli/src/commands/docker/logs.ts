import { Args, Command, Flags } from '@oclif/core'
import { execSync, spawn } from 'child_process'
import * as path from 'path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import { resolveContainerId } from '../../lib/docker/resolve.js'

export default class DockerLogs extends Command {
  static description = 'View logs from a container (by execution ID, agent name, or container ID)'

  static examples = [
    '<%= config.bin %> <%= command.id %> WORK-001',
    '<%= config.bin %> <%= command.id %> kalanick',
    '<%= config.bin %> <%= command.id %> abc123 --follow',
    '<%= config.bin %> <%= command.id %> WORK-001 --tail 100',
  ]

  static flags = {
    follow: Flags.boolean({
      char: 'f',
      description: 'Follow log output',
      default: false,
    }),
    tail: Flags.integer({
      char: 'n',
      description: 'Number of lines to show from the end',
      default: 100,
    }),
    timestamps: Flags.boolean({
      char: 't',
      description: 'Show timestamps',
      default: false,
    }),
  }

  static args = {
    target: Args.string({
      description: 'Execution ID (WORK-XXX), agent name, or container ID',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DockerLogs)

    if (!isDockerRunning()) {
      this.error('Docker is not running. Start Docker Desktop or the Docker daemon first.')
    }

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    let db: Database.Database
    try {
      db = new Database(dbPath)
    } catch {
      this.error('Could not open workspace database.')
    }

    const executionStorage = new ExecutionStorage(db)

    try {
      const result = resolveContainerId(args.target, executionStorage)

      if (!result.containerId) {
        db.close()
        this.error(result.error || 'Could not find container')
      }

      // Build docker logs command
      const dockerArgs = ['logs']

      if (flags.follow) {
        dockerArgs.push('--follow')
      }

      if (flags.tail) {
        dockerArgs.push('--tail', String(flags.tail))
      }

      if (flags.timestamps) {
        dockerArgs.push('--timestamps')
      }

      dockerArgs.push(result.containerId)

      this.log(`\n${styles.header(`Logs for ${result.displayName}`)}`)
      this.log(styles.muted(`Container: ${result.containerId}`))
      this.log('─'.repeat(60) + '\n')

      db.close()

      if (flags.follow) {
        // Stream logs
        const proc = spawn('docker', dockerArgs, {
          stdio: 'inherit',
        })

        proc.on('error', (err) => {
          this.error(`Failed to get logs: ${err.message}`)
        })
      } else {
        // Get logs synchronously
        try {
          const output = execSync(`docker ${dockerArgs.join(' ')}`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          })
          this.log(output)
        } catch (error) {
          if (error instanceof Error && 'stderr' in error) {
            this.error(`Failed to get logs: ${(error as { stderr: string }).stderr}`)
          }
          throw error
        }
      }
    } catch (error) {
      db.close()
      throw error
    }
  }
}
