import { Args, Command, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import { SqliteDatabase } from '../../lib/database/sqlite.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import { resolveContainerId, containerExists, sanitizeContainerId } from '../../lib/docker/resolve.js'
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js'
import { machineOutputFlags } from '../../lib/pmo/base-command.js'
import { outputErrorAsJson, createMetadata } from '../../lib/prompt-json.js'

export default class DockerRestart extends Command {
  static description = 'Restart a container (by execution ID, agent name, or container ID)'

  static examples = [
    '<%= config.bin %> <%= command.id %> WORK-001',
    '<%= config.bin %> <%= command.id %> kalanick',
    '<%= config.bin %> <%= command.id %> abc123 --force',
  ]

  static flags = {
    force: Flags.boolean({
      char: 'f',
      aliases: ['yes', 'y'],
      description: 'Skip confirmation prompt',
      default: false,
    }),
    time: Flags.integer({
      char: 't',
      description: 'Seconds to wait before killing the container during stop',
      default: 10,
    }),
    ...machineOutputFlags,
  }

  static args = {
    target: Args.string({
      description: 'Execution ID (WORK-XXX), agent name, or container ID',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DockerRestart)

    const jsonMode = shouldOutputJson(flags)

    if (!isDockerRunning()) {
      if (jsonMode) {
        outputErrorAsJson('DOCKER_NOT_RUNNING', 'Docker is not running. Start Docker Desktop or the Docker daemon first.', createMetadata('docker restart', flags))
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
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('docker restart', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    let db: SqliteDatabase
    try {
      db = new SqliteDatabase(dbPath)
    } catch {
      if (jsonMode) {
        outputErrorAsJson('DB_ERROR', 'Could not open workspace database.', createMetadata('docker restart', flags))
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
          outputErrorAsJson('CONTAINER_NOT_FOUND', result.error || 'Could not find container', createMetadata('docker restart', flags))
          return
        }
        this.error(result.error || 'Could not find container')
      }

      // Check if container exists
      if (!containerExists(result.containerId)) {
        db.close()
        if (jsonMode) {
          outputErrorAsJson('CONTAINER_NOT_FOUND', `Container ${result.displayName} does not exist`, createMetadata('docker restart', flags))
          return
        }
        this.error(`Container ${result.displayName} does not exist`)
      }

      this.log(`\n${styles.header('Restart Container')}`)
      this.log(styles.muted(`Target: ${result.displayName}`))
      this.log(styles.muted(`Container: ${result.containerId.substring(0, 12)}\n`))

      // Confirm
      if (!flags.force) {
        const resolver = new FlagResolver<{ confirmed?: boolean; machine?: boolean; json?: boolean }>({
          commandName: 'docker restart',
          baseCommand: `prlt docker restart ${args.target}`,
          jsonMode: shouldOutputJson(flags),
          flags,
        })

        resolver.addPrompt({
          flagName: 'confirmed',
          type: 'list',
          message: `Restart container ${result.displayName}?`,
          choices: () => [
            { name: 'Yes', value: true },
            { name: 'No', value: false },
          ],
        })

        const resolved = await resolver.resolve()

        if (!resolved.confirmed) {
          this.log(`${styles.muted('Aborted.')}\n`)
          db.close()
          return
        }
      }

      // Restart container
      this.log(styles.muted(`Restarting container (timeout: ${flags.time}s)...`))

      try {
        const safeId = sanitizeContainerId(result.containerId)
        execSync(`docker restart -t ${flags.time} ${safeId}`, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: (flags.time + 30) * 1000, // Extra time for startup
        })

        this.log(`${styles.success('Container restarted successfully')}\n`)
      } catch (error) {
        this.log(`${styles.error(`Failed to restart container: ${error instanceof Error ? error.message : error}`)}\n`)
      }
      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }
}
