/**
 * prlt session cleanup — Clean up dead Docker containers
 *
 * Manually cleans up Docker containers that are no longer in use.
 * Finds containers that are exited/stopped or idle (no active tmux sessions)
 * and removes them.
 *
 * TKT-172 / PRLT-1005
 */

import { Flags } from '@oclif/core'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { ExecutionStorage, ContainerStorage } from '../../lib/execution/storage.js'
import {
  cleanupDeadContainers,
  cleanupIdleContainers,
  listDeadContainers,
  listIdleContainers,
  listAllProletariatContainers,
  type ContainerCleanupResult,
} from '../../lib/docker/container-cleanup.js'
import {
  getWorkspaceInfo,
} from '../../lib/agents/commands.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class SessionCleanup extends PMOCommand {
  static description = 'Clean up dead Docker containers from completed agent work'

  static examples = [
    '<%= config.bin %> session cleanup',
    '<%= config.bin %> session cleanup --dry-run',
    '<%= config.bin %> session cleanup --include-idle',
    '<%= config.bin %> session cleanup --json',
  ]

  static flags = {
    ...pmoBaseFlags,
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Show what would be cleaned without actually doing it',
      default: false,
    }),
    'include-idle': Flags.boolean({
      description: 'Also stop and remove idle running containers (no active tmux sessions)',
      default: false,
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(SessionCleanup)
    const jsonMode = shouldOutputJson(flags)
    const dryRun = flags['dry-run']
    const includeIdle = flags['include-idle']
    const skipConfirm = flags.yes

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run from a proletariat HQ directory.', createMetadata('session cleanup', flags))
        return
      }
      this.log(styles.error('Not in a workspace. Run from a proletariat HQ directory.'))
      return
    }

    // Open database to sync container records
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)

    try {
      const executionStorage = new ExecutionStorage(db)

      // Also clean up stale execution records first
      const staleCleaned = executionStorage.cleanupStaleExecutions()

      // Discover containers to clean
      const deadContainers = listDeadContainers()
      const idleContainers = includeIdle ? listIdleContainers() : []
      const totalContainers = deadContainers.length + idleContainers.length

      if (totalContainers === 0 && staleCleaned === 0) {
        if (jsonMode) {
          outputSuccessAsJson({
            message: 'No containers to clean up.',
            staleExecutionsCleaned: 0,
            containersRemoved: 0,
          }, createMetadata('session cleanup', flags))
          return
        }
        this.log('')
        this.log(styles.success('No containers to clean up. Everything is clean.'))
        this.log('')
        return
      }

      // Show what will be cleaned
      if (!jsonMode) {
        this.log('')
        this.log(styles.header(`${dryRun ? '[DRY RUN] ' : ''}Container Cleanup`))
        this.log('═'.repeat(60))

        if (staleCleaned > 0) {
          this.log(styles.info(`  ${staleCleaned} stale execution record(s) cleaned`))
        }

        if (deadContainers.length > 0) {
          this.log(styles.info(`  ${deadContainers.length} dead container(s) ${dryRun ? 'would be ' : 'to be '}removed:`))
          for (const c of deadContainers) {
            this.log(styles.muted(`    - ${c.id.substring(0, 12)} ${c.name} (${c.status})`))
          }
        }

        if (idleContainers.length > 0) {
          this.log(styles.info(`  ${idleContainers.length} idle container(s) ${dryRun ? 'would be ' : 'to be '}stopped and removed:`))
          for (const c of idleContainers) {
            this.log(styles.muted(`    - ${c.id.substring(0, 12)} ${c.name} (${c.status})`))
          }
        }
        this.log('')
      }

      // Dry run: just report
      if (dryRun) {
        if (jsonMode) {
          outputSuccessAsJson({
            message: `Would remove ${totalContainers} container(s)`,
            dryRun: true,
            staleExecutionsCleaned: staleCleaned,
            deadContainers: deadContainers.map(c => ({
              id: c.id.substring(0, 12),
              name: c.name,
              status: c.status,
            })),
            idleContainers: idleContainers.map(c => ({
              id: c.id.substring(0, 12),
              name: c.name,
              status: c.status,
            })),
          }, createMetadata('session cleanup', flags))
        }
        return
      }

      // Confirm unless --yes
      if (!skipConfirm && totalContainers > 0) {
        if (jsonMode) {
          outputSuccessAsJson({
            message: 'Confirmation required',
            preview: {
              deadContainers: deadContainers.length,
              idleContainers: idleContainers.length,
              staleExecutionsCleaned: staleCleaned,
            },
          }, createMetadata('session cleanup', flags))
          return
        }

        const { confirm } = await this.prompt<{ confirm: boolean }>([
          {
            type: 'list',
            name: 'confirm',
            message: `Remove ${totalContainers} container(s)?`,
            choices: [
              { name: 'No, cancel', value: false },
              { name: 'Yes, clean up', value: true },
            ],
            default: 0,
          },
        ], null)

        if (!confirm) {
          this.log(styles.muted('Operation cancelled.'))
          return
        }
      }

      // Perform cleanup
      let result: ContainerCleanupResult
      if (includeIdle) {
        result = cleanupIdleContainers()
      } else {
        result = cleanupDeadContainers()
      }

      // Update container records in DB
      try {
        const containerStorage = new ContainerStorage(db)
        for (const removedId of result.removed) {
          containerStorage.markRemoved(removedId)
        }
      } catch {
        // Non-fatal — DB sync failure shouldn't block cleanup reporting
      }

      // Output results
      if (jsonMode) {
        outputSuccessAsJson({
          message: `Removed ${result.removed.length} container(s)`,
          staleExecutionsCleaned: staleCleaned,
          containersRemoved: result.removed.length,
          containers: result.removed.map(id => id.substring(0, 12)),
          errors: result.errors.map(e => ({
            containerId: e.containerId.substring(0, 12),
            error: e.error,
          })),
        }, createMetadata('session cleanup', flags))
        return
      }

      // Summary
      this.log('')
      this.log(styles.header('Cleanup Summary'))
      this.log('─'.repeat(40))

      if (staleCleaned > 0) {
        this.log(styles.success(`  ${staleCleaned} stale execution(s) cleaned`))
      }

      if (result.removed.length > 0) {
        this.log(styles.success(`  ${result.removed.length} container(s) removed`))
      }

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          this.log(styles.error(`  Failed: ${err.containerId.substring(0, 12)} - ${err.error}`))
        }
      }

      if (result.removed.length === 0 && result.errors.length === 0) {
        this.log(styles.success('  No containers needed cleanup'))
      }

      this.log('')
    } finally {
      db.close()
    }
  }
}
