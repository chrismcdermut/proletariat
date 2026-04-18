import { Args, Flags } from '@oclif/core'
import { RuntimeCommand, runtimeBaseFlags } from '../../lib/runtime-command.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { getPMOContext } from '../../lib/pmo/pmo-context.js'
import type { WorkAction } from '../../lib/pmo/types.js'

export default class ActionCreate extends RuntimeCommand {
  static description = 'Create a new custom action'

  static examples = [
    '<%= config.bin %> <%= command.id %> deploy --prompt "Deploy the changes to staging"',
    '<%= config.bin %> <%= command.id %> lint --prompt "Run linter and fix issues" --from-intent started --to-intent needs_review',
  ]

  static flags = {
    ...runtimeBaseFlags,
    prompt: Flags.string({
      description: 'Action prompt (agent instructions)',
      required: true,
    }),
    description: Flags.string({
      char: 'd',
      description: 'Short description of the action',
    }),
    'valid-from': Flags.string({
      description: 'Comma-separated list of intents from which this action may run (empty = any state)',
      multiple: true,
    }),
    'from-intent': Flags.string({
      description: 'Intent that triggers this action (deprecated — use --valid-from)',
    }),
    'to-intent': Flags.string({
      description: 'Intent to move ticket to after action completes',
    }),
    executor: Flags.string({
      description: 'Executor override',
      options: ['claude', 'codex', 'opencode', 'custom'],
    }),
    environment: Flags.string({
      description: 'Execution environment',
      options: ['devcontainer', 'docker', 'host', 'vm'],
    }),
    timeout: Flags.integer({
      description: 'Timeout in seconds',
    }),
    'end-prompt': Flags.string({
      description: 'Completion instructions prompt',
    }),
    'modifies-code': Flags.boolean({
      description: 'Whether this action modifies code',
      default: true,
      allowNo: true,
    }),
  }

  static args = {
    name: Args.string({
      description: 'Unique action name',
      required: true,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ActionCreate)
    const jsonMode = shouldOutputJson(flags)

    const pmoContext = await getPMOContext({
      logger: (msg) => this.log(styles.muted(msg)),
    })

    try {
      // Parse --valid-from: supports comma-separated and repeated flags
      const validFromRaw = flags['valid-from'] as string[] | undefined
      const validFrom = validFromRaw
        ? validFromRaw.flatMap(v => v.split(',').map(s => s.trim())).filter(Boolean)
        : undefined

      const actionData: Partial<WorkAction> = {
        name: args.name,
        prompt: flags.prompt,
        description: flags.description,
        validFrom,
        fromIntent: flags['from-intent'],
        toIntent: flags['to-intent'],
        executor: flags.executor as WorkAction['executor'],
        environment: flags.environment as WorkAction['environment'],
        timeout: flags.timeout,
        endPrompt: flags['end-prompt'],
        modifiesCode: flags['modifies-code'],
        isBuiltin: false,
      }

      let action: WorkAction
      try {
        action = await pmoContext.storage.createAction(actionData)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        if (jsonMode) {
          outputErrorAsJson('CREATE_FAILED', msg, createMetadata('action create', flags))
          return
        }
        this.error(msg)
        return
      }

      if (jsonMode) {
        outputSuccessAsJson(
          {
            action: {
              id: action.id,
              name: action.name,
              description: action.description,
              isBuiltin: action.isBuiltin,
            },
            message: `Action "${action.name}" created.`,
          },
          createMetadata('action create', flags),
        )
        return
      }

      this.log(styles.success(`Action "${action.name}" created (id: ${action.id})`))
    } finally {
      await pmoContext.storage.close()
    }
  }
}
