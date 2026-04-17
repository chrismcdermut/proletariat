import { Flags } from '@oclif/core'
import { RuntimeCommand, runtimeBaseFlags } from '../../lib/runtime-command.js'
import { styles, divider } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { getPMOContext } from '../../lib/pmo/pmo-context.js'
import type { WorkActionFilter } from '../../lib/pmo/types.js'

export default class ActionList extends RuntimeCommand {
  static description = 'List all configured actions'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --builtin',
    '<%= config.bin %> <%= command.id %> --search groom',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...runtimeBaseFlags,
    builtin: Flags.boolean({
      description: 'Show only built-in actions',
      default: false,
    }),
    custom: Flags.boolean({
      description: 'Show only custom actions',
      default: false,
    }),
    search: Flags.string({
      char: 's',
      description: 'Search by name or description',
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ActionList)
    const jsonMode = shouldOutputJson(flags)

    const pmoContext = await getPMOContext({
      logger: (msg) => this.log(styles.muted(msg)),
    })

    try {
      const filter: WorkActionFilter = {}
      if (flags.builtin) filter.isBuiltin = true
      if (flags.custom) filter.isBuiltin = false
      if (flags.search) filter.search = flags.search

      const actions = await pmoContext.storage.listActions(filter)

      if (jsonMode) {
        outputSuccessAsJson(
          {
            actions: actions.map(a => ({
              id: a.id,
              name: a.name,
              description: a.description,
              fromIntent: a.fromIntent,
              toIntent: a.toIntent,
              executor: a.executor,
              timeout: a.timeout,
              isBuiltin: a.isBuiltin,
              isDefault: a.isDefault,
              modifiesCode: a.modifiesCode,
            })),
            count: actions.length,
          },
          createMetadata('action list', flags),
        )
        return
      }

      if (actions.length === 0) {
        this.log(styles.info('No actions found.'))
        return
      }

      this.log(styles.title('Actions'))
      this.log('')

      for (const action of actions) {
        const builtinBadge = action.isBuiltin ? styles.muted('[built-in]') : styles.info('[custom]')
        const defaultBadge = action.isDefault ? styles.success(' (default)') : ''
        this.log(`  ${styles.code(action.id)} ${builtinBadge}${defaultBadge}`)
        if (action.description) {
          this.log(`    ${styles.muted(action.description)}`)
        }
        const intent = []
        if (action.fromIntent) intent.push(`from: ${action.fromIntent}`)
        if (action.toIntent) intent.push(`to: ${action.toIntent}`)
        if (intent.length > 0) {
          this.log(`    ${styles.muted(intent.join(' → '))}`)
        }
        this.log('')
      }

      this.log(divider(50))
      this.log(styles.muted(`  ${actions.length} action${actions.length === 1 ? '' : 's'}`))
    } finally {
      await pmoContext.storage.close()
    }
  }
}
