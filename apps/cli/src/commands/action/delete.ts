import { Args } from '@oclif/core'
import { RuntimeCommand, runtimeBaseFlags } from '../../lib/runtime-command.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { getPMOContext } from '../../lib/pmo/pmo-context.js'

export default class ActionDelete extends RuntimeCommand {
  static description = 'Delete a custom action (built-in actions cannot be deleted)'

  static examples = [
    '<%= config.bin %> <%= command.id %> deploy',
  ]

  static flags = {
    ...runtimeBaseFlags,
  }

  static args = {
    name: Args.string({
      description: 'Action name or ID to delete',
      required: true,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ActionDelete)
    const jsonMode = shouldOutputJson(flags)

    const pmoContext = await getPMOContext({
      logger: (msg) => this.log(styles.muted(msg)),
    })

    try {
      const action = await pmoContext.storage.getAction(args.name)

      if (!action) {
        if (jsonMode) {
          outputErrorAsJson('NOT_FOUND', `Action "${args.name}" not found.`, createMetadata('action delete', flags))
          return
        }
        this.error(`Action "${args.name}" not found.`)
      }

      if (action.isBuiltin) {
        if (jsonMode) {
          outputErrorAsJson('BUILTIN_ACTION', `Cannot delete built-in action "${action.name}". Built-in actions can only be edited.`, createMetadata('action delete', flags))
          return
        }
        this.error(`Cannot delete built-in action "${action.name}". Built-in actions can only be edited.`)
      }

      try {
        await pmoContext.storage.deleteAction(args.name)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        if (jsonMode) {
          outputErrorAsJson('DELETE_FAILED', msg, createMetadata('action delete', flags))
          return
        }
        this.error(msg)
        return
      }

      if (jsonMode) {
        outputSuccessAsJson(
          {
            deleted: args.name,
            message: `Action "${action.name}" deleted.`,
          },
          createMetadata('action delete', flags),
        )
        return
      }

      this.log(styles.success(`Action "${action.name}" deleted.`))
    } finally {
      await pmoContext.storage.close()
    }
  }
}
