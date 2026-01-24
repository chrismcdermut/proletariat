import { Args, Command, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import inquirer from 'inquirer'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import { resolveContainerId, containerExists, sanitizeContainerId } from '../../lib/docker/resolve.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
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
    const { args, flags } = await this.parse(DockerRestart)

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

      // Check if container exists
      if (!containerExists(result.containerId)) {
        db.close()
        this.error(`Container ${result.displayName} does not exist`)
      }

      this.log(`\n${styles.header('Restart Container')}`)
      this.log(styles.muted(`Target: ${result.displayName}`))
      this.log(styles.muted(`Container: ${result.containerId.substring(0, 12)}\n`))

      // Confirm
      if (!flags.force) {
        // Check if JSON output mode is active
        const jsonMode = shouldOutputJson(flags)

        // Build choices once, use for both JSON and interactive modes
        const confirmChoices = [
          { name: 'Yes', value: 'true' },
          { name: 'No', value: 'false' },
        ]
        const confirmMessage = `Restart container ${result.displayName}?`

        // In JSON mode, output confirmation prompt
        if (jsonMode) {
          outputPromptAsJson(
            buildPromptConfig('list', 'confirmed', confirmMessage, confirmChoices),
            createMetadata('docker restart', flags)
          )
          db.close()
          return
        }

        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: confirmMessage,
            default: true,
          },
        ])

        if (!confirm) {
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
