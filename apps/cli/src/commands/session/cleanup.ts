/**
 * prlt session cleanup — Remove dead Docker containers
 *
 * PRLT-1005: Docker containers sit idle at 0% CPU forever after agents finish.
 * This command finds containers with no active tmux sessions (agent completed)
 * and stops + removes them.
 *
 * Cleanup is triggered by agent completion events automatically, but this
 * command provides a manual escape hatch for clearing dead containers.
 */

import { Flags } from '@oclif/core'
import { styles } from '../../lib/styles.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import {
  findDeadContainers,
  cleanupContainer,
  type DeadContainer,
  type ContainerCleanupResult,
} from '../../lib/execution/container-cleanup.js'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/base-command.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
  outputPromptAsJson,
  buildPromptConfig,
} from '../../lib/prompt-json.js'
import { visualPadEnd } from '../../lib/string-utils.js'

export default class SessionCleanup extends PromptCommand {
  static description = 'Remove dead Docker containers (containers with no active agent sessions)'

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
    const dryRun = flags['dry-run']

    // Check Docker status
    if (!isDockerRunning()) {
      if (jsonMode) {
        outputErrorAsJson('DOCKER_NOT_RUNNING', 'Docker is not running.', createMetadata('session cleanup', flags))
        return
      }
      this.log(`\n${styles.error('Docker is not running.')}`)
      this.log(`${styles.muted('Start Docker Desktop or the Docker daemon first.')}\n`)
      return
    }

    // Find dead containers
    const deadContainers = findDeadContainers()

    if (deadContainers.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({
          message: 'No dead containers found. All containers have active agent sessions.',
          containers: [],
        }, createMetadata('session cleanup', flags))
        return
      }
      this.log(`\n${styles.success('No dead containers found. All containers have active agent sessions.')}\n`)
      return
    }

    // Display dead containers
    if (!jsonMode) {
      this.log('')
      this.log(styles.header(`${dryRun ? '[DRY RUN] ' : ''}Dead Containers`))
      this.log('='.repeat(90))
      this.log(styles.muted(
        '  ' +
        visualPadEnd('Container ID', 15) +
        visualPadEnd('Name', 30) +
        visualPadEnd('Status', 15) +
        'Reason',
      ))
      this.log('  ' + '-'.repeat(88))

      for (const container of deadContainers) {
        const statusColor = container.status.includes('Up') ? styles.warning : styles.muted
        this.log(
          '  ' +
          visualPadEnd(container.id.substring(0, 12), 15) +
          visualPadEnd(truncate(container.name, 28), 30) +
          statusColor(visualPadEnd(container.status, 15)) +
          styles.muted(container.reason),
        )
      }
      this.log('')
    }

    if (dryRun) {
      if (jsonMode) {
        outputSuccessAsJson({
          message: `Would remove ${deadContainers.length} dead container(s)`,
          dryRun: true,
          containers: deadContainers.map(c => ({
            id: c.id,
            name: c.name,
            status: c.status,
            reason: c.reason,
          })),
        }, createMetadata('session cleanup', flags))
        return
      }
      this.log(styles.warning(`[DRY RUN] Would remove ${deadContainers.length} container(s)\n`))
      return
    }

    // Confirm removal
    if (!flags.force) {
      const choices = [
        { name: 'Yes, remove dead containers', value: true },
        { name: 'No, cancel', value: false },
      ]
      const message = `Remove ${deadContainers.length} dead container(s)?`

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'confirmed', message, choices),
          createMetadata('session cleanup', flags),
        )
        return
      }

      const { confirmed } = await this.prompt<{ confirmed: boolean }>([{
        type: 'list',
        name: 'confirmed',
        message,
        choices,
      }], null)

      if (!confirmed) {
        this.log(styles.muted('\nAborted.\n'))
        return
      }
    }

    // Perform cleanup
    const result: ContainerCleanupResult = {
      stopped: [],
      removed: [],
      errors: [],
    }

    for (const container of deadContainers) {
      if (!jsonMode) {
        this.log(styles.muted(`  Cleaning up ${container.name} (${container.id.substring(0, 12)})...`))
      }

      const cleanup = cleanupContainer(container.id)

      if (cleanup.success) {
        if (container.status.includes('Up')) {
          result.stopped.push(container.id)
        }
        result.removed.push(container.id)
      } else {
        result.errors.push(`${container.name}: ${cleanup.error}`)
      }
    }

    // Output results
    if (jsonMode) {
      outputSuccessAsJson({
        message: `Removed ${result.removed.length} container(s)`,
        ...result,
      }, createMetadata('session cleanup', flags))
      return
    }

    this.log('')
    if (result.removed.length > 0) {
      this.log(styles.success(`Removed ${result.removed.length} dead container(s)`))
    }
    if (result.stopped.length > 0) {
      this.log(styles.muted(`  (${result.stopped.length} were still running and were stopped first)`))
    }
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        this.log(styles.error(`  Error: ${err}`))
      }
    }
    this.log('')
  }
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength - 2) + '..'
}
