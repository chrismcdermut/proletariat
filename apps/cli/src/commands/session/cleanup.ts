import { Flags } from '@oclif/core'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import {
  listAgentContainers,
  cleanupCompletedContainers,
} from '../../lib/execution/container-cleanup.js'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  outputConfirmationNeededAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class SessionCleanup extends PromptCommand {
  static description = 'Stop and remove Docker containers for completed agents'

  static examples = [
    '<%= config.bin %> session cleanup',
    '<%= config.bin %> session cleanup --dry-run',
    '<%= config.bin %> session cleanup --force',
    '<%= config.bin %> session cleanup --force --yes',
  ]

  static flags = {
    ...machineOutputFlags,
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
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip confirmation prompt when using --force',
      default: false,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(SessionCleanup)
    const jsonMode = shouldOutputJson(flags)
    const dryRun = flags['dry-run']
    const force = flags.force
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

    // Open database
    const db = openWorkspaceDatabase(workspaceInfo.path)
    const executionStorage = new ExecutionStorage(db)

    try {
      // Always find active executions to determine which containers are still needed
      const activeAgentNames = new Set<string>()
      const runningExecutions = executionStorage.listExecutions({ status: 'running' })
      const startingExecutions = executionStorage.listExecutions({ status: 'starting' })
      for (const exec of [...runningExecutions, ...startingExecutions]) {
        activeAgentNames.add(exec.agentName)
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

      // When --force is used, confirm before killing active agents
      if (force && activeAgentNames.size > 0 && !dryRun) {
        // Find which active agents actually have containers
        const activeAgentsWithContainers = allContainers
          .filter(c => activeAgentNames.has(c.agentName))
          .map(c => c.agentName)

        if (activeAgentsWithContainers.length > 0 && !skipConfirm) {
          const agentList = activeAgentsWithContainers.join(', ')
          const count = activeAgentsWithContainers.length
          const confirmMessage = `This will kill ${count} active agent${count === 1 ? '' : 's'}: ${agentList}. Continue?`

          if (jsonMode) {
            outputConfirmationNeededAsJson(
              {
                activeAgents: activeAgentsWithContainers,
                totalContainers: allContainers.length,
              },
              `prlt session cleanup --force --yes`,
              confirmMessage,
              createMetadata('session cleanup', flags),
            )
            return
          }

          // Interactive confirmation using list selection (per CLAUDE.md UX rule)
          const { confirm } = await this.prompt<{ confirm: boolean }>([
            {
              type: 'list',
              name: 'confirm',
              message: confirmMessage,
              choices: [
                { name: 'No, cancel', value: false },
                { name: 'Yes, kill active agents and clean up', value: true },
              ],
              default: 0,
            },
          ], null)

          if (!confirm) {
            this.log(styles.muted('Operation cancelled.'))
            return
          }
        }

        // Force mode: pass empty set so all containers are cleaned
        const result = cleanupCompletedContainers(new Set<string>(), { dryRun })
        this.outputResult(result, dryRun, jsonMode, flags)
        return
      }

      // Normal mode (no --force): skip active agents automatically
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

      this.outputResult(result, dryRun, jsonMode, flags)
    } finally {
      db.close()
    }
  }

  private outputResult(
    result: { stopped: string[]; removed: string[]; errors: string[]; skipped: string[] },
    dryRun: boolean,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): void {
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
  }
}
