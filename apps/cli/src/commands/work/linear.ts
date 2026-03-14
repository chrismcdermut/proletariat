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
  listLinearIssues,
  getLinearIssueByIdentifier,
  buildLinearIssueChoiceCommand,
  buildLinearTicketDescription,
  buildLinearMetadata,
  buildLinearSpawnContextMessage,
} from '../../lib/external-issues/linear.js'
import { getLinearApiKey, loadLinearConfig } from '../../lib/linear/index.js'
import { LinearMapper } from '../../lib/linear/mapper.js'

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

export default class WorkLinear extends PMOCommand {
  static description = 'List/select Linear issues and spawn work using the existing work-start flow'

  static examples = [
    '<%= config.bin %> <%= command.id %> --team ENG',
    '<%= config.bin %> <%= command.id %> --team ENG --issue ENG-123',
    '<%= config.bin %> <%= command.id %> --team ENG --issue ENG-123 --yes --skip-permissions --display terminal',
  ]

  static flags = {
    ...pmoBaseFlags,
    team: Flags.string({
      description: 'Linear team key (fallback: PRLT_LINEAR_TEAM)',
    }),
    issue: Flags.string({
      description: 'Linear issue identifier (for example: ENG-123)',
    }),
    limit: Flags.integer({
      char: 'l',
      description: 'Maximum number of Linear issues to fetch',
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
      return source === 'linear'
        && (key === envelope.source.externalKey || id === envelope.source.externalId)
    })
  }

  private async createOrUpdateLinkedTicket(projectId: string, envelope: NormalizedIssueEnvelope): Promise<Ticket> {
    const existing = await this.findLinkedTicket(projectId, envelope)
    const description = buildLinearTicketDescription(envelope)
    const metadata = buildLinearMetadata(envelope)

    let ticket: Ticket
    if (existing) {
      ticket = await this.storage.updateTicket(existing.id, {
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
    } else {
      ticket = await this.storage.createTicket(projectId, {
        title: envelope.title,
        description,
        priority: envelope.priority ?? undefined,
        category: envelope.category ?? undefined,
        labels: envelope.labels,
        metadata,
      })
    }

    // Create Linear mapping so OutboundSyncHandler can push status/PR changes back
    const db = this.storage.getDatabase()
    const mapper = new LinearMapper(db)
    const existingMapping = mapper.getByTicketId(ticket.id)
    if (!existingMapping) {
      mapper.createMapping({
        pmoTicketId: ticket.id,
        linearIssueId: envelope.source.externalId,
        linearIdentifier: envelope.source.externalKey,
        linearTeamKey: envelope.projectKey,
        linearUrl: envelope.source.url,
        syncDirection: 'outbound',
        createdAt: new Date(),
      })
    }

    return ticket
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(WorkLinear)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()
    const linearConfig = loadLinearConfig(db)

    const projectId = await this.requireProject({
      jsonMode: {
        flags,
        commandName: 'work linear',
        baseCommand: 'prlt work linear',
      },
    })

    const apiKey = getLinearApiKey(db) || undefined
    const team = flags.team || linearConfig?.defaultTeamKey || process.env.PRLT_LINEAR_TEAM

    let issues: NormalizedIssueEnvelope[]
    try {
      issues = await listLinearIssues({
        apiKey,
        team,
      }, { limit: flags.limit })
    } catch (error: unknown) {
      if (error instanceof ExternalIssueAdapterError) {
        return this.handleError(error.code, error.message, { jsonMode, commandName: 'work linear', flags })
      }
      const msg = error instanceof Error ? error.message : 'Failed to fetch Linear issues.'
      return this.handleError('LINEAR_REQUEST_FAILED', msg, { jsonMode, commandName: 'work linear', flags })
    }

    if (issues.length === 0) {
      return this.handleError('NO_LINEAR_ISSUES', 'No active Linear issues found for the configured team.', { jsonMode, commandName: 'work linear', flags })
    }

    let selectedIssue = issues.find(issue => issue.source.externalKey === flags.issue)
    if (!selectedIssue && flags.issue) {
      try {
        selectedIssue = await getLinearIssueByIdentifier({
          apiKey,
          team,
        }, flags.issue) ?? undefined
      } catch (error: unknown) {
        if (error instanceof ExternalIssueAdapterError) {
          return this.handleError(error.code, error.message, { jsonMode, commandName: 'work linear', flags })
        }
        const msg = error instanceof Error ? error.message : 'Failed to fetch Linear issue.'
        return this.handleError('LINEAR_REQUEST_FAILED', msg, { jsonMode, commandName: 'work linear', flags })
      }

      if (!selectedIssue) {
        return this.handleError('LINEAR_ISSUE_NOT_FOUND', `Linear issue "${flags.issue}" was not found.`, { jsonMode, commandName: 'work linear', flags })
      }
    }

    if (!selectedIssue) {
      const selectedKey = await this.selectFromList({
        message: 'Select Linear issue to spawn:',
        items: issues,
        getName: (issue) => {
          const priority = issue.priority || 'None'
          return `[${priority}] ${issue.source.externalKey} - ${issue.title}`
        },
        getValue: issue => issue.source.externalKey,
        getCommand: issue => {
          const base = buildLinearIssueChoiceCommand(issue.source.externalKey, projectId)
          return team ? `${base} --team ${team}` : base
        },
        jsonMode: jsonMode ? { flags, commandName: 'work linear' } : null,
      })

      if (!selectedKey) {
        return
      }

      selectedIssue = issues.find(issue => issue.source.externalKey === selectedKey)
      if (!selectedIssue) {
        return this.handleError('LINEAR_ISSUE_NOT_FOUND', `Linear issue "${selectedKey}" was not found.`, { jsonMode, commandName: 'work linear', flags })
      }
    }

    const ticket = await this.createOrUpdateLinkedTicket(projectId, selectedIssue)
    await autoExportToBoard(this.pmoPath, this.storage)

    const contextMessage = buildLinearSpawnContextMessage(selectedIssue, flags.message)
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
