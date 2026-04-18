import { Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PromptCommand } from '../../../lib/prompt-command.js'
import { machineOutputFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { getWorkspaceInfo } from '../../../lib/agents/commands.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  outputPromptAsJson,
  buildPromptConfig,
  createMetadata,
} from '../../../lib/prompt-json.js'
import { withSignalSafePrompt } from '../../../lib/signal-handler.js'
import { WorkHookStorage, HOOKABLE_EVENTS, HOOK_ACTION_TYPES } from '../../../lib/work-lifecycle/hooks/index.js'
import type { HookableEvent, HookActionType } from '../../../lib/work-lifecycle/hooks/index.js'
import { openWorkspaceDatabase } from '../../../lib/database/index.js'

export default class WorkHooksAdd extends PromptCommand {
  static description = 'Add a work lifecycle hook'

  static examples = [
    '<%= config.bin %> <%= command.id %> --name notify-start --event work:started --action-type log --action-value "Work started on {{workItemId}}"',
    '<%= config.bin %> <%= command.id %> --name deploy-hook --event work:completed --action-type shell --action-value "./scripts/deploy.sh"',
    '<%= config.bin %> <%= command.id %> --name slack-notify --event work:pr_created --action-type webhook --action-value "https://hooks.slack.com/..."',
  ]

  static flags = {
    ...machineOutputFlags,
    name: Flags.string({
      description: 'Hook name (unique identifier)',
    }),
    event: Flags.string({
      description: 'Event to trigger on',
      options: HOOKABLE_EVENTS,
    }),
    'action-type': Flags.string({
      description: 'Action type (shell, webhook, log, poke, action, llm)',
      options: HOOK_ACTION_TYPES,
    }),
    'action-value': Flags.string({
      description: 'Action payload (command, URL, message template, or action name)',
    }),
    'action-ref': Flags.string({
      description: 'Reference to a shared action definition (for action/poke types)',
    }),
    description: Flags.string({
      description: 'Optional description',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(WorkHooksAdd)
    const jsonMode = shouldOutputJson(flags)

    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('work hooks add', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    const db = openWorkspaceDatabase(workspaceInfo.path)

    try {
      const hookStorage = new WorkHookStorage(db)

      // Collect name
      let name = (flags as { name?: string }).name
      if (!name) {
        const message = 'Hook name:'
        const choices = undefined

        if (jsonMode) {
          outputPromptAsJson(
            buildPromptConfig('input', 'name', message, choices),
            createMetadata('work hooks add', flags),
          )
          return
        }

        const result = await withSignalSafePrompt(() =>
          inquirer.prompt([{
            type: 'input',
            name: 'name',
            message,
            validate: (input: string) => input.trim().length > 0 || 'Name is required',
          }])
        )
        name = result.name
      }

      // Check for duplicate name
      const existing = hookStorage.getByName(name!)
      if (existing) {
        if (jsonMode) {
          outputErrorAsJson('DUPLICATE_NAME', `Hook "${name}" already exists.`, createMetadata('work hooks add', flags))
          return
        }
        this.error(`Hook "${name}" already exists.`)
      }

      // Collect event
      let event = (flags as { event?: string }).event as HookableEvent | undefined
      if (!event) {
        const eventChoices = HOOKABLE_EVENTS.map(e => ({ name: e, value: e }))
        const message = 'Event to trigger on:'

        if (jsonMode) {
          outputPromptAsJson(
            buildPromptConfig('list', 'event', message, eventChoices),
            createMetadata('work hooks add', flags),
          )
          return
        }

        const result = await withSignalSafePrompt(() =>
          inquirer.prompt([{
            type: 'list',
            name: 'event',
            message,
            choices: eventChoices,
          }])
        )
        event = result.event
      }

      // Collect action type
      let actionType = (flags as { 'action-type'?: string })['action-type'] as HookActionType | undefined
      if (!actionType) {
        const actionChoices = [
          { name: 'shell — Run a shell command', value: 'shell' },
          { name: 'webhook — POST event data to a URL', value: 'webhook' },
          { name: 'log — Print a message to stdout', value: 'log' },
          { name: 'poke — Send a message to a named session', value: 'poke' },
          { name: 'action — Fire a named built-in action directly', value: 'action' },
          { name: 'llm — Send to LLM for judgment', value: 'llm' },
        ]
        const message = 'Action type:'

        if (jsonMode) {
          outputPromptAsJson(
            buildPromptConfig('list', 'actionType', message, actionChoices),
            createMetadata('work hooks add', flags),
          )
          return
        }

        const result = await withSignalSafePrompt(() =>
          inquirer.prompt([{
            type: 'list',
            name: 'actionType',
            message,
            choices: actionChoices,
          }])
        )
        actionType = result.actionType
      }

      // Collect action value
      let actionValue = (flags as { 'action-value'?: string })['action-value']
      if (!actionValue) {
        const prompts: Record<HookActionType, string> = {
          shell: 'Shell command to run:',
          webhook: 'Webhook URL:',
          log: 'Log message template (use {ticket_id}, {event}, etc.):',
          poke: 'Message template (use {ticket_id}, {event}, etc.):',
          action: 'Built-in action name (e.g. merge-pr, move-ticket):',
          llm: 'LLM prompt template (use {ticket_id}, {event}, etc.):',
        }
        const message = prompts[actionType!]

        if (jsonMode) {
          outputPromptAsJson(
            buildPromptConfig('input', 'actionValue', message),
            createMetadata('work hooks add', flags),
          )
          return
        }

        const result = await withSignalSafePrompt(() =>
          inquirer.prompt([{
            type: 'input',
            name: 'actionValue',
            message,
            validate: (input: string) => input.trim().length > 0 || 'Action value is required',
          }])
        )
        actionValue = result.actionValue
      }

      // Collect optional description and action ref
      const description = (flags as { description?: string }).description
      const actionRef = (flags as { 'action-ref'?: string })['action-ref']

      // For action/poke types, use actionValue as actionRef if not explicitly provided
      const resolvedActionRef = actionRef || (actionType === 'action' || actionType === 'poke' ? actionValue : undefined)

      // Create the hook
      const hook = hookStorage.create({
        name: name!,
        event: event!,
        actionType: actionType!,
        actionValue: actionValue!,
        actionRef: resolvedActionRef,
        description,
      })

      if (jsonMode) {
        outputSuccessAsJson(
          {
            hook: {
              id: hook.id,
              name: hook.name,
              event: hook.event,
              actionType: hook.actionType,
              actionValue: hook.actionValue,
              actionRef: hook.actionRef,
              enabled: hook.enabled,
              description: hook.description,
            },
            message: `Hook "${hook.name}" created successfully.`,
          },
          createMetadata('work hooks add', flags),
        )
        return
      }

      this.log(styles.success(`Hook "${hook.name}" created.`))
      this.log(styles.muted(`  Event:  ${hook.event}`))
      this.log(styles.muted(`  Action: ${hook.actionType} → ${hook.actionValue}`))
      this.log(styles.muted(`  ID:     ${hook.id}`))
    } finally {
      db.close()
    }
  }
}
