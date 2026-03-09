import { Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { colors } from '../../lib/colors.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  isShortcutConfigured,
  loadShortcutConfig,
} from '../../lib/shortcut/index.js'
import {
  listShortcutStories,
  importShortcutStoryToPmo,
  normalizeShortcutStoryToEnvelope,
} from '../../lib/external-issues/shortcut.js'
import type { NormalizedIssueEnvelope } from '../../lib/external-issues/types.js'

export default class ShortcutImport extends PMOCommand {
  static description = 'Import Shortcut stories into PMO as tickets'

  static examples = [
    '<%= config.bin %> <%= command.id %>                                      # Interactive: select stories',
    '<%= config.bin %> <%= command.id %> --limit 50                           # Import up to 50 stories',
    '<%= config.bin %> <%= command.id %> --all                                # Import all matching stories',
    '<%= config.bin %> <%= command.id %> --dry-run                            # Preview what would be imported',
    '<%= config.bin %> <%= command.id %> --json                               # JSON output for scripting',
  ]

  static flags = {
    ...pmoBaseFlags,
    limit: Flags.integer({
      char: 'n',
      description: 'Maximum number of stories to import',
      default: 50,
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Import all matching stories without interactive selection',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview stories that would be imported without creating tickets',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ShortcutImport)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (!isShortcutConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson('SHORTCUT_NOT_CONFIGURED', 'Shortcut is not configured. Run "prlt shortcut connect" first.', createMetadata('shortcut import', flags))
        this.exit(1)
      }
      this.error('Shortcut is not configured. Run "prlt shortcut connect" first.')
    }

    const config = loadShortcutConfig(db)!

    const projectId = await this.requireProject({
      jsonMode: jsonMode ? {
        flags,
        commandName: 'shortcut import',
        baseCommand: `${this.config.bin} shortcut import`,
      } : undefined,
    })

    this.log(colors.textMuted(`Fetching stories from Shortcut${config.workspaceSlug ? ` (${config.workspaceSlug})` : ''}...`))

    let envelopes: NormalizedIssueEnvelope[]
    try {
      envelopes = await listShortcutStories(
        { apiToken: config.apiToken, workspaceSlug: config.workspaceSlug },
        { limit: flags.limit },
      )
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to fetch stories from Shortcut.'
      if (jsonMode) {
        outputErrorAsJson('SHORTCUT_FETCH_FAILED', msg, createMetadata('shortcut import', flags))
        this.exit(1)
      }
      this.error(msg)
    }

    if (envelopes.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({
          imported: 0,
          message: 'No active stories found in Shortcut.',
        }, createMetadata('shortcut import', flags))
        return
      }
      this.log(colors.warning('No active stories found in Shortcut.'))
      return
    }

    // Check which are already imported
    const tickets = await this.storage.listTickets(projectId)
    const newEnvelopes: NormalizedIssueEnvelope[] = []
    const alreadyImported: NormalizedIssueEnvelope[] = []

    for (const envelope of envelopes) {
      const existing = tickets.find((ticket) => {
        const source = ticket.metadata?.external_source
        const key = ticket.metadata?.external_key
        const id = ticket.metadata?.external_id
        return source === 'shortcut' && (key === envelope.source.externalKey || id === envelope.source.externalId)
      })
      if (existing) {
        alreadyImported.push(envelope)
      } else {
        newEnvelopes.push(envelope)
      }
    }

    if (newEnvelopes.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({
          imported: 0,
          skipped: alreadyImported.length,
          message: 'All matching stories are already imported.',
        }, createMetadata('shortcut import', flags))
        return
      }
      this.log(colors.textMuted(`All ${alreadyImported.length} matching story/stories already imported.`))
      return
    }

    // Interactive selection (unless --all)
    let selectedEnvelopes = newEnvelopes
    if (!flags.all && !jsonMode) {
      const storyChoices = newEnvelopes.map((env) => ({
        name: `${env.source.externalKey}  ${env.title}  [${env.status}]`,
        value: env.source.externalId,
        checked: true,
      }))

      const { selectedIds } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selectedIds',
        message: `Select stories to import (${newEnvelopes.length} new, ${alreadyImported.length} already imported):`,
        choices: storyChoices,
      }])

      selectedEnvelopes = newEnvelopes.filter((e) => (selectedIds as string[]).includes(e.source.externalId))
    }

    if (selectedEnvelopes.length === 0) {
      this.log(colors.textMuted('No stories selected.'))
      return
    }

    // Dry run mode
    if (flags['dry-run']) {
      if (jsonMode) {
        outputSuccessAsJson({
          dryRun: true,
          wouldImport: selectedEnvelopes.map((e) => ({
            externalKey: e.source.externalKey,
            title: e.title,
            status: e.status,
            category: e.category,
          })),
        }, createMetadata('shortcut import', flags))
        return
      }

      this.log('')
      this.log(colors.primary('Dry run - would import:'))
      for (const env of selectedEnvelopes) {
        this.log(`  ${colors.textSecondary(env.source.externalKey)}  ${env.title}`)
      }
      this.log('')
      this.log(colors.textMuted(`${selectedEnvelopes.length} story/stories would be imported.`))
      return
    }

    // Import stories
    this.log('')
    this.log(colors.textMuted(`Importing ${selectedEnvelopes.length} story/stories...`))

    let imported = 0
    let updated = 0
    const errors: Array<{ key: string; error: string }> = []

    for (const envelope of selectedEnvelopes) {
      try {
        const result = await importShortcutStoryToPmo(this.storage, projectId, envelope)
        if (result.created) {
          imported++
        } else {
          updated++
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error'
        errors.push({ key: envelope.source.externalKey, error: msg })
      }
    }

    if (jsonMode) {
      outputSuccessAsJson({
        imported,
        updated,
        skipped: alreadyImported.length,
        errors,
      }, createMetadata('shortcut import', flags))
      return
    }

    this.log('')
    if (imported > 0) {
      this.log(colors.success(`Imported ${imported} story/stories into PMO`))
    }
    if (updated > 0) {
      this.log(colors.textMuted(`  Updated ${updated} existing ticket(s)`))
    }
    if (alreadyImported.length > 0) {
      this.log(colors.textMuted(`  Skipped ${alreadyImported.length} (already imported)`))
    }
    if (errors.length > 0) {
      this.log(colors.error(`  ${errors.length} error(s):`))
      for (const err of errors) {
        this.log(colors.textMuted(`    ${err.key}: ${err.error}`))
      }
    }
  }
}
