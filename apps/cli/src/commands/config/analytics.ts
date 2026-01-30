import { Flags } from '@oclif/core'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import inquirer from 'inquirer'
import { Command } from '@oclif/core'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  isAnalyticsEnabled,
  enableAnalytics,
  disableAnalytics,
  getAnalyticsConfig,
  getQueueStats,
  hasAnalyticsPreference,
} from '../../lib/analytics/index.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

export default class ConfigAnalytics extends Command {
  static description = 'View and manage analytics preferences'

  static examples = [
    '<%= config.bin %> <%= command.id %>                # Interactive menu',
    '<%= config.bin %> <%= command.id %> --status       # Show current status',
    '<%= config.bin %> <%= command.id %> --enable       # Enable analytics',
    '<%= config.bin %> <%= command.id %> --disable      # Disable analytics',
    '<%= config.bin %> <%= command.id %> --show         # Show what data is collected',
  ]

  static flags = {
    json: Flags.boolean({
      description: 'Output as JSON (for AI agents/scripts)',
      default: false,
    }),
    status: Flags.boolean({
      description: 'Show current analytics status',
      default: false,
    }),
    enable: Flags.boolean({
      description: 'Enable analytics (opt-in)',
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
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigAnalytics)
    const jsonMode = shouldOutputJson(flags)

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt init" first.', createMetadata('config analytics', flags))
      }
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)

    try {
      // Handle --show flag (show what data is collected)
      if (flags.show) {
        this.showDataCollected(jsonMode, flags)
        db.close()
        return
      }

      // Handle --enable flag
      if (flags.enable) {
        enableAnalytics(db)
        if (jsonMode) {
          outputSuccessAsJson({ enabled: true }, createMetadata('config analytics', flags))
        } else {
          this.log(styles.success('Analytics enabled. Thank you for helping improve prlt!'))
        }
        db.close()
        return
      }

      // Handle --disable flag
      if (flags.disable) {
        disableAnalytics(db)
        if (jsonMode) {
          outputSuccessAsJson({ enabled: false }, createMetadata('config analytics', flags))
        } else {
          this.log(styles.success('Analytics disabled.'))
        }
        db.close()
        return
      }

      // Handle --status flag or --json (show current status)
      if (flags.status || flags.json) {
        const config = getAnalyticsConfig(db)
        const queueStats = getQueueStats(db)

        if (jsonMode) {
          outputSuccessAsJson({
            enabled: config.enabled,
            workspaceId: config.workspaceId,
            consentDate: config.consentDate,
            queuedEvents: queueStats.totalEvents,
          }, createMetadata('config analytics', flags))
        } else {
          this.log('')
          this.log(styles.header('Analytics Status'))
          this.log('═'.repeat(50))
          this.log('')
          this.log(`  Status:          ${config.enabled ? styles.success('Enabled') : styles.muted('Disabled')}`)
          this.log(`  Workspace ID:    ${styles.muted(config.workspaceId)}`)
          if (config.consentDate) {
            this.log(`  Consent Date:    ${styles.muted(config.consentDate)}`)
          }
          if (queueStats.totalEvents > 0) {
            this.log(`  Queued Events:   ${queueStats.totalEvents}`)
          }
          this.log('')
        }
        db.close()
        return
      }

      // Interactive menu
      const config = getAnalyticsConfig(db)
      const choices = config.enabled
        ? [
            { name: 'View status', value: 'status' },
            { name: 'Show what data is collected', value: 'show' },
            { name: 'Disable analytics', value: 'disable' },
          ]
        : [
            { name: 'View status', value: 'status' },
            { name: 'Show what data is collected', value: 'show' },
            { name: 'Enable analytics', value: 'enable' },
          ]

      const message = 'Analytics options:'

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'action', message, choices),
          createMetadata('config analytics', flags)
        )
        db.close()
        return
      }

      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message,
        choices: [
          ...choices,
          new inquirer.Separator(),
          { name: 'Exit', value: '__exit__' },
        ],
      }])

      if (action === '__exit__') {
        db.close()
        return
      }

      switch (action) {
        case 'status': {
          const currentConfig = getAnalyticsConfig(db)
          const queueStats = getQueueStats(db)
          this.log('')
          this.log(styles.header('Analytics Status'))
          this.log('═'.repeat(50))
          this.log('')
          this.log(`  Status:          ${currentConfig.enabled ? styles.success('Enabled') : styles.muted('Disabled')}`)
          this.log(`  Workspace ID:    ${styles.muted(currentConfig.workspaceId)}`)
          if (currentConfig.consentDate) {
            this.log(`  Consent Date:    ${styles.muted(currentConfig.consentDate)}`)
          }
          if (queueStats.totalEvents > 0) {
            this.log(`  Queued Events:   ${queueStats.totalEvents}`)
          }
          this.log('')
          break
        }

        case 'show':
          this.showDataCollected(false, flags)
          break

        case 'enable':
          enableAnalytics(db)
          this.log(styles.success('Analytics enabled. Thank you for helping improve prlt!'))
          break

        case 'disable':
          disableAnalytics(db)
          this.log(styles.success('Analytics disabled.'))
          break
      }

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }

  private showDataCollected(jsonMode: boolean, flags: Record<string, unknown>): void {
    const dataCollected = {
      commandEvents: {
        description: 'Command execution metrics',
        properties: [
          'command - Command name (e.g., "ticket create")',
          'duration_ms - How long the command took',
          'success - Whether it succeeded',
          'exit_code - Exit code if applicable',
        ],
      },
      workEvents: {
        description: 'Work session lifecycle',
        properties: [
          'executor - AI tool used (claude-code, aider, etc.)',
          'environment - Execution environment (host, docker, etc.)',
          'display_mode - How output is shown (terminal, background)',
          'duration_ms - Session duration',
          'sandboxed - Whether safe mode was used',
        ],
      },
      featureEvents: {
        description: 'Feature adoption',
        properties: [
          'feature - Feature name',
          'category - Feature category',
        ],
      },
      notCollected: [
        'Usernames, emails, or personal information',
        'File paths or file content',
        'Ticket titles, descriptions, or project content',
        'API keys or credentials',
        'IP addresses (anonymized by PostHog)',
      ],
    }

    if (jsonMode) {
      outputSuccessAsJson({ dataCollected }, createMetadata('config analytics', flags))
      return
    }

    this.log('')
    this.log(styles.header('What Data Is Collected'))
    this.log('═'.repeat(50))
    this.log('')

    this.log(styles.emphasis('Command Events'))
    this.log(styles.muted('  ' + dataCollected.commandEvents.description))
    for (const prop of dataCollected.commandEvents.properties) {
      this.log(`    - ${prop}`)
    }
    this.log('')

    this.log(styles.emphasis('Work Events'))
    this.log(styles.muted('  ' + dataCollected.workEvents.description))
    for (const prop of dataCollected.workEvents.properties) {
      this.log(`    - ${prop}`)
    }
    this.log('')

    this.log(styles.emphasis('Feature Events'))
    this.log(styles.muted('  ' + dataCollected.featureEvents.description))
    for (const prop of dataCollected.featureEvents.properties) {
      this.log(`    - ${prop}`)
    }
    this.log('')

    this.log(styles.emphasis('What We Do NOT Collect'))
    for (const item of dataCollected.notCollected) {
      this.log(`    - ${item}`)
    }
    this.log('')
  }
}
