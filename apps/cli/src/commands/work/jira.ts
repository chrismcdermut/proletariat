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
import { setInternalAction } from '../../services/action-context.js'
import {
  ExternalIssueAdapterError,
  type NormalizedIssueEnvelope,
} from '../../lib/external-issues/types.js'
import {
  listJiraIssues,
  getJiraIssueByKey,
  buildJiraIssueChoiceCommand,
  buildJiraTicketDescription,
  buildJiraMetadata,
  buildJiraSpawnContextMessage,
} from '../../lib/external-issues/jira.js'

function buildWorkStartArgs(options: {
  ticketId: string
  projectId: string
  executor?: string
  display?: string
  runOnHost?: boolean
  skipPermissions?: boolean
  createPr?: boolean
  message?: string
  json?: boolean
  machine?: boolean
  yes?: boolean
}): string[] {
  // Note: action is no longer forwarded via `--action` (removed in PRLT-1316).
  // Callers should route the action through setInternalAction() instead.
  const args = [options.ticketId, '--project', options.projectId, '--ephemeral']

  if (options.executor) args.push('--executor', options.executor)
  if (options.display) args.push('--display', options.display)
  if (options.runOnHost) args.push('--run-on-host')
  if (options.skipPermissions) args.push('--skip-permissions')
  if (options.createPr) args.push('--create-pr')
  if (options.message) args.push('--message', options.message)
  if (options.json) args.push('--json')
  if (options.machine) args.push('--machine')
  if (options.yes) args.push('--yes')

  return args
}

export default class WorkJira extends PMOCommand {
  static description = 'List/select Jira issues and spawn work using the existing work-start flow'

  static examples = [
    '<%= config.bin %> <%= command.id %> --host https://myorg.atlassian.net --project-key PROJ',
    '<%= config.bin %> <%= command.id %> --host https://myorg.atlassian.net --issue PROJ-123',
    '<%= config.bin %> <%= command.id %> --host https://myorg.atlassian.net --issue PROJ-123 --yes --skip-permissions --display terminal',
  ]

  static flags = {
    ...pmoBaseFlags,
    host: Flags.string({
      description: 'Jira host URL (fallback: PRLT_JIRA_HOST or JIRA_HOST)',
    }),
    email: Flags.string({
      description: 'Jira account email (fallback: PRLT_JIRA_EMAIL or JIRA_EMAIL)',
    }),
    token: Flags.string({
      description: 'Jira API token (fallback: PRLT_JIRA_API_TOKEN or JIRA_API_TOKEN)',
    }),
    'project-key': Flags.string({
      description: 'Jira project key for listing issues (fallback: PRLT_JIRA_PROJECT or JIRA_PROJECT_KEY)',
    }),
    jql: Flags.string({
      description: 'Custom JQL for listing issues (overrides project key filters)',
    }),
    issue: Flags.string({
      description: 'Jira issue key (for example: PROJ-123)',
    }),
    limit: Flags.integer({
      char: 'l',
      description: 'Maximum number of Jira issues to fetch',
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
      return source === 'jira'
        && (key === envelope.source.externalKey || id === envelope.source.externalId)
    })
  }

  private async createOrUpdateLinkedTicket(projectId: string, envelope: NormalizedIssueEnvelope): Promise<Ticket> {
    const existing = await this.findLinkedTicket(projectId, envelope)
    const description = buildJiraTicketDescription(envelope)
    const metadata = buildJiraMetadata(envelope)

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
    const { flags } = await this.parse(WorkJira)
    const jsonMode = shouldOutputJson(flags)

    const projectId = await this.requireProject({
      jsonMode: {
        flags,
        commandName: 'work jira',
        baseCommand: 'prlt work jira',
      },
    })

    const config = {
      host: flags.host,
      email: flags.email,
      apiToken: flags.token,
      projectKey: flags['project-key'],
      jql: flags.jql,
    }

    let issues: NormalizedIssueEnvelope[]
    try {
      issues = await listJiraIssues(config, {
        limit: flags.limit,
      })
    } catch (error: unknown) {
      if (error instanceof ExternalIssueAdapterError) {
        return this.handleError(error.code, error.message, { jsonMode, commandName: 'work jira', flags })
      }
      const msg = error instanceof Error ? error.message : 'Failed to fetch Jira issues.'
      return this.handleError('JIRA_REQUEST_FAILED', msg, { jsonMode, commandName: 'work jira', flags })
    }

    if (issues.length === 0) {
      return this.handleError('NO_JIRA_ISSUES', 'No matching Jira issues found for the configured query.', { jsonMode, commandName: 'work jira', flags })
    }

    let selectedIssue = issues.find(issue => issue.source.externalKey === flags.issue?.toUpperCase())
    if (!selectedIssue && flags.issue) {
      try {
        selectedIssue = await getJiraIssueByKey(config, flags.issue) ?? undefined
      } catch (error: unknown) {
        if (error instanceof ExternalIssueAdapterError) {
          return this.handleError(error.code, error.message, { jsonMode, commandName: 'work jira', flags })
        }
        const msg = error instanceof Error ? error.message : 'Failed to fetch Jira issue.'
        return this.handleError('JIRA_REQUEST_FAILED', msg, { jsonMode, commandName: 'work jira', flags })
      }

      if (!selectedIssue) {
        return this.handleError('JIRA_ISSUE_NOT_FOUND', `Jira issue "${flags.issue}" was not found.`, { jsonMode, commandName: 'work jira', flags })
      }
    }

    if (!selectedIssue) {
      const selectedKey = await this.selectFromList({
        message: 'Select Jira issue to spawn:',
        items: issues,
        getName: (issue) => {
          const priority = issue.priority || 'None'
          return `[${priority}] ${issue.source.externalKey} - ${issue.title}`
        },
        getValue: issue => issue.source.externalKey,
        getCommand: issue => buildJiraIssueChoiceCommand(issue.source.externalKey, projectId),
        jsonMode: jsonMode ? { flags, commandName: 'work jira' } : null,
      })

      if (!selectedKey) {
        return
      }

      selectedIssue = issues.find(issue => issue.source.externalKey === selectedKey)
      if (!selectedIssue) {
        return this.handleError('JIRA_ISSUE_NOT_FOUND', `Jira issue "${selectedKey}" was not found.`, { jsonMode, commandName: 'work jira', flags })
      }
    }

    const ticket = await this.createOrUpdateLinkedTicket(projectId, selectedIssue)
    await autoExportToBoard(this.pmoPath, this.storage)

    const contextMessage = buildJiraSpawnContextMessage(selectedIssue, flags.message)
    const args = buildWorkStartArgs({
      ticketId: ticket.id,
      projectId,
      executor: flags.executor,
      display: flags.display,
      runOnHost: flags['run-on-host'],
      skipPermissions: flags['skip-permissions'],
      createPr: flags['create-pr'],
      message: contextMessage,
      json: flags.json,
      machine: flags.machine,
      yes: flags.yes,
    })

    // Action is routed through the internal action-context channel (PRLT-1316).
    if (flags.action) setInternalAction(flags.action)
    await this.config.runCommand('work:start', args)
  }
}
