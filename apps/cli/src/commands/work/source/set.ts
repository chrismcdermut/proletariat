import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../../lib/prompt-json.js'
import {
  parseWorkSourceRef,
  formatWorkSourceRef,
  saveDefaultWorkSource,
} from '../../../lib/work-source/index.js'

export default class WorkSourceSet extends PMOCommand {
  static description = 'Set the default work source used by "work start" and "work spawn"'

  static strict = false

  static examples = [
    '<%= config.bin %> <%= command.id %> pmo',
    '<%= config.bin %> <%= command.id %> linear:PRO',
    '<%= config.bin %> <%= command.id %> jira:ABC',
  ]

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { flags, argv } = await this.parse(WorkSourceSet)
    const jsonMode = shouldOutputJson(flags)
    const sourceInput = (argv as string[])[0]?.trim()

    if (!sourceInput) {
      const message = 'Usage: prlt work source set <provider[:context]>'
      if (jsonMode) {
        outputErrorAsJson('SOURCE_REQUIRED', message, createMetadata('work source set', flags))
      }
      this.error(message)
    }

    let source
    try {
      source = parseWorkSourceRef(sourceInput)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid work source.'
      if (jsonMode) {
        outputErrorAsJson('INVALID_SOURCE', message, createMetadata('work source set', flags))
      }
      this.error(message)
    }

    const db = this.storage.getDatabase()
    saveDefaultWorkSource(db, source)
    const ref = formatWorkSourceRef(source)

    if (jsonMode) {
      outputSuccessAsJson({
        activeSource: {
          provider: source.provider,
          context: source.context ?? null,
          ref,
        },
      }, createMetadata('work source set', flags))
    }

    this.log(styles.success(`Default work source set to ${ref}`))
  }
}
