import { Flags } from '@oclif/core'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import {
  listAgentContainers,
  cleanupCompletedContainers,
} from '../../lib/execution/container-cleanup.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class SessionCleanup extends PMOCommand {
  static description = 'Stop and remove Docker containers for completed agents'

  static examples = [
    '<%= config.bin %> session cleanup',
    '<%= config.bin %> session cleanup --dry-run',
    '<%= config.bin %> session cleanup --force',
  ]

  static flags = {
    ...pmoBaseFlags,
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Show what would be cleaned up without actually doing it',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Remove all agent containers, including those with active executions',
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
    const force = flags.force

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

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    const executionStorage = new ExecutionStorage(db)

    try {
      // Find active executions to determine which containers are still needed
      const activeAgentNames = new Set<string>()
      if (!force) {
        const runningExecutions = executionStorage.listExecutions({ status: 'running' })
        const startingExecutions = executionStorage.listExecutions({ status: 'starting' })
        for (const exec of [...runningExecutions, ...startingExecutions]) {
          activeAgentNames.add(exec.agentName)
        }
      }

      // List all containers first for reporting
      const allContainers = listAgentContainers()

      if (allContainers.length === 0) {
        if (jsonMode) {
          outputSuccessAsJson({
            message: 'No agent containers found.',
            stopped: [],
            removed: [],
            skipped: [],
            errors: [],
          }, createMetadata('session cleanup', flags))
          return
        }
        this.log('')
        this.log(styles.success('No agent containers found. Nothing to clean up.'))
        this.log('')
        return
      }

      // Perform cleanup
      const result = cleanupCompletedContainers(activeAgentNames, { dryRun })

      if (result.removed.length === 0 && result.errors.length === 0) {
        if (jsonMode) {
          outputSuccessAsJson({
            message: 'All containers have active executions. Nothing to clean up.',
            stopped: [],
            removed: [],
            skipped: result.skipped,
            errors: [],
          }, createMetadata('session cleanup', flags))
          return
        }
        this.log('')
        this.log(styles.info('All containers have active executions. Nothing to clean up.'))
        if (result.skipped.length > 0) {
          this.log(styles.muted(`  ${result.skipped.length} container(s) skipped (active agents)`))
        }
        this.log('')
        return
      }

      // Output results
      if (jsonMode) {
        outputSuccessAsJson({
          message: `${dryRun ? 'Would remove' : 'Removed'} ${result.removed.length} container(s)`,
          dryRun,
          ...result,
        }, createMetadata('session cleanup', flags))
        return
      }

      this.log('')
      this.log(styles.header(`${dryRun ? '[DRY RUN] ' : ''}Container Cleanup`))
      this.log('═'.repeat(50))

      if (result.stopped.length > 0) {
        this.log(styles.info(`  ${result.stopped.length} container(s) ${dryRun ? 'would be ' : ''}stopped:`))
        for (const name of result.stopped) {
          this.log(styles.muted(`    - ${name}`))
        }
      }

      if (result.removed.length > 0) {
        this.log(styles.success(`  ${result.removed.length} container(s) ${dryRun ? 'would be ' : ''}removed:`))
        for (const name of result.removed) {
          this.log(styles.muted(`    - ${name}`))
        }
      }

      if (result.skipped.length > 0) {
        this.log(styles.muted(`  ${result.skipped.length} container(s) skipped (active agents)`))
      }

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          this.log(styles.error(`  ${err}`))
        }
      }

      this.log('')
    } finally {
      db.close()
    }
  }
}
