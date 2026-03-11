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
  isTrelloConfigured,
  loadTrelloConfig,
  TrelloClient,
} from '../../lib/trello/index.js'
import {
  normalizeTrelloCardToEnvelope,
  buildTrelloTicketDescription,
  buildTrelloMetadata,
} from '../../lib/external-issues/trello.js'

export default class TrelloImport extends PMOCommand {
  static description = 'Import Trello cards into PMO as tickets'

  static examples = [
    '<%= config.bin %> <%= command.id %>                                      # Interactive: select cards from board',
    '<%= config.bin %> <%= command.id %> --limit 50                           # Import up to 50 cards',
    '<%= config.bin %> <%= command.id %> --all                                # Import all matching cards',
    '<%= config.bin %> <%= command.id %> --dry-run                            # Preview what would be imported',
    '<%= config.bin %> <%= command.id %> --json                               # JSON output for scripting',
  ]

  static flags = {
    ...pmoBaseFlags,
    limit: Flags.integer({
      char: 'n',
      description: 'Maximum number of cards to import',
      default: 50,
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Import all matching cards without interactive selection',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview cards that would be imported without creating tickets',
      default: false,
    }),
    board: Flags.string({
      description: 'Trello board ID to import from (overrides configured default)',
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(TrelloImport)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (!isTrelloConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson('TRELLO_NOT_CONFIGURED', 'Trello is not configured. Run "prlt trello configure" first.', createMetadata('trello import', flags))
        this.exit(1)
      }
      this.error('Trello is not configured. Run "prlt trello configure" first.')
    }

    const config = loadTrelloConfig(db)!
    const boardId = flags.board ?? config.boardId

    if (!boardId) {
      if (jsonMode) {
        outputErrorAsJson('TRELLO_NO_BOARD', 'No Trello board configured. Run "prlt trello configure" and select a board, or use --board.', createMetadata('trello import', flags))
        this.exit(1)
      }
      this.error('No Trello board configured. Run "prlt trello configure" and select a board, or use --board.')
    }

    const client = new TrelloClient(config.apiKey, config.apiToken)

    const projectId = await this.requireProject({
      jsonMode: jsonMode ? {
        flags,
        commandName: 'trello import',
        baseCommand: `${this.config.bin} trello import`,
      } : undefined,
    })

    this.log(colors.textMuted(`Fetching cards from Trello board "${config.boardName || boardId}"...`))

    let trelloCards: Array<{ id: string; name: string; desc: string; url: string; shortUrl: string; idBoard: string; idList: string; idMembers: string[]; labels: Array<{ id: string; name: string; color: string }>; closed: boolean; due: string | null; dueComplete: boolean }>
    try {
      trelloCards = await client.listCards(boardId, { limit: flags.limit })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to fetch cards from Trello.'
      if (jsonMode) {
        outputErrorAsJson('TRELLO_FETCH_FAILED', msg, createMetadata('trello import', flags))
        this.exit(1)
      }
      this.error(msg)
    }

    if (trelloCards.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({
          imported: 0,
          message: 'No open cards found on the Trello board.',
        }, createMetadata('trello import', flags))
        return
      }
      this.log(colors.warning('No open cards found on the Trello board.'))
      return
    }

    // Check which are already imported
    const tickets = await this.storage.listTickets(projectId)
    const newCards: typeof trelloCards = []
    const alreadyImported: typeof trelloCards = []

    for (const card of trelloCards) {
      const existing = tickets.find((ticket) => {
        const source = ticket.metadata?.external_source
        const key = ticket.metadata?.external_key
        const id = ticket.metadata?.external_id
        return source === 'trello' && (key === card.id || id === card.id)
      })
      if (existing) {
        alreadyImported.push(card)
      } else {
        newCards.push(card)
      }
    }

    if (newCards.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({
          imported: 0,
          skipped: alreadyImported.length,
          message: 'All matching cards are already imported.',
        }, createMetadata('trello import', flags))
        return
      }
      this.log(colors.textMuted(`All ${alreadyImported.length} matching card(s) already imported.`))
      return
    }

    // Interactive selection (unless --all)
    let selectedCards = newCards
    if (!flags.all && !jsonMode) {
      const cardChoices = newCards.map((card) => ({
        name: `${card.id.slice(0, 8)}  ${card.name}  [${card.closed ? 'Closed' : 'Open'}]`,
        value: card.id,
        checked: true,
      }))

      const { selectedIds } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selectedIds',
        message: `Select cards to import (${newCards.length} new, ${alreadyImported.length} already imported):`,
        choices: cardChoices,
      }])

      selectedCards = newCards.filter((c) => (selectedIds as string[]).includes(c.id))
    }

    if (selectedCards.length === 0) {
      this.log(colors.textMuted('No cards selected.'))
      return
    }

    // Dry run mode
    if (flags['dry-run']) {
      if (jsonMode) {
        outputSuccessAsJson({
          dryRun: true,
          wouldImport: selectedCards.map((c) => ({
            id: c.id,
            name: c.name,
            closed: c.closed,
          })),
        }, createMetadata('trello import', flags))
        return
      }

      this.log('')
      this.log(colors.primary('Dry run - would import:'))
      for (const card of selectedCards) {
        this.log(`  ${colors.textSecondary(card.id.slice(0, 8))}  ${card.name}`)
      }
      this.log('')
      this.log(colors.textMuted(`${selectedCards.length} card(s) would be imported.`))
      return
    }

    // Import cards
    this.log('')
    this.log(colors.textMuted(`Importing ${selectedCards.length} card(s)...`))

    let imported = 0
    let updated = 0
    const errors: Array<{ id: string; error: string }> = []

    for (const card of selectedCards) {
      try {
        const envelope = normalizeTrelloCardToEnvelope(card)
        const description = buildTrelloTicketDescription(envelope)
        const metadata = buildTrelloMetadata(envelope)

        // Check if already exists (shouldn't given our filter, but be safe)
        const existingTicket = tickets.find((ticket) => {
          const source = ticket.metadata?.external_source
          const key = ticket.metadata?.external_key
          return source === 'trello' && key === card.id
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
        errors.push({ id: card.id, error: msg })
      }
    }

    if (jsonMode) {
      outputSuccessAsJson({
        imported,
        updated,
        skipped: alreadyImported.length,
        errors,
      }, createMetadata('trello import', flags))
      return
    }

    this.log('')
    if (imported > 0) {
      this.log(colors.success(`Imported ${imported} card(s) into PMO`))
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
