import { Args, Command, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import { resolveContainerId, isContainerRunning, sanitizeContainerId } from '../../lib/docker/resolve.js'
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js'
import { machineOutputFlags } from '../../lib/pmo/base-command.js'

export default class DockerStop extends Command {
  static description = 'Stop a running container (by execution ID, agent name, or container ID)'

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
      description: 'Seconds to wait before killing the container',
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
    const { args, flags } = await this.parse(DockerStop)

    if (!isDockerRunning()) {
      this.error('Docker is not running. Start Docker Desktop or the Docker daemon first.')
    }

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      this.error('Not in a workspace. Run "prlt new" first.')
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

      // Check if container is running
      if (!isContainerRunning(result.containerId)) {
        this.log(`\n${styles.warning(`Container ${result.displayName} is not running`)}\n`)
        db.close()
        return
      }

      this.log(`\n${styles.header('Stop Container')}`)
      this.log(styles.muted(`Target: ${result.displayName}`))
      this.log(styles.muted(`Container: ${result.containerId.substring(0, 12)}\n`))

      // Confirm
      if (!flags.force) {
        const resolver = new FlagResolver<{ confirmed?: boolean; machine?: boolean; json?: boolean }>({
          commandName: 'docker stop',
          baseCommand: `prlt docker stop ${args.target}`,
          jsonMode: shouldOutputJson(flags),
          flags,
        })

        resolver.addPrompt({
          flagName: 'confirmed',
          type: 'list',
          message: `Stop container ${result.displayName}?`,
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

      // Stop container
      this.log(styles.muted(`Stopping container (timeout: ${flags.time}s)...`))

      try {
        const safeId = sanitizeContainerId(result.containerId)
        execSync(`docker stop -t ${flags.time} ${safeId}`, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: (flags.time + 5) * 1000,
        })

        // Update execution status if we have an execution ID
        if (result.executionId) {
          executionStorage.updateStatus(result.executionId, 'stopped')
        }

        this.log(`${styles.success('Container stopped successfully')}\n`)
      } catch (error) {
        this.log(`${styles.error(`Failed to stop container: ${error instanceof Error ? error.message : error}`)}\n`)
      }
      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }
}
