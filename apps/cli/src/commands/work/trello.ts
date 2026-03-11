import { Flags } from '@oclif/core'
import {
  PMOCommand,
  pmoBaseFlags,
  autoExportToBoard,
  type Ticket,
} from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
} from '../../lib/prompt-json.js'
import {
  ExternalIssueAdapterError,
  type NormalizedIssueEnvelope,
} from '../../lib/external-issues/types.js'
import {
  listTrelloCards,
  getTrelloCardById,
  buildTrelloCardChoiceCommand,
  buildTrelloTicketDescription,
  buildTrelloMetadata,
  buildTrelloSpawnContextMessage,
} from '../../lib/external-issues/trello.js'
import { getTrelloApiKey, getTrelloApiToken, loadTrelloConfig } from '../../lib/trello/index.js'

function buildWorkStartArgs(options: {
  ticketId: string
  projectId: string
  executor?: string
  display?: string
  runOnHost?: boolean
  skipPermissions?: boolean
  createPr?: boolean
  action?: string
  message?: string
  json?: boolean
  machine?: boolean
  yes?: boolean
}): string[] {
  const args = [options.ticketId, '--project', options.projectId, '--ephemeral']

  if (options.executor) args.push('--executor', options.executor)
  if (options.display) args.push('--display', options.display)
  if (options.runOnHost) args.push('--run-on-host')
  if (options.skipPermissions) args.push('--skip-permissions')
  if (options.createPr) args.push('--create-pr')
  if (options.action) args.push('--action', options.action)
  if (options.message) args.push('--message', options.message)
  if (options.json) args.push('--json')
  if (options.machine) args.push('--machine')
  if (options.yes) args.push('--yes')

  return args
}

export default class WorkTrello extends PMOCommand {
  static description = 'List/select Trello cards and spawn work using the existing work-start flow'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --card abc123',
    '<%= config.bin %> <%= command.id %> --card abc123 --yes --skip-permissions --display terminal',
  ]

  static flags = {
    ...pmoBaseFlags,
    card: Flags.string({
      description: 'Trello card ID',
    }),
    limit: Flags.integer({
      char: 'l',
      description: 'Maximum number of Trello cards to fetch',
      default: 20,
      min: 1,
      max: 100,
    }),
    executor: Flags.string({
      char: 'e',
      description: 'Override executor',
      options: ['claude-code', 'codex', 'custom'],
    }),
    display: Flags.string({
      char: 'd',
      description: 'Display mode',
      options: ['terminal', 'background', 'foreground'],
    }),
    action: Flags.string({
      char: 'A',
      description: 'Action to run in work start (default: implement)',
      default: 'implement',
    }),
    message: Flags.string({
      description: 'Additional instructions appended to spawn context',
    }),
    'run-on-host': Flags.boolean({
      description: 'Run on host even if devcontainer exists',
      default: false,
    }),
    'skip-permissions': Flags.boolean({
      description: 'Skip permission prompts (danger mode)',
      default: false,
    }),
    'create-pr': Flags.boolean({
      description: 'Create PR when work is ready',
      default: false,
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip confirmation prompts in downstream work start',
      default: false,
    }),
  }

  private async findLinkedTicket(projectId: string, envelope: NormalizedIssueEnvelope): Promise<Ticket | undefined> {
    const tickets = await this.storage.listTickets(projectId)
    return tickets.find((ticket) => {
      const source = ticket.metadata?.external_source
      const key = ticket.metadata?.external_key
      const id = ticket.metadata?.external_id
      return source === 'trello'
        && (key === envelope.source.externalKey || id === envelope.source.externalId)
    })
  }

  private async createOrUpdateLinkedTicket(projectId: string, envelope: NormalizedIssueEnvelope): Promise<Ticket> {
    const existing = await this.findLinkedTicket(projectId, envelope)
    const description = buildTrelloTicketDescription(envelope)
    const metadata = buildTrelloMetadata(envelope)

    if (existing) {
      const updated = await this.storage.updateTicket(existing.id, {
        title: envelope.title,
        description,
        priority: envelope.priority ?? undefined,
        category: envelope.category ?? undefined,
        labels: envelope.labels,
        metadata: {
          ...existing.metadata,
          ...metadata,
        },
      })
      return updated
    }

    return this.storage.createTicket(projectId, {
      title: envelope.title,
      description,
      priority: envelope.priority ?? undefined,
      category: envelope.category ?? undefined,
      labels: envelope.labels,
      metadata,
    })
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(WorkTrello)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()
    const trelloConfig = loadTrelloConfig(db)

    const projectId = await this.requireProject({
      jsonMode: {
        flags,
        commandName: 'work trello',
        baseCommand: 'prlt work trello',
      },
    })

    const apiKey = getTrelloApiKey(db) || undefined
    const apiToken = getTrelloApiToken(db) || undefined

    let issues: NormalizedIssueEnvelope[]
    try {
      issues = await listTrelloCards({
        apiKey,
        apiToken,
        boardId: trelloConfig?.boardId,
      }, { limit: flags.limit })
    } catch (error: unknown) {
      if (error instanceof ExternalIssueAdapterError) {
        return this.handleError(error.code, error.message, { jsonMode, commandName: 'work trello', flags })
      }
      const msg = error instanceof Error ? error.message : 'Failed to fetch Trello cards.'
      return this.handleError('TRELLO_REQUEST_FAILED', msg, { jsonMode, commandName: 'work trello', flags })
    }

    if (issues.length === 0) {
      return this.handleError('NO_TRELLO_CARDS', 'No active Trello cards found.', { jsonMode, commandName: 'work trello', flags })
    }

    let selectedIssue = issues.find(issue => issue.source.externalKey === flags.card)
    if (!selectedIssue && flags.card) {
      try {
        selectedIssue = await getTrelloCardById({
          apiKey,
          apiToken,
          boardId: trelloConfig?.boardId,
        }, flags.card) ?? undefined
      } catch (error: unknown) {
        if (error instanceof ExternalIssueAdapterError) {
          return this.handleError(error.code, error.message, { jsonMode, commandName: 'work trello', flags })
        }
        const msg = error instanceof Error ? error.message : 'Failed to fetch Trello card.'
        return this.handleError('TRELLO_REQUEST_FAILED', msg, { jsonMode, commandName: 'work trello', flags })
      }

      if (!selectedIssue) {
        return this.handleError('TRELLO_CARD_NOT_FOUND', `Trello card "${flags.card}" was not found.`, { jsonMode, commandName: 'work trello', flags })
      }
    }

    if (!selectedIssue) {
      const selectedKey = await this.selectFromList({
        message: 'Select Trello card to spawn:',
        items: issues,
        getName: (issue) => {
          const priority = issue.priority || 'None'
          return `[${priority}] ${issue.source.externalKey.slice(0, 8)} - ${issue.title}`
        },
        getValue: issue => issue.source.externalKey,
        getCommand: issue => buildTrelloCardChoiceCommand(issue.source.externalKey, projectId),
        jsonMode: jsonMode ? { flags, commandName: 'work trello' } : null,
      })

      if (!selectedKey) {
        return
      }

      selectedIssue = issues.find(issue => issue.source.externalKey === selectedKey)
      if (!selectedIssue) {
        return this.handleError('TRELLO_CARD_NOT_FOUND', `Trello card "${selectedKey}" was not found.`, { jsonMode, commandName: 'work trello', flags })
      }
    }

    const ticket = await this.createOrUpdateLinkedTicket(projectId, selectedIssue)
    await autoExportToBoard(this.pmoPath, this.storage)

    const contextMessage = buildTrelloSpawnContextMessage(selectedIssue, flags.message)
    const args = buildWorkStartArgs({
      ticketId: ticket.id,
      projectId,
      executor: flags.executor,
      display: flags.display,
      runOnHost: flags['run-on-host'],
      skipPermissions: flags['skip-permissions'],
      createPr: flags['create-pr'],
      action: flags.action,
      message: contextMessage,
      json: flags.json,
      machine: flags.machine,
      yes: flags.yes,
    })

    await this.config.runCommand('work:start', args)
  }
}
