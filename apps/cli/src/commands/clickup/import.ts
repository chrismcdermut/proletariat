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
  isClickUpConfigured,
  loadClickUpConfig,
  getClickUpApiKey,
  ClickUpClient,
} from '../../lib/clickup/index.js'
import type { ClickUpTask } from '../../lib/clickup/types.js'
import {
  normalizeClickUpTaskToEnvelope,
  buildClickUpTicketDescription,
  buildClickUpMetadata,
} from '../../lib/external-issues/clickup.js'

export default class ClickUpImport extends PMOCommand {
  static description = 'Import ClickUp tasks into PMO as tickets'

  static examples = [
    '<%= config.bin %> <%= command.id %>                                      # Interactive: select tasks from list',
    '<%= config.bin %> <%= command.id %> --limit 50                           # Import up to 50 tasks',
    '<%= config.bin %> <%= command.id %> --all                                # Import all matching tasks',
    '<%= config.bin %> <%= command.id %> --dry-run                            # Preview what would be imported',
    '<%= config.bin %> <%= command.id %> --json                               # JSON output for scripting',
  ]

  static flags = {
    ...pmoBaseFlags,
    limit: Flags.integer({
      char: 'n',
      description: 'Maximum number of tasks to import',
      default: 50,
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Import all matching tasks without interactive selection',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview tasks that would be imported without creating tickets',
      default: false,
    }),
    list: Flags.string({
      description: 'ClickUp list ID to import from (overrides configured default)',
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ClickUpImport)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (!isClickUpConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson('CLICKUP_NOT_CONFIGURED', 'ClickUp is not configured. Run "prlt clickup connect" first.', createMetadata('clickup import', flags))
        return
      }
      this.error('ClickUp is not configured. Run "prlt clickup connect" first.')
    }

    const config = loadClickUpConfig(db)!
    const apiKey = getClickUpApiKey(db)
    if (!apiKey) {
      if (jsonMode) {
        outputErrorAsJson('CLICKUP_NO_KEY', 'ClickUp API key not found.', createMetadata('clickup import', flags))
        return
      }
      this.error('ClickUp API key not found. Run "prlt clickup connect" first.')
    }

    const listId = flags.list ?? config.listId
    if (!listId) {
      if (jsonMode) {
        outputErrorAsJson('CLICKUP_NO_LIST', 'No ClickUp list configured. Run "prlt clickup connect" and select a list.', createMetadata('clickup import', flags))
        return
      }
      this.error('No ClickUp list configured. Run "prlt clickup connect" and select a list, or use --list.')
    }

    const client = new ClickUpClient(apiKey)

    const projectId = await this.requireProject({
      jsonMode: jsonMode ? {
        flags,
        commandName: 'clickup import',
        baseCommand: `${this.config.bin} clickup import`,
      } : undefined,
    })

    this.log(colors.textMuted(`Fetching tasks from ClickUp list "${config.listName || listId}"...`))

    let clickupTasks: ClickUpTask[]
    try {
      clickupTasks = await client.listTasks(listId)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to fetch tasks from ClickUp.'
      if (jsonMode) {
        outputErrorAsJson('CLICKUP_FETCH_FAILED', msg, createMetadata('clickup import', flags))
        return
      }
      this.error(msg)
    }

    // Apply limit
    if (clickupTasks.length > flags.limit) {
      clickupTasks = clickupTasks.slice(0, flags.limit)
    }

    if (clickupTasks.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({
          imported: 0,
          message: 'No tasks found in the ClickUp list.',
        }, createMetadata('clickup import', flags))
        return
      }
      this.log(colors.warning('No tasks found in the ClickUp list.'))
      return
    }

    // Check which are already imported
    const tickets = await this.storage.listTickets(projectId)
    const newTasks: ClickUpTask[] = []
    const alreadyImported: ClickUpTask[] = []

    for (const task of clickupTasks) {
      const existing = tickets.find((ticket) => {
        const source = ticket.metadata?.external_source
        const key = ticket.metadata?.external_key
        const id = ticket.metadata?.external_id
        return source === 'clickup' && (key === task.id || id === task.id)
      })
      if (existing) {
        alreadyImported.push(task)
      } else {
        newTasks.push(task)
      }
    }

    if (newTasks.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({
          imported: 0,
          skipped: alreadyImported.length,
          message: 'All matching tasks are already imported.',
        }, createMetadata('clickup import', flags))
        return
      }
      this.log(colors.textMuted(`All ${alreadyImported.length} matching task(s) already imported.`))
      return
    }

    // Interactive selection (unless --all)
    let selectedTasks = newTasks
    if (!flags.all && !jsonMode) {
      const taskChoices = newTasks.map((task) => ({
        name: `${task.id}  ${task.name}  [${task.status.status}]`,
        value: task.id,
        checked: true,
      }))

      const { selectedIds } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selectedIds',
        message: `Select tasks to import (${newTasks.length} new, ${alreadyImported.length} already imported):`,
        choices: taskChoices,
      }])

      selectedTasks = newTasks.filter((t) => (selectedIds as string[]).includes(t.id))
    }

    if (selectedTasks.length === 0) {
      this.log(colors.textMuted('No tasks selected.'))
      return
    }

    // Dry run mode
    if (flags['dry-run']) {
      if (jsonMode) {
        outputSuccessAsJson({
          dryRun: true,
          wouldImport: selectedTasks.map((t) => ({
            id: t.id,
            name: t.name,
            status: t.status.status,
          })),
        }, createMetadata('clickup import', flags))
        return
      }

      this.log('')
      this.log(colors.primary('Dry run - would import:'))
      for (const task of selectedTasks) {
        this.log(`  ${colors.textSecondary(task.id)}  ${task.name}`)
      }
      this.log('')
      this.log(colors.textMuted(`${selectedTasks.length} task(s) would be imported.`))
      return
    }

    // Import tasks
    this.log('')
    this.log(colors.textMuted(`Importing ${selectedTasks.length} task(s)...`))

    let imported = 0
    let updated = 0
    const errors: Array<{ id: string; error: string }> = []

    for (const task of selectedTasks) {
      try {
        const envelope = normalizeClickUpTaskToEnvelope(task)
        const description = buildClickUpTicketDescription(envelope)
        const metadata = buildClickUpMetadata(envelope)

        // Check if already exists (shouldn't given our filter, but be safe)
        const existingTicket = tickets.find((ticket) => {
          const source = ticket.metadata?.external_source
          const key = ticket.metadata?.external_key
          return source === 'clickup' && key === task.id
        })

        if (existingTicket) {
          await this.storage.updateTicket(existingTicket.id, {
            title: envelope.title,
            description,
            priority: envelope.priority ?? undefined,
            category: envelope.category ?? undefined,
            labels: envelope.labels,
            metadata: {
              ...existingTicket.metadata,
              ...metadata,
            },
          })
          updated++
        } else {
          await this.storage.createTicket(projectId, {
            title: envelope.title,
            description,
            priority: envelope.priority ?? undefined,
            category: envelope.category ?? undefined,
            labels: envelope.labels,
            metadata,
          })
          imported++
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error'
        errors.push({ id: task.id, error: msg })
      }
    }

    if (jsonMode) {
      outputSuccessAsJson({
        imported,
        updated,
        skipped: alreadyImported.length,
        errors,
      }, createMetadata('clickup import', flags))
      return
    }

    this.log('')
    if (imported > 0) {
      this.log(colors.success(`Imported ${imported} task(s) into PMO`))
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
        this.log(colors.textMuted(`    ${err.id}: ${err.error}`))
      }
    }
  }
}
