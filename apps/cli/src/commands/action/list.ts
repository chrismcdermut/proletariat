/**
 * prlt action list — List all configured work actions.
 */

import { Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class ActionList extends PMOCommand {
  static description = 'List all configured work actions'

  static examples = [
    '<%= config.bin %> action list',
    '<%= config.bin %> action list --builtin',
    '<%= config.bin %> action list --intent ready',
  ]

  static flags = {
    ...pmoBaseFlags,
    builtin: Flags.boolean({
      description: 'Show only built-in actions',
      default: false,
    }),
    custom: Flags.boolean({
      description: 'Show only custom actions',
      default: false,
    }),
    intent: Flags.string({
      description: 'Filter by from_intent',
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ActionList)
    const jsonMode = shouldOutputJson(flags)

    const filter: { isBuiltin?: boolean; fromIntent?: string } = {}
    if (flags.builtin) filter.isBuiltin = true
    if (flags.custom) filter.isBuiltin = false
    if (flags.intent) filter.fromIntent = flags.intent

    const actions = await this.storage.listActions(filter)

    if (jsonMode) {
      outputSuccessAsJson(
        {
          actions: actions.map(a => ({
            id: a.id,
            name: a.name,
            toIntent: a.toIntent,
            fromIntent: a.fromIntent || null,
            executor: a.executor || null,
            isBuiltin: a.isBuiltin,
            isDefault: a.isDefault,
            description: a.description || null,
          })),
          count: actions.length,
        },
        createMetadata('action list', flags),
      )
      return
    }

    if (actions.length === 0) {
      this.log(styles.info('No actions found.'))
      this.log(styles.muted('  Create one with: prlt action create <name> --to-intent <intent> --prompt "..."'))
      return
    }

    this.log(styles.title('Work Actions'))
    this.log('')

    for (const action of actions) {
      const tag = action.isBuiltin ? styles.muted('[builtin]') : styles.info('[custom]')
      const defaultTag = action.isDefault ? styles.success(' (default)') : ''
      this.log(`  ${styles.emphasis(action.name)} ${tag}${defaultTag}`)
      this.log(`    ${styles.emphasis('ID:')}          ${action.id}`)
      this.log(`    ${styles.emphasis('To Intent:')}   ${action.toIntent || styles.muted('(none)')}`)
      this.log(`    ${styles.emphasis('From Intent:')} ${action.fromIntent || styles.muted('(any / manual only)')}`)
      if (action.executor) {
        this.log(`    ${styles.emphasis('Executor:')}    ${action.executor}`)
      }
      if (action.description) {
        this.log(`    ${styles.muted(action.description)}`)
      }
      this.log('')
    }

    this.log(styles.muted(`  ${actions.length} action${actions.length === 1 ? '' : 's'}`))
  }
}
