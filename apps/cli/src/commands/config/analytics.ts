import { Command, Flags } from '@oclif/core'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import inquirer from 'inquirer'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  isAnalyticsEnabled,
  getAnalyticsConfig,
  enableAnalytics,
  disableAnalytics,
  getQueueSize,
  flushQueue,
  getCollectedDataDescription,
} from '../../lib/analytics/index.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

export default class Analytics extends Command {
  static description = 'View and configure analytics settings'

  static examples = [
    '<%= config.bin %> <%= command.id %>              # Interactive menu',
    '<%= config.bin %> <%= command.id %> --json       # Output current status as JSON',
    '<%= config.bin %> <%= command.id %> --enable     # Enable analytics',
    '<%= config.bin %> <%= command.id %> --disable    # Disable analytics',
    '<%= config.bin %> <%= command.id %> --show       # Show what data is collected',
    '<%= config.bin %> <%= command.id %> --flush      # Send queued events now',
  ]

  static flags = {
    json: Flags.boolean({
      description: 'Output status as JSON (for AI agents/scripts)',
      default: false,
    }),
    enable: Flags.boolean({
      description: 'Enable analytics',
      default: false,
      exclusive: ['disable'],
    }),
    disable: Flags.boolean({
      description: 'Disable analytics',
      default: false,
      exclusive: ['enable'],
    }),
    show: Flags.boolean({
      description: 'Show what data is collected',
      default: false,
    }),
    flush: Flags.boolean({
      description: 'Flush queued events to server',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Analytics)
    const jsonMode = shouldOutputJson(flags)

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson(
          'NOT_IN_WORKSPACE',
          'Not in a workspace. Run "prlt init" first.',
          createMetadata('config analytics', flags)
        )
        this.exit(1)
      }
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)

    try {
      // Handle --show flag
      if (flags.show) {
        if (jsonMode) {
          outputSuccessAsJson(
            {
              description: getCollectedDataDescription(),
            },
            createMetadata('config analytics', flags)
          )
        } else {
          this.log('')
          this.log(getCollectedDataDescription())
          this.log('')
        }
        db.close()
        return
      }

      // Handle --enable flag
      if (flags.enable) {
        const config = enableAnalytics(db)
        if (jsonMode) {
          outputSuccessAsJson(
            {
              enabled: true,
              workspaceId: config.workspaceId,
              consentDate: config.consentDate,
            },
            createMetadata('config analytics', flags)
          )
        } else {
          this.log(styles.success('Analytics enabled. Thank you for helping improve Proletariat!'))
          this.log(styles.muted(`Workspace ID: ${config.workspaceId}`))
        }
        db.close()
        return
      }

      // Handle --disable flag
      if (flags.disable) {
        disableAnalytics(db)
        if (jsonMode) {
          outputSuccessAsJson(
            { enabled: false },
            createMetadata('config analytics', flags)
          )
        } else {
          this.log(styles.success('Analytics disabled.'))
        }
        db.close()
        return
      }

      // Handle --flush flag
      if (flags.flush) {
        const queueSize = getQueueSize(db)
        if (queueSize === 0) {
          if (jsonMode) {
            outputSuccessAsJson(
              { flushed: 0, message: 'No events in queue' },
              createMetadata('config analytics', flags)
            )
          } else {
            this.log(styles.muted('No events in queue to flush.'))
          }
          db.close()
          return
        }

        const flushed = await flushQueue(db)
        if (jsonMode) {
          outputSuccessAsJson(
            { flushed, remaining: getQueueSize(db) },
            createMetadata('config analytics', flags)
          )
        } else {
          this.log(styles.success(`Flushed ${flushed} event(s).`))
          const remaining = getQueueSize(db)
          if (remaining > 0) {
            this.log(styles.muted(`${remaining} event(s) remaining in queue.`))
          }
        }
        db.close()
        return
      }

      // Get current config
      const config = getAnalyticsConfig(db)
      const queueSize = getQueueSize(db)

      // Handle --json flag (just show status)
      if (flags.json) {
        outputSuccessAsJson(
          {
            enabled: config.enabled,
            workspaceId: config.workspaceId,
            consentDate: config.consentDate,
            queuedEvents: queueSize,
          },
          createMetadata('config analytics', flags)
        )
        db.close()
        return
      }

      // Interactive menu
      const actionChoices = [
        {
          name: `Status: ${config.enabled ? 'Enabled' : 'Disabled'}${queueSize > 0 ? ` (${queueSize} queued)` : ''}`,
          value: 'status',
        },
        { name: config.enabled ? 'Disable analytics' : 'Enable analytics', value: 'toggle' },
        { name: 'Show what data is collected', value: 'show' },
        ...(queueSize > 0 ? [{ name: `Flush ${queueSize} queued event(s)`, value: 'flush' }] : []),
        { name: 'Exit', value: '__exit__' },
      ]
      const actionMessage = 'Analytics settings:'

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'action', actionMessage, actionChoices),
          createMetadata('config analytics', flags)
        )
        db.close()
        return
      }

      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: actionMessage,
          choices: actionChoices,
        },
      ])

      if (action === '__exit__') {
        db.close()
        return
      }

      switch (action) {
        case 'status': {
          this.log('')
          this.log(styles.header('Analytics Status'))
          this.log('─'.repeat(40))
          this.log(`Enabled:      ${config.enabled ? styles.success('Yes') : styles.muted('No')}`)
          if (config.workspaceId) {
            this.log(`Workspace ID: ${styles.muted(config.workspaceId)}`)
          }
          if (config.consentDate) {
            this.log(`Consent Date: ${styles.muted(config.consentDate)}`)
          }
          this.log(`Queued:       ${queueSize} event(s)`)
          this.log('')
          break
        }

        case 'toggle': {
          if (config.enabled) {
            disableAnalytics(db)
            this.log(styles.success('Analytics disabled.'))
          } else {
            const newConfig = enableAnalytics(db)
            this.log(styles.success('Analytics enabled. Thank you for helping improve Proletariat!'))
            this.log(styles.muted(`Workspace ID: ${newConfig.workspaceId}`))
          }
          break
        }

        case 'show': {
          this.log('')
          this.log(getCollectedDataDescription())
          this.log('')
          break
        }

        case 'flush': {
          const flushed = await flushQueue(db)
          this.log(styles.success(`Flushed ${flushed} event(s).`))
          const remaining = getQueueSize(db)
          if (remaining > 0) {
            this.log(styles.muted(`${remaining} event(s) remaining in queue.`))
          }
          break
        }
      }

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }
}
