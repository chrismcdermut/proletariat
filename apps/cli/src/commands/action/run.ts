import { Args, Flags } from '@oclif/core'
import { RuntimeCommand, runtimeBaseFlags } from '../../lib/runtime-command.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { getPMOContext } from '../../lib/pmo/pmo-context.js'
import { setInternalAction } from '../../services/action-context.js'

export default class ActionRun extends RuntimeCommand {
  static description = 'Run an action on a ticket'

  static examples = [
    '<%= config.bin %> <%= command.id %> implement PRLT-123',
    '<%= config.bin %> <%= command.id %> groom PRLT-456',
    '<%= config.bin %> <%= command.id %> review PRLT-789',
  ]

  static flags = {
    ...runtimeBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Bypass action state guardrails',
      default: false,
    }),
  }

  static args = {
    name: Args.string({
      description: 'Action name or ID to run',
      required: true,
    }),
    ticket: Args.string({
      description: 'Ticket ID to run the action on',
      required: true,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ActionRun)
    const jsonMode = shouldOutputJson(flags)

    const pmoContext = await getPMOContext({
      logger: (msg) => this.log(styles.muted(msg)),
    })

    try {
      // Verify the action exists
      const action = await pmoContext.storage.getAction(args.name)

      if (!action) {
        if (jsonMode) {
          outputErrorAsJson('NOT_FOUND', `Action "${args.name}" not found.`, createMetadata('action run', flags))
          return
        }
        this.error(`Action "${args.name}" not found.`)
      }

      // Delegate to work:start with the action set via internal context
      setInternalAction(args.name)

      this.log(styles.muted(`Running action "${action.name}" on ${args.ticket}...`))

      const workStartArgs = [args.ticket]
      if (flags.force) workStartArgs.push('--force')
      await this.config.runCommand('work:start', workStartArgs)
    } finally {
      await pmoContext.storage.close()
    }
  }
}
