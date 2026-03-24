import { Args, Command, Flags } from '@oclif/core'
import { execSync, spawn } from 'node:child_process'
import type Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import { resolveContainerId } from '../../lib/docker/resolve.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson, outputErrorAsJson, createMetadata } from '../../lib/prompt-json.js'
import { trackChildProcess } from '../../lib/signal-handler.js'

export default class DockerLogs extends Command {
  static description = 'View logs from a container (by execution ID, agent name, or container ID)'

  static examples = [
    '<%= config.bin %> <%= command.id %> WORK-001',
    '<%= config.bin %> <%= command.id %> kalanick',
    '<%= config.bin %> <%= command.id %> abc123 --follow',
    '<%= config.bin %> <%= command.id %> WORK-001 --tail 100',
  ]

  static flags = {
    ...machineOutputFlags,
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
    const jsonMode = shouldOutputJson(flags)

    if (!isDockerRunning()) {
      if (jsonMode) {
        outputErrorAsJson('DOCKER_NOT_RUNNING', 'Docker is not running. Start Docker Desktop or the Docker daemon first.', createMetadata('docker logs', flags))
        return
      }
      this.error('Docker is not running. Start Docker Desktop or the Docker daemon first.')
    }

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('docker logs', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    // Open database
    let db: Database.Database
    try {
      db = openWorkspaceDatabase(workspaceInfo.path)
    } catch {
      if (jsonMode) {
        outputErrorAsJson('DB_ERROR', 'Could not open workspace database.', createMetadata('docker logs', flags))
        return
      }
      this.error('Could not open workspace database.')
    }

    const executionStorage = new ExecutionStorage(db)

    try {
      const result = resolveContainerId(args.target, executionStorage)

      if (!result.containerId) {
        db.close()
        if (jsonMode) {
          outputErrorAsJson('CONTAINER_NOT_FOUND', result.error || 'Could not find container', createMetadata('docker logs', flags))
          return
        }
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

      if (!jsonMode) {
        this.log(`\n${styles.header(`Logs for ${result.displayName}`)}`)
        this.log(styles.muted(`Container: ${result.containerId}`))
        this.log('─'.repeat(60) + '\n')
      }

      db.close()

      if (flags.follow) {
        // Stream logs - track for cleanup on Ctrl+C
        const proc = spawn('docker', dockerArgs, {
          stdio: 'inherit',
        })

        trackChildProcess(proc)

        proc.on('error', (err) => {
          if (jsonMode) {
            outputErrorAsJson('LOGS_FAILED', `Failed to get logs: ${err.message}`, createMetadata('docker logs', flags))
            return
          }
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
            if (jsonMode) {
              outputErrorAsJson('LOGS_FAILED', `Failed to get logs: ${(error as { stderr: string }).stderr}`, createMetadata('docker logs', flags))
              return
            }
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
