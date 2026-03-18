import { Flags } from '@oclif/core'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import {
  cleanupContainer,
  findDeadContainers,
  type ContainerCleanupResult,
  type CleanupSummary,
} from '../../lib/execution/container-cleanup.js'
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js'
import { machineOutputFlags } from '../../lib/pmo/base-command.js'
import {
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import { Command } from '@oclif/core'
import { visualPadEnd } from '../../lib/string-utils.js'
import { execSync } from 'node:child_process'

export default class SessionCleanup extends Command {
  static description = 'Clean up dead Docker containers from completed agent work'

  static examples = [
    '<%= config.bin %> session cleanup',
    '<%= config.bin %> session cleanup --force',
    '<%= config.bin %> session cleanup --dry-run',
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
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(SessionCleanup)
    const jsonMode = shouldOutputJson(flags)

    // Check Docker status first
    if (!isDockerRunning()) {
      if (jsonMode) {
        outputErrorAsJson('DOCKER_NOT_RUNNING', 'Docker is not running.', createMetadata('session cleanup', flags))
        return
      }
      this.log(`\n${styles.error('Docker is not running')}`)
      this.log(`${styles.muted('Start Docker Desktop or the Docker daemon first.')}\n`)
      return
    }

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('session cleanup', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    let db: Database.Database
    try {
      db = new Database(dbPath)
    } catch {
      if (jsonMode) {
        outputErrorAsJson('DB_ERROR', 'Could not open workspace database.', createMetadata('session cleanup', flags))
        return
      }
      this.error('Could not open workspace database.')
    }

    const executionStorage = new ExecutionStorage(db)

    try {
      // First, clean up any stale execution records
      const staleCleaned = executionStorage.cleanupStaleExecutions()
      if (staleCleaned > 0 && !jsonMode) {
        this.log(styles.muted(`Cleaned ${staleCleaned} stale execution record(s)`))
      }

      // Get active execution container IDs
      const activeExecutions = [
        ...executionStorage.listExecutions({ status: 'running' }),
        ...executionStorage.listExecutions({ status: 'starting' }),
      ]
      const activeContainerIds = new Set<string>(
        activeExecutions
          .filter(e => e.containerId)
          .map(e => e.containerId!)
      )

      // Find dead containers
      const deadContainerIds = findDeadContainers(activeContainerIds)

      if (deadContainerIds.length === 0) {
        if (jsonMode) {
          outputSuccessAsJson({
            message: 'No dead containers found.',
            staleCleaned,
            containersRemoved: 0,
          }, createMetadata('session cleanup', flags))
          db.close()
          return
        }
        this.log(`\n${styles.success('No dead containers found.')}`)
        if (staleCleaned > 0) {
          this.log(styles.muted(`(${staleCleaned} stale execution record(s) were cleaned)`))
        }
        this.log('')
        db.close()
        return
      }

      // Get container details for display
      const containerDetails: Array<{ id: string; name: string; status: string; image: string }> = []
      for (const containerId of deadContainerIds) {
        try {
          const info = execSync(
            `docker inspect --format '{{.Name}}|{{.State.Status}}|{{.Config.Image}}' ${containerId}`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
          ).trim()
          const [name, status, image] = info.split('|')
          containerDetails.push({
            id: containerId,
            name: (name || '').replace(/^\//, ''),
            status: status || 'unknown',
            image: image || 'unknown',
          })
        } catch {
          containerDetails.push({
            id: containerId,
            name: 'unknown',
            status: 'unknown',
            image: 'unknown',
          })
        }
      }

      // Display dead containers
      if (!jsonMode) {
        this.log(`\n${styles.header('Dead Containers')}`)
        this.log('='.repeat(80))
        this.log(styles.muted(
          visualPadEnd('Container ID', 15) +
          visualPadEnd('Name', 35) +
          visualPadEnd('Status', 12) +
          'Image'
        ))
        this.log('-'.repeat(80))

        for (const c of containerDetails) {
          this.log(
            visualPadEnd(c.id.substring(0, 12), 15) +
            visualPadEnd(truncate(c.name, 33), 35) +
            visualPadEnd(c.status, 12) +
            styles.muted(truncate(c.image, 18))
          )
        }
      }

      if (flags['dry-run']) {
        if (jsonMode) {
          outputSuccessAsJson({
            message: `[DRY RUN] Would remove ${deadContainerIds.length} dead container(s)`,
            dryRun: true,
            staleCleaned,
            containers: containerDetails,
          }, createMetadata('session cleanup', flags))
          db.close()
          return
        }
        this.log(`\n${styles.warning(`[DRY RUN] Would remove ${deadContainerIds.length} container(s)`)}\n`)
        db.close()
        return
      }

      // Confirm removal
      if (!flags.force) {
        const resolver = new FlagResolver<{ confirmed?: boolean; machine?: boolean; json?: boolean }>({
          commandName: 'session cleanup',
          baseCommand: 'prlt session cleanup',
          jsonMode,
          flags,
        })

        resolver.addPrompt({
          flagName: 'confirmed',
          type: 'list',
          message: `Remove ${deadContainerIds.length} dead container(s)?`,
          choices: () => [
            { name: 'Yes', value: true },
            { name: 'No', value: false },
          ],
        })

        const resolved = await resolver.resolve()

        if (!resolved.confirmed) {
          if (!jsonMode) {
            this.log(`\n${styles.muted('Aborted.')}\n`)
          }
          db.close()
          return
        }
      }

      // Remove containers
      const summary: CleanupSummary = {
        attempted: 0,
        stopped: 0,
        removed: 0,
        failed: 0,
        results: [],
      }

      for (const containerId of deadContainerIds) {
        summary.attempted++
        if (!jsonMode) {
          this.log(styles.muted(`Cleaning up ${containerId.substring(0, 12)}...`))
        }

        const result = cleanupContainer(containerId)
        summary.results.push(result)

        if (result.stopped) summary.stopped++
        if (result.removed) summary.removed++
        if (result.error) {
          summary.failed++
          if (!jsonMode) {
            this.log(styles.error(`  Failed: ${result.error}`))
          }
        }
      }

      if (jsonMode) {
        outputSuccessAsJson({
          message: `Removed ${summary.removed} dead container(s)`,
          staleCleaned,
          ...summary,
        }, createMetadata('session cleanup', flags))
      } else {
        if (summary.removed > 0) {
          this.log(`\n${styles.success(`Removed ${summary.removed} container(s)`)}`)
        }
        if (summary.stopped > 0) {
          this.log(styles.muted(`Stopped ${summary.stopped} running container(s)`))
        }
        if (summary.failed > 0) {
          this.log(styles.error(`Failed to remove ${summary.failed} container(s)`))
        }
        this.log('')
      }

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength - 2) + '..'
}
