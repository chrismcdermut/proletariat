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
  listShortcutStories,
  getShortcutStoryByKey,
  buildShortcutStoryChoiceCommand,
  buildShortcutTicketDescription,
  buildShortcutMetadata,
  buildShortcutSpawnContextMessage,
} from '../../lib/external-issues/shortcut.js'
import { getShortcutApiToken, loadShortcutConfig } from '../../lib/shortcut/index.js'
import { setInternalAction } from '../../services/action-context.js'

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

export default class WorkShortcut extends PMOCommand {
  static description = 'List/select Shortcut stories and spawn work using the existing work-start flow'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --issue sc-123',
    '<%= config.bin %> <%= command.id %> --issue sc-123 --yes --skip-permissions --display terminal',
  ]

  static flags = {
    ...pmoBaseFlags,
    issue: Flags.string({
      description: 'Shortcut story key (for example: sc-123 or 123)',
    }),
    limit: Flags.integer({
      char: 'l',
      description: 'Maximum number of Shortcut stories to fetch',
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
      return source === 'shortcut'
        && (key === envelope.source.externalKey || id === envelope.source.externalId)
    })
  }

  private async createOrUpdateLinkedTicket(projectId: string, envelope: NormalizedIssueEnvelope): Promise<Ticket> {
    const existing = await this.findLinkedTicket(projectId, envelope)
    const description = buildShortcutTicketDescription(envelope)
    const metadata = buildShortcutMetadata(envelope)

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
    const { flags } = await this.parse(WorkShortcut)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()
    const shortcutConfig = loadShortcutConfig(db)

    const projectId = await this.requireProject({
      jsonMode: {
        flags,
        commandName: 'work shortcut',
        baseCommand: 'prlt work shortcut',
      },
    })

    const apiToken = getShortcutApiToken(db) || undefined

    let issues: NormalizedIssueEnvelope[]
    try {
      issues = await listShortcutStories({
        apiToken,
        workspaceSlug: shortcutConfig?.workspaceSlug,
      }, { limit: flags.limit })
    } catch (error: unknown) {
      if (error instanceof ExternalIssueAdapterError) {
        return this.handleError(error.code, error.message, { jsonMode, commandName: 'work shortcut', flags })
      }
      const msg = error instanceof Error ? error.message : 'Failed to fetch Shortcut stories.'
      return this.handleError('SHORTCUT_REQUEST_FAILED', msg, { jsonMode, commandName: 'work shortcut', flags })
    }

    if (issues.length === 0) {
      return this.handleError('NO_SHORTCUT_STORIES', 'No active Shortcut stories found.', { jsonMode, commandName: 'work shortcut', flags })
    }

    let selectedIssue = issues.find(issue => issue.source.externalKey === flags.issue)
    if (!selectedIssue && flags.issue) {
      try {
        selectedIssue = await getShortcutStoryByKey({
          apiToken,
          workspaceSlug: shortcutConfig?.workspaceSlug,
        }, flags.issue) ?? undefined
      } catch (error: unknown) {
        if (error instanceof ExternalIssueAdapterError) {
          return this.handleError(error.code, error.message, { jsonMode, commandName: 'work shortcut', flags })
        }
        const msg = error instanceof Error ? error.message : 'Failed to fetch Shortcut story.'
        return this.handleError('SHORTCUT_REQUEST_FAILED', msg, { jsonMode, commandName: 'work shortcut', flags })
      }

      if (!selectedIssue) {
        return this.handleError('SHORTCUT_STORY_NOT_FOUND', `Shortcut story "${flags.issue}" was not found.`, { jsonMode, commandName: 'work shortcut', flags })
      }
    }

    if (!selectedIssue) {
      const selectedKey = await this.selectFromList({
        message: 'Select Shortcut story to spawn:',
        items: issues,
        getName: (issue) => {
          const priority = issue.priority || 'None'
          return `[${priority}] ${issue.source.externalKey} - ${issue.title}`
        },
        getValue: issue => issue.source.externalKey,
        getCommand: issue => buildShortcutStoryChoiceCommand(issue.source.externalKey, projectId),
        jsonMode: jsonMode ? { flags, commandName: 'work shortcut' } : null,
      })

      if (!selectedKey) {
        return
      }

      selectedIssue = issues.find(issue => issue.source.externalKey === selectedKey)
      if (!selectedIssue) {
        return this.handleError('SHORTCUT_STORY_NOT_FOUND', `Shortcut story "${selectedKey}" was not found.`, { jsonMode, commandName: 'work shortcut', flags })
      }
    }

    const ticket = await this.createOrUpdateLinkedTicket(projectId, selectedIssue)
    await autoExportToBoard(this.pmoPath, this.storage)

    const contextMessage = buildShortcutSpawnContextMessage(selectedIssue, flags.message)
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
