import { Command, Flags } from '@oclif/core'
import { execSync } from 'child_process'
import * as path from 'path'
import Database from 'better-sqlite3'
import inquirer from 'inquirer'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import { sanitizeContainerId } from '../../lib/docker/resolve.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

interface OrphanedContainer {
  id: string
  name: string
  status: string
  agentDir: string
  reason: string
}

export default class DockerClean extends Command {
  static description = 'Remove orphaned containers (containers without running agents)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ]

  static flags = {
    force: Flags.boolean({
      char: 'f',
      aliases: ['yes', 'y'],
      description: 'Skip confirmation prompt',
      default: false,
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Show what would be removed without removing',
      default: false,
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Remove all stopped devcontainers (not just orphaned)',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(DockerClean)

    // Check Docker status first
    if (!isDockerRunning()) {
      this.log(`\n${styles.error('Docker is not running')}`)
      this.log(`${styles.muted('Start Docker Desktop or the Docker daemon first.')}\n`)
      return
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
      // Find orphaned containers
      const orphanedContainers = this.findOrphanedContainers(
        executionStorage,
        workspaceInfo.agentsPath,
        flags.all
      )

      if (orphanedContainers.length === 0) {
        this.log(`\n${styles.success('No orphaned containers found.')}\n`)
        db.close()
        return
      }

      // Display orphaned containers
      this.log(`\n${styles.header('Orphaned Containers')}`)
      this.log('='.repeat(80))
      this.log(styles.muted(
        padEnd('Container ID', 15) +
        padEnd('Name', 30) +
        padEnd('Status', 15) +
        'Reason'
      ))
      this.log('-'.repeat(80))

      for (const container of orphanedContainers) {
        this.log(
          padEnd(container.id, 15) +
          padEnd(truncate(container.name, 28), 30) +
          padEnd(container.status, 15) +
          styles.muted(container.reason)
        )
      }

      if (flags['dry-run']) {
        this.log(`\n${styles.warning(`[DRY RUN] Would remove ${orphanedContainers.length} container(s)`)}\n`)
        db.close()
        return
      }

      // Confirm removal
      if (!flags.force) {
        // Check if JSON output mode is active
        const jsonMode = shouldOutputJson(flags)

        // Build choices once, use for both JSON and interactive modes
        const confirmChoices = [
          { name: 'No', value: 'false' },
          { name: 'Yes', value: 'true' },
        ]
        const confirmMessage = `Remove ${orphanedContainers.length} orphaned container(s)?`

        // In JSON mode, output confirmation prompt
        if (jsonMode) {
          outputPromptAsJson(
            buildPromptConfig('list', 'confirmed', confirmMessage, confirmChoices),
            createMetadata('docker clean', flags)
          )
          db.close()
          return
        }

        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: confirmMessage,
            default: false,
          },
        ])

        if (!confirm) {
          this.log(`\n${styles.muted('Aborted.')}\n`)
          db.close()
          return
        }
      }

      // Remove containers
      let removed = 0
      let failed = 0

      for (const container of orphanedContainers) {
        try {
          const safeId = sanitizeContainerId(container.id)

          // Stop container if running
          if (container.status.includes('Up')) {
            this.log(styles.muted(`Stopping ${container.id}...`))
            execSync(`docker stop ${safeId}`, {
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: 30000,
            })
          }

          // Remove container
          this.log(styles.muted(`Removing ${container.id}...`))
          execSync(`docker rm ${safeId}`, {
            stdio: ['pipe', 'pipe', 'pipe'],
          })

          removed++
        } catch (error) {
          this.log(styles.error(`Failed to remove ${container.id}: ${error instanceof Error ? error.message : error}`))
          failed++
        }
      }

      if (removed > 0) {
        this.log(`\n${styles.success(`Removed ${removed} container(s)`)}`)
      }
      if (failed > 0) {
        this.log(styles.error(`Failed to remove ${failed} container(s)`))
      }
      this.log('')

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }

  private findOrphanedContainers(
    executionStorage: ExecutionStorage,
    agentsPath: string,
    includeAllStopped: boolean
  ): OrphanedContainer[] {
    const orphaned: OrphanedContainer[] = []

    try {
      // Get all devcontainers
      const output = execSync(
        'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.Label \\"devcontainer.local_folder\\"}}"',
        {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      ).trim()

      if (!output) return []

      // Get running executions from database
      const runningExecutions = executionStorage.listExecutions({ status: 'running' })
      const startingExecutions = executionStorage.listExecutions({ status: 'starting' })
      const activeExecutions = [...runningExecutions, ...startingExecutions]

      const lines = output.split('\n')

      for (const line of lines) {
        const [id, name, status, agentDir] = line.split('|')

        // Only consider devcontainers (have agentDir label)
        if (!agentDir) continue

        const isRunning = status.includes('Up')
        const isStopped = !isRunning

        // Check if this container has an active execution
        const hasActiveExecution = activeExecutions.some(
          exec => exec.containerId && (
            exec.containerId === id ||
            exec.containerId.startsWith(id) ||
            id.startsWith(exec.containerId)
          )
        )

        // Skip healthy containers (running with active execution)
        if (isRunning && hasActiveExecution) continue

        // Skip normal stopped containers unless --all flag
        if (isStopped && !hasActiveExecution && !includeAllStopped) continue

        // Remaining containers are orphaned - determine reason
        const reason = isStopped
          ? hasActiveExecution
            ? 'Container stopped but execution active'
            : 'Stopped devcontainer'
          : 'No active execution'

        orphaned.push({
          id,
          name,
          status: status.split(' ').slice(0, 2).join(' '),
          agentDir,
          reason,
        })
      }

      return orphaned
    } catch {
      return []
    }
  }
}

function padEnd(str: string, length: number): string {
  return str.padEnd(length)
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength - 2) + '..'
}
