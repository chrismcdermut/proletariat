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
  isAsanaConfigured,
  loadAsanaConfig,
  getAsanaAccessToken,
  AsanaClient,
} from '../../lib/asana/index.js'
import type { AsanaTask } from '../../lib/asana/types.js'
import {
  normalizeAsanaTaskToEnvelope,
  buildAsanaTicketDescription,
  buildAsanaMetadata,
} from '../../lib/external-issues/asana.js'

export default class AsanaImport extends PMOCommand {
  static description = 'Import Asana tasks into PMO as tickets'

  static examples = [
    '<%= config.bin %> <%= command.id %>                                      # Interactive: select tasks from project',
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
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(AsanaImport)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (!isAsanaConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson('ASANA_NOT_CONFIGURED', 'Asana is not configured. Run "prlt asana connect" first.', createMetadata('asana import', flags))
        return
      }
      this.error('Asana is not configured. Run "prlt asana connect" first.')
    }

    const config = loadAsanaConfig(db)!
    const accessToken = getAsanaAccessToken(db)
    if (!accessToken) {
      if (jsonMode) {
        outputErrorAsJson('ASANA_NO_TOKEN', 'Asana access token not found.', createMetadata('asana import', flags))
        return
      }
      this.error('Asana access token not found. Run "prlt asana connect" first.')
    }

    if (!config.projectGid) {
      if (jsonMode) {
        outputErrorAsJson('ASANA_NO_PROJECT', 'No Asana project configured. Run "prlt asana connect" and select a project.', createMetadata('asana import', flags))
        return
      }
      this.error('No Asana project configured. Run "prlt asana connect" and select a project.')
    }

    const client = new AsanaClient(accessToken)

    const projectId = await this.requireProject({
      jsonMode: jsonMode ? {
        flags,
        commandName: 'asana import',
        baseCommand: `${this.config.bin} asana import`,
      } : undefined,
    })

    this.log(colors.textMuted(`Fetching tasks from Asana project "${config.projectName || config.projectGid}"...`))

    let asanaTasks: AsanaTask[]
    try {
      asanaTasks = await client.listTasks(config.projectGid, { limit: flags.limit })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to fetch tasks from Asana.'
      if (jsonMode) {
        outputErrorAsJson('ASANA_FETCH_FAILED', msg, createMetadata('asana import', flags))
        return
      }
      this.error(msg)
    }

    if (asanaTasks.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({
          imported: 0,
          message: 'No active tasks found in the Asana project.',
        }, createMetadata('asana import', flags))
        return
      }
      this.log(colors.warning('No active tasks found in the Asana project.'))
      return
    }

    // Check which are already imported via the provider (PRLT-1327)
    const provider = this.resolveProjectProvider(projectId, 'asana')
    const listResult = await provider.listTickets(projectId)
    const existingTickets = listResult.success ? listResult.tickets : []
    const existingGids = new Set(existingTickets.map(t => t.metadata?.external_key || t.id))

    const newTasks: AsanaTask[] = []
    const alreadyImported: AsanaTask[] = []

    for (const task of asanaTasks) {
      if (existingGids.has(task.gid)) {
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
        }, createMetadata('asana import', flags))
        return
      }
      this.log(colors.textMuted(`All ${alreadyImported.length} matching task(s) already imported.`))
      return
    }

    // Interactive selection (unless --all)
    let selectedTasks = newTasks
    if (!flags.all && !jsonMode) {
      const taskChoices = newTasks.map((task) => ({
        name: `${task.gid}  ${task.name}  [${task.completed ? 'Completed' : 'Open'}]`,
        value: task.gid,
        checked: true,
      }))

      const { selectedGids } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selectedGids',
        message: `Select tasks to import (${newTasks.length} new, ${alreadyImported.length} already imported):`,
        choices: taskChoices,
      }])

      selectedTasks = newTasks.filter((t) => (selectedGids as string[]).includes(t.gid))
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
            gid: t.gid,
            name: t.name,
            completed: t.completed,
          })),
        }, createMetadata('asana import', flags))
        return
      }

      this.log('')
      this.log(colors.primary('Dry run - would import:'))
      for (const task of selectedTasks) {
        this.log(`  ${colors.textSecondary(task.gid)}  ${task.name}`)
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
    const errors: Array<{ gid: string; error: string }> = []

    for (const task of selectedTasks) {
      try {
        const envelope = normalizeAsanaTaskToEnvelope(task)
        const description = buildAsanaTicketDescription(envelope)
        const metadata = buildAsanaMetadata(envelope)

        // Check if already exists (shouldn't given our filter, but be safe)
        const existingTicket = existingTickets.find((ticket) => {
          const key = ticket.metadata?.external_key
          return key === task.gid
        })

        if (existingTicket) {
          const updateResult = await provider.updateTicket(existingTicket.id, {
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
          if (!updateResult.success) throw new Error(updateResult.error || 'Update failed')
          updated++
        } else {
          const createResult = await provider.createTicket(projectId, {
            title: envelope.title,
            description,
            priority: envelope.priority ?? undefined,
            category: envelope.category ?? undefined,
            labels: envelope.labels,
            metadata,
          })
          if (!createResult.success) throw new Error(createResult.error || 'Create failed')
          imported++
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error'
        errors.push({ gid: task.gid, error: msg })
      }
    }

    if (jsonMode) {
      outputSuccessAsJson({
        imported,
        updated,
        skipped: alreadyImported.length,
        errors,
      }, createMetadata('asana import', flags))
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
        this.log(colors.textMuted(`    ${err.gid}: ${err.error}`))
      }
    }
  }
}
