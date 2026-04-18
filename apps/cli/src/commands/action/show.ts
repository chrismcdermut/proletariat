import { Args } from '@oclif/core'
import { RuntimeCommand, runtimeBaseFlags } from '../../lib/runtime-command.js'
import { styles, divider } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { getPMOContext } from '../../lib/pmo/pmo-context.js'

export default class ActionShow extends RuntimeCommand {
  static description = 'Show full action configuration and prompt'

  static examples = [
    '<%= config.bin %> <%= command.id %> implement',
    '<%= config.bin %> <%= command.id %> groom --json',
  ]

  static flags = {
    ...runtimeBaseFlags,
  }

  static args = {
    name: Args.string({
      description: 'Action name or ID',
      required: true,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ActionShow)
    const jsonMode = shouldOutputJson(flags)

    const pmoContext = await getPMOContext({
      logger: (msg) => this.log(styles.muted(msg)),
    })

    try {
      const action = await pmoContext.storage.getAction(args.name)

      if (!action) {
        if (jsonMode) {
          outputErrorAsJson('NOT_FOUND', `Action "${args.name}" not found.`, createMetadata('action show', flags))
          return
        }
        this.error(`Action "${args.name}" not found.`)
      }

      if (jsonMode) {
        outputSuccessAsJson(
          {
            action: {
              id: action.id,
              name: action.name,
              description: action.description,
              prompt: action.prompt,
              endPrompt: action.endPrompt,
              fromIntent: action.fromIntent,
              toIntent: action.toIntent,
              executor: action.executor,
              environment: action.environment,
              permissionMode: action.permissionMode,
              timeout: action.timeout,
              model: action.model,
              reviewGate: action.reviewGate,
              networkAllowlist: action.networkAllowlist,
              validFrom: action.validFrom,
              modifiesCode: action.modifiesCode,
              isDefault: action.isDefault,
              isBuiltin: action.isBuiltin,
              position: action.position,
              createdAt: action.createdAt?.toISOString(),
              updatedAt: action.updatedAt?.toISOString(),
            },
          },
          createMetadata('action show', flags),
        )
        return
      }

      const builtinBadge = action.isBuiltin ? styles.muted('[built-in]') : styles.info('[custom]')
      this.log(`\n${styles.title('Action')} ${styles.emphasis(action.id)} ${builtinBadge}\n`)
      this.log(`${styles.header('Name:')}          ${action.name}`)
      if (action.description) {
        this.log(`${styles.header('Description:')}   ${action.description}`)
      }
      this.log(`${styles.header('From Intent:')}   ${action.fromIntent || 'any'}`)
      this.log(`${styles.header('To Intent:')}     ${action.toIntent || 'none'}`)
      this.log(`${styles.header('Valid From:')}    ${action.validFrom?.length ? action.validFrom.join(', ') : 'any state'}`)
      this.log(`${styles.header('Executor:')}      ${action.executor || 'workspace default'}`)
      this.log(`${styles.header('Environment:')}   ${action.environment || 'workspace default'}`)
      this.log(`${styles.header('Timeout:')}       ${action.timeout ? `${action.timeout}s` : 'default'}`)
      this.log(`${styles.header('Modifies Code:')} ${action.modifiesCode ? 'yes' : 'no'}`)
      this.log(`${styles.header('Default:')}       ${action.isDefault ? 'yes' : 'no'}`)
      if (action.model) {
        this.log(`${styles.header('Model:')}         ${action.model}`)
      }
      if (action.reviewGate) {
        this.log(`${styles.header('Review Gate:')}   ${action.reviewGate}`)
      }
      if (action.permissionMode) {
        this.log(`${styles.header('Permissions:')}   ${action.permissionMode}`)
      }
      if (action.networkAllowlist?.length) {
        this.log(`${styles.header('Network:')}       ${action.networkAllowlist.join(', ')}`)
      }

      this.log(`\n${styles.header('Prompt:')}`)
      this.log(divider(60))
      this.log(action.prompt)
      this.log(divider(60))

      if (action.endPrompt) {
        this.log(`\n${styles.header('End Prompt:')}`)
        this.log(divider(60))
        this.log(action.endPrompt)
        this.log(divider(60))
      }

      this.log('')
    } finally {
      await pmoContext.storage.close()
    }
  }
}
