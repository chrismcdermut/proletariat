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
  listAsanaTasks,
  getAsanaTaskByGid,
  buildAsanaTaskChoiceCommand,
  buildAsanaTicketDescription,
  buildAsanaMetadata,
  buildAsanaSpawnContextMessage,
} from '../../lib/external-issues/asana.js'
import { getAsanaAccessToken, loadAsanaConfig } from '../../lib/asana/index.js'

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

export default class WorkAsana extends PMOCommand {
  static description = 'List/select Asana tasks and spawn work using the existing work-start flow'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --task 1234567890',
    '<%= config.bin %> <%= command.id %> --task 1234567890 --yes --skip-permissions --display terminal',
  ]

  static flags = {
    ...pmoBaseFlags,
    task: Flags.string({
      description: 'Asana task GID (for example: 1234567890)',
    }),
    limit: Flags.integer({
      char: 'l',
      description: 'Maximum number of Asana tasks to fetch',
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
      return source === 'asana'
        && (key === envelope.source.externalKey || id === envelope.source.externalId)
    })
  }

  private async createOrUpdateLinkedTicket(projectId: string, envelope: NormalizedIssueEnvelope): Promise<Ticket> {
    const existing = await this.findLinkedTicket(projectId, envelope)
    const description = buildAsanaTicketDescription(envelope)
    const metadata = buildAsanaMetadata(envelope)

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
    const { flags } = await this.parse(WorkAsana)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()
    const asanaConfig = loadAsanaConfig(db)

    const projectId = await this.requireProject({
      jsonMode: {
        flags,
        commandName: 'work asana',
        baseCommand: 'prlt work asana',
      },
    })

    const accessToken = getAsanaAccessToken(db) || undefined
    const asanaProjectGid = asanaConfig?.projectGid

    const config = {
      accessToken,
      projectGid: asanaProjectGid,
    }

    let tasks: NormalizedIssueEnvelope[]
    try {
      tasks = await listAsanaTasks(config, {
        limit: flags.limit,
      })
    } catch (error: unknown) {
      if (error instanceof ExternalIssueAdapterError) {
        return this.handleError(error.code, error.message, { jsonMode, commandName: 'work asana', flags })
      }
      const msg = error instanceof Error ? error.message : 'Failed to fetch Asana tasks.'
      return this.handleError('ASANA_REQUEST_FAILED', msg, { jsonMode, commandName: 'work asana', flags })
    }

    if (tasks.length === 0) {
      return this.handleError('NO_ASANA_TASKS', 'No active Asana tasks found in the configured project.', { jsonMode, commandName: 'work asana', flags })
    }

    let selectedTask = tasks.find(task => task.source.externalKey === flags.task)
    if (!selectedTask && flags.task) {
      try {
        selectedTask = await getAsanaTaskByGid(config, flags.task) ?? undefined
      } catch (error: unknown) {
        if (error instanceof ExternalIssueAdapterError) {
          return this.handleError(error.code, error.message, { jsonMode, commandName: 'work asana', flags })
        }
        const msg = error instanceof Error ? error.message : 'Failed to fetch Asana task.'
        return this.handleError('ASANA_REQUEST_FAILED', msg, { jsonMode, commandName: 'work asana', flags })
      }

      if (!selectedTask) {
        return this.handleError('ASANA_TASK_NOT_FOUND', `Asana task "${flags.task}" was not found.`, { jsonMode, commandName: 'work asana', flags })
      }
    }

    if (!selectedTask) {
      const selectedKey = await this.selectFromList({
        message: 'Select Asana task to spawn:',
        items: tasks,
        getName: (task) => {
          const assignee = task.assignee || 'Unassigned'
          return `[${assignee}] ${task.title}`
        },
        getValue: task => task.source.externalKey,
        getCommand: task => buildAsanaTaskChoiceCommand(task.source.externalKey, projectId),
        jsonMode: jsonMode ? { flags, commandName: 'work asana' } : null,
      })

      if (!selectedKey) {
        return
      }

      selectedTask = tasks.find(task => task.source.externalKey === selectedKey)
      if (!selectedTask) {
        return this.handleError('ASANA_TASK_NOT_FOUND', `Asana task "${selectedKey}" was not found.`, { jsonMode, commandName: 'work asana', flags })
      }
    }

    const ticket = await this.createOrUpdateLinkedTicket(projectId, selectedTask)
    await autoExportToBoard(this.pmoPath, this.storage)

    const contextMessage = buildAsanaSpawnContextMessage(selectedTask, flags.message)
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
