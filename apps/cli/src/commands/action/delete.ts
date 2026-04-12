/**
 * prlt action delete <id> — Delete a custom work action.
 */

import { Args } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class ActionDelete extends PMOCommand {
  static description = 'Delete a custom work action'

  static examples = [
    '<%= config.bin %> action delete my-action',
  ]

  static args = {
    id: Args.string({
      description: 'Action ID to delete',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ActionDelete)
    const jsonMode = shouldOutputJson(flags)

    try {
      await this.storage.deleteAction(args.id)

      if (jsonMode) {
        outputSuccessAsJson(
          { deleted: args.id },
          createMetadata('action delete', flags),
        )
        return
      }

      this.log(styles.success(`Action "${args.id}" deleted`))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (jsonMode) {
        outputErrorAsJson('ACTION_DELETE_FAILED', message, createMetadata('action delete', flags))
        return
      }
      this.error(message)
    }
  }
}
